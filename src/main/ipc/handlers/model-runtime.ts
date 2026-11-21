import { app } from 'electron'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { isSandboxWorkspacePath } from '../../sandbox-workspaces'
import { readModelsConfigRaw, modelsCatalogFromConfig } from '../../pi-models-json'
import { getActiveSdkModule } from '../sdk-session'
import { getSessionContextPreviewFromDisk } from '../../session-context-preview'
import { getSessionLeafOverride } from '../../session-leaf-override'
import { authorizeTrustedSessionFile } from '../../trusted-workspace'
import { getAgentRuntimeConfig, isWslRuntimeActive } from '../../wsl/runtime-config'
import { resolveActiveAgentDir } from '../../agent-dir'
import { sessionPreviewProcess } from '../../session-preview-process'
import { contextPreviewSchema, modelListSchema, modelSetSchema, runtimeGetStateSchema, thinkingLevelSetSchema } from '../schemas'
import type { ModelEntry } from '../../active-sdk-models'
import { modelThinkingLevels, MODEL_THINKING_LEVELS } from '@shared/model-thinking-levels'
import { getSessionModelOverrides } from '../../session-model-overrides-instance'
import { normalizeSessionKey } from '../../worker-session-key'
import { readPiAgentGlobalSettingsFromDisk } from '../../pi-agent-settings-read'
import {
  listAvailableModelsWithSdk,
  listCatalogModelsWithSdk,
  resolveAvailableModels,
  resolveCatalogModels,
} from '../../active-sdk-models'

/**
 * SDK model listing runs in the preview utility process: importing the SDK on the main process
 * blocks the browser UI thread for ~0.6s (window, IPC and renderer chunk loads all stall).
 * Only host mode may fall back to the in-process (host) SDK: under WSL that SDK would report
 * Windows models and auth, so a failed WSL preview surfaces as an error instead.
 */
async function listModelsOffThread(scope: 'available' | 'catalog'): Promise<readonly ModelEntry[]> {
  const runtime = getAgentRuntimeConfig()
  const wsl = isWslRuntimeActive()
  const assertSameRuntime = (): void => {
    const current = getAgentRuntimeConfig()
    if (current.mode !== runtime.mode || current.distro !== runtime.distro) {
      throw new Error('MODEL_RUNTIME_CHANGED')
    }
  }
  try {
    // WSL: the WSL preview resolves its own (native) agent dir.
    const models = await sessionPreviewProcess.listModels(scope, wsl ? '' : resolveActiveAgentDir())
    assertSameRuntime()
    return models
  } catch (error) {
    if (wsl || (error instanceof Error && error.message === 'MODEL_RUNTIME_CHANGED')) throw error
    console.warn(`[IPC] model.list ${scope} via preview failed, using main:`, error)
  }
  const sdk = await getActiveSdkModule(app.getPath('userData'))
  assertSameRuntime()
  return scope === 'available' ? listAvailableModelsWithSdk(sdk) : listCatalogModelsWithSdk(sdk)
}

export function registerModelRuntimeHandlers(): void {
  registerHandlerWithSchema('ipc:model.list', modelListSchema, async (req) => {
    const scope = req?.scope === 'available' ? 'available' : req?.scope === 'settings' ? 'settings' : 'catalog'
    const mapRegistry = (models: readonly ModelEntry[]) =>
      models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider || '',
        contextWindow: m.contextWindow || 0,
        maxOutput: m.maxOutput || m.maxTokens || 0,
        available: m.available ?? true,
        availableThinkingLevels: m.availableThinkingLevels ?? modelThinkingLevels(m),
        managedBy: m.managedBy,
        auth: m.auth,
      }))

    const catalogFromDisk = () => {
      const { config, parseError } = readModelsConfigRaw()
      if (parseError) return { models: [] as ReturnType<typeof mapRegistry> }
      return { models: modelsCatalogFromConfig(config) }
    }

    if (scope === 'settings' && workerManager.isRunning) {
      try {
        return {
          models: mapRegistry(
            (await workerManager.getModelSettingsSnapshot()).filter(
              (model): model is typeof model & { id: string } => typeof model.id === 'string',
            ),
          ),
        }
      } catch (error) {
        console.error('[IPC] model.list settings worker failed:', error)
      }
    }

    if (scope === 'catalog' || scope === 'settings') {
      const models = await resolveCatalogModels({
        sdk: async () => {
          const catalog = await listModelsOffThread('catalog')
          return scope === 'settings'
            ? mapRegistry(catalog)
            : catalog.map((model) => ({
                id: model.id,
                name: model.name || model.id,
                provider: model.provider || '',
                contextWindow: model.contextWindow || 0,
                maxOutput: model.maxOutput || model.maxTokens || 0,
                available: true,
              }))
        },
        catalog: () => catalogFromDisk().models,
        onSdkError: (error) => console.error('[IPC] model.list catalog failed:', error),
      })
      return { models }
    }

    // 某个 worker 正跑着 turn 时，它的模型注册表还没重载（改完 providers / models.json 后点开
    // 模型列表会一直看到旧的，直到那个 turn 结束）。这种情况直接读磁盘上的 SDK 快照，
    // 同时把重载再踢一次，让 worker 尽快跟上。
    const workerStale = workerManager.isRunning && workerManager.hasPendingModelReload
    if (workerStale) {
      try {
        await workerManager.reloadModels()
      } catch (error) {
        console.warn('[IPC] model.list: deferred worker reload failed:', error)
      }
    }
    const models = await resolveAvailableModels({
      worker:
        workerManager.isRunning && !workerStale
          ? async () =>
              mapRegistry(
                (await workerManager.getModels()).filter(
                  (model): model is typeof model & { id: string } => typeof model.id === 'string',
                ),
              )
          : undefined,
      sdk: async () => mapRegistry(await listModelsOffThread('available')),
      onWorkerError: (error) => console.error('[IPC] model.list worker failed:', error),
      onSdkError: (error) => console.error('[IPC] model.list failed:', error),
    })
    return { models }
  })

  /**
   * A model picked for a session with no live worker is recorded as a pending override and
   * confirmed to the UI right away. Applying it requires loading the session transcript
   * (measured 2266ms on a 54MB session), which must not be the price of picking a model.
   */
  function rememberModelForColdSession(provider: string, modelId: string, sessionFile: string) {
    const catalog = modelsCatalogFromConfig(readModelsConfigRaw().config)
    const entry = catalog.find((model) => model.provider === provider && model.id === modelId)
    const levels = entry?.availableThinkingLevels
    const boundMap = readPiAgentGlobalSettingsFromDisk()?.modelThinkingLevels
    const bound = boundMap && typeof boundMap === 'object'
      ? (boundMap as Record<string, unknown>)[`${provider}/${modelId}`]
      : undefined
    let thinkingLevel = typeof bound === 'string' ? bound : undefined
    if (thinkingLevel && levels && !levels.includes(thinkingLevel as never)) {
      // Keep the UI honest: never show a level the model will clamp away.
      const order: readonly string[] = MODEL_THINKING_LEVELS
      const rank = order.indexOf(thinkingLevel)
      thinkingLevel = [...levels].reverse().find((level) => order.indexOf(String(level)) <= rank)
    }
    // Same key the worker pool and the apply step use (separators / drive letter normalized),
    // otherwise a re-rendered `C:/x/y.jsonl` would never match the pool key `C:\\x\\y.jsonl`.
    getSessionModelOverrides().set(normalizeSessionKey(sessionFile), provider, modelId)
    return {
      modelId: `${provider}/${modelId}`,
      thinkingLevel,
      availableThinkingLevels: levels,
    }
  }

  registerHandlerWithSchema('ipc:model.set', modelSetSchema, async (req) => {
    const sessionFile = String(req.sessionFile || '').trim() || undefined
    let provider: string
    let modelId: string
    if (req.provider && req.modelId) {
      provider = req.provider
      modelId = req.modelId
    } else {
      const raw = req.modelId || ''
      const separator = raw.indexOf('/')
      if (separator >= 0) {
        provider = raw.slice(0, separator)
        modelId = raw.slice(separator + 1)
      } else {
        provider = 'anthropic'
        modelId = raw
      }
    }
    if (sessionFile && !workerManager.hasLiveSession(sessionFile)) {
      return rememberModelForColdSession(provider, modelId, sessionFile)
    }
    if (!workerManager.isRunning && !sessionFile) {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (!cwd || isSandboxWorkspacePath(cwd)) throw new Error('Worker not started')
      await workerManager.start(cwd)
    }
    return workerManager.setModelWithThinking(provider, modelId, sessionFile)
  })

  registerHandler('ipc:model.cycle', async () => ({
    modelId: '',
    thinkingLevel: 'medium',
  }))

  registerHandlerWithSchema('ipc:thinkingLevel.set', thinkingLevelSetSchema, async (req) => {
    const sessionFile = String(req.sessionFile || '').trim()
    if (!sessionFile) throw new Error('SESSION_FILE_REQUIRED')
    const level = String(req.level ?? '').trim()
    await workerManager.setThinkingLevel(level, sessionFile)
    return { level }
  })

  registerHandlerWithSchema('ipc:runtime.getState', runtimeGetStateSchema, async (req) => {
    const workspaceId = String(req?.workspaceId || '').trim()
    const sessionFile = String(req?.sessionFile || '').trim()
    const stateOpts = { includeTools: req?.includeTools === true }
    if (sessionFile) {
      try {
        return { state: await workerManager.getState(sessionFile, stateOpts) }
      } catch {
        return { state: null }
      }
    }
    if (workspaceId && workspaceId !== workerManager.cwd) {
      const bg = await workerManager.getBackgroundRuntimeState(workspaceId)
      return { state: bg }
    }
    if (!workerManager.isRunning) return { state: null }
    return { state: await workerManager.getState(undefined, stateOpts) }
  })

  registerHandlerWithSchema('ipc:context.preview', contextPreviewSchema, async (req) => {
    const { sessionFile, workspaceId } = req
    const authorized = await authorizeTrustedSessionFile(workspaceId, sessionFile)
    if (!authorized.ok) return { preview: null }

    if (workerManager.isRunning) {
      try {
        const preview = await workerManager.getSessionContextPreview(authorized.sessionFile)
        if (preview) return { preview }
      } catch (e) {
        console.warn('[IPC] live context.preview failed, using disk:', e)
      }
    }
    try {
      const leafId = getSessionLeafOverride(authorized.sessionFile)
      // Off the main thread (see listModelsOffThread); in-process only as a fallback.
      const preview = await sessionPreviewProcess
        .getContextPreview(authorized.sessionFile, leafId)
        .catch((error) => {
          console.warn('[IPC] context.preview via preview failed:', error)
          // Host SDK fallback only for host sessions: it cannot read a WSL session's runtime.
          return isWslRuntimeActive() ? null : getSessionContextPreviewFromDisk(authorized.sessionFile, leafId)
        })
      return { preview }
    } catch (e) {
      console.error('[IPC] context.preview failed:', e)
      return { preview: null }
    }
  })
}
