import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: Record<string, unknown>) => Promise<unknown>>(),
  runtime: { mode: 'wsl' as 'host' | 'wsl', distro: 'Ubuntu' as string | null },
  previewListModels: vi.fn(),
  getActiveSdkModule: vi.fn(),
  listAvailableModelsWithSdk: vi.fn(),
  listCatalogModelsWithSdk: vi.fn(),
  readModelsConfigRaw: vi.fn(),
  workerManager: {
    isRunning: false,
    cwd: '/running-workspace',
    start: vi.fn(),
    setThinkingLevel: vi.fn(),
    hasLiveSession: vi.fn(() => false),
    setModelWithThinking: vi.fn(async () => ({ modelId: 'warm/model', thinkingLevel: 'medium' })),
  },
  overrides: { set: vi.fn(), get: vi.fn(() => null), clear: vi.fn(), list: vi.fn(() => []) },
  settings: { modelThinkingLevels: {} as Record<string, string> },
}))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../registry', () => ({
  registerHandler: (name: string, handler: (req: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, handler),
  registerHandlerWithSchema: (name: string, _schema: unknown, handler: (req: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, handler),
}))
vi.mock('../../worker-manager', () => ({ workerManager: mocks.workerManager }))
vi.mock('../../config-store', () => ({ configStore: { get: vi.fn() } }))
vi.mock('../../sandbox-workspaces', () => ({ isSandboxWorkspacePath: () => false }))
vi.mock('../../pi-models-json', () => ({
  readModelsConfigRaw: mocks.readModelsConfigRaw,
  // Mirrors shared/model-thinking-levels for the fixtures used here: non-reasoning models only
  // support "off"; xhigh/max require an explicit thinkingLevelMap entry.
  modelsCatalogFromConfig: (config: { models?: Array<{ reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }> }) =>
    (config.models ?? []).map((model) => ({
      ...model,
      availableThinkingLevels: model.reasoning === true
        ? ['off', 'minimal', 'low', 'medium', 'high', ...(model.thinkingLevelMap && 'xhigh' in model.thinkingLevelMap && model.thinkingLevelMap.xhigh !== null ? ['xhigh'] : [])]
        : ['off'],
    })),
}))
vi.mock('../sdk-session', () => ({ getActiveSdkModule: mocks.getActiveSdkModule }))
vi.mock('../../session-context-preview', () => ({ getSessionContextPreviewFromDisk: vi.fn() }))
vi.mock('../../session-leaf-override', () => ({ getSessionLeafOverride: vi.fn() }))
vi.mock('../../trusted-workspace', () => ({ authorizeTrustedSessionFile: vi.fn() }))
vi.mock('../../wsl/runtime-config', () => ({
  isWslRuntimeActive: () => mocks.runtime.mode === 'wsl' && !!mocks.runtime.distro,
  getAgentRuntimeConfig: () => ({ ...mocks.runtime }),
}))
vi.mock('../../agent-dir', () => ({ resolveActiveAgentDir: () => '/host/.pi/agent' }))
vi.mock('../../session-preview-process', () => ({ sessionPreviewProcess: { listModels: mocks.previewListModels } }))
vi.mock('../../session-model-overrides-instance', () => ({ getSessionModelOverrides: () => mocks.overrides }))
vi.mock('../../pi-agent-settings-read', () => ({ readPiAgentGlobalSettingsFromDisk: () => mocks.settings }))
vi.mock('../../active-sdk-models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../active-sdk-models')>()),
  listAvailableModelsWithSdk: mocks.listAvailableModelsWithSdk,
  listCatalogModelsWithSdk: mocks.listCatalogModelsWithSdk,
}))

import { registerModelRuntimeHandlers } from './model-runtime'
import { normalizeSessionKey } from '../../worker-session-key'

const hostModel = { id: 'windows-only', name: 'Windows', provider: 'host-provider' }
const wslModel = { id: 'wsl-model', name: 'WSL', provider: 'wsl-provider' }
const list = (scope: string) => mocks.handlers.get('ipc:model.list')!({ scope }) as Promise<{ models: Array<{ id: string }> }>

beforeEach(() => {
  mocks.handlers.clear()
  mocks.workerManager.isRunning = false
  mocks.workerManager.start.mockReset()
  mocks.workerManager.setThinkingLevel.mockReset()
  mocks.workerManager.hasLiveSession.mockReset().mockReturnValue(false)
  mocks.workerManager.setModelWithThinking.mockReset().mockResolvedValue({ modelId: 'warm/model', thinkingLevel: 'medium' })
  mocks.overrides.set.mockReset()
  mocks.overrides.get.mockReset().mockReturnValue(null)
  mocks.settings.modelThinkingLevels = {}
  mocks.runtime = { mode: 'wsl', distro: 'Ubuntu' }
  for (const mock of [mocks.previewListModels, mocks.getActiveSdkModule, mocks.listAvailableModelsWithSdk, mocks.listCatalogModelsWithSdk, mocks.readModelsConfigRaw]) mock.mockReset()
  mocks.getActiveSdkModule.mockResolvedValue({ host: true })
  mocks.listAvailableModelsWithSdk.mockResolvedValue([hostModel])
  mocks.listCatalogModelsWithSdk.mockResolvedValue([hostModel])
  mocks.readModelsConfigRaw.mockReturnValue({ path: '//wsl/models.json', config: { models: [wslModel] } })
  registerModelRuntimeHandlers()
})

describe('thinking level session isolation', () => {
  it.each([false, true])('rejects an unscoped change when isRunning=%s', async (isRunning) => {
    mocks.workerManager.isRunning = isRunning

    await expect(mocks.handlers.get('ipc:thinkingLevel.set')!({ level: 'medium' }))
      .rejects.toThrow('SESSION_FILE_REQUIRED')

    expect(mocks.workerManager.start).not.toHaveBeenCalled()
    expect(mocks.workerManager.setThinkingLevel).not.toHaveBeenCalled()
  })

  it('rejects a blank session target', async () => {
    mocks.workerManager.isRunning = true

    await expect(mocks.handlers.get('ipc:thinkingLevel.set')!({ level: 'medium', sessionFile: '  ' }))
      .rejects.toThrow('SESSION_FILE_REQUIRED')

    expect(mocks.workerManager.setThinkingLevel).not.toHaveBeenCalled()
  })

  it('changes only the explicitly requested session', async () => {
    mocks.workerManager.isRunning = true

    await expect(mocks.handlers.get('ipc:thinkingLevel.set')!({ level: 'medium', sessionFile: '/sessions/b.jsonl' }))
      .resolves.toEqual({ level: 'medium' })

    expect(mocks.workerManager.setThinkingLevel).toHaveBeenCalledExactlyOnceWith('medium', '/sessions/b.jsonl')
    expect(mocks.workerManager.start).not.toHaveBeenCalled()
  })
})

describe('R12 model list stays inside the active runtime', () => {
  it('should_return_empty_available_without_host_sdk_when_wsl_preview_fails', async () => {
    mocks.previewListModels.mockRejectedValue(new Error('WSL preview exited'))
    await expect(list('available')).resolves.toEqual({ models: [] })
    expect(mocks.getActiveSdkModule).not.toHaveBeenCalled()
  })

  it('should_use_same_environment_catalog_without_host_sdk_when_wsl_preview_fails', async () => {
    mocks.previewListModels.mockRejectedValue(new Error('WSL preview exited'))
    const result = await list('catalog')
    expect(result.models.map((model) => model.id)).toEqual(['wsl-model'])
    expect(mocks.getActiveSdkModule).not.toHaveBeenCalled()
  })

  it('should_return_wsl_preview_models_when_preview_succeeds', async () => {
    mocks.previewListModels.mockResolvedValue([wslModel])
    const result = await list('available')
    expect(result.models.map((model) => model.id)).toEqual(['wsl-model'])
    expect(mocks.previewListModels).toHaveBeenCalledWith('available', '')
  })

  it('should_keep_host_sdk_fallback_when_host_preview_fails', async () => {
    mocks.runtime = { mode: 'host', distro: null }
    mocks.previewListModels.mockRejectedValue(new Error('preview crashed'))
    const result = await list('available')
    expect(result.models.map((model) => model.id)).toEqual(['windows-only'])
    expect(mocks.previewListModels).toHaveBeenCalledWith('available', '/host/.pi/agent')
  })

  it('should_drop_result_when_runtime_switches_while_request_is_pending', async () => {
    mocks.runtime = { mode: 'host', distro: null }
    mocks.previewListModels.mockImplementation(async () => {
      mocks.runtime = { mode: 'wsl', distro: 'Ubuntu' }
      return [hostModel]
    })
    await expect(list('available')).resolves.toEqual({ models: [] })
    expect(mocks.getActiveSdkModule).not.toHaveBeenCalled()
  })
})

describe('model.set on a session without a live worker', () => {
  const setModel = (req: Record<string, unknown>) => mocks.handlers.get('ipc:model.set')!(req) as Promise<Record<string, unknown>>

  it('confirms the pick immediately and defers it to the next worker start', async () => {
    mocks.workerManager.hasLiveSession.mockReturnValue(false)
    const result = await setModel({ sessionFile: '/sessions/a.jsonl', provider: 'magpie', modelId: 'deepseek' })
    expect(result).toMatchObject({ modelId: 'magpie/deepseek' })
    expect(mocks.overrides.set).toHaveBeenCalledWith(normalizeSessionKey('/sessions/a.jsonl'), 'magpie', 'deepseek')
    // Selecting a model must never boot a worker (that is what made it slow).
    expect(mocks.workerManager.start).not.toHaveBeenCalled()
    expect(mocks.workerManager.setModelWithThinking).not.toHaveBeenCalled()
  })

  it('reports the bound thinking level, clamped to what the model supports', async () => {
    mocks.readModelsConfigRaw.mockReturnValue({
      path: '/agent/models.json',
      config: { models: [{ id: 'deepseek', provider: 'magpie', reasoning: true, thinkingLevelMap: { max: 'max', xhigh: null } }] },
    })
    mocks.settings.modelThinkingLevels = { 'magpie/deepseek': 'xhigh' }
    const result = await setModel({ sessionFile: '/sessions/a.jsonl', provider: 'magpie', modelId: 'deepseek' })
    expect(result.thinkingLevel).toBe('high')
  })

  it('applies the model through the worker when the session is warm', async () => {
    mocks.workerManager.hasLiveSession.mockReturnValue(true)
    const result = await setModel({ sessionFile: '/sessions/a.jsonl', provider: 'magpie', modelId: 'deepseek' })
    expect(result).toMatchObject({ modelId: 'warm/model' })
    expect(mocks.workerManager.setModelWithThinking).toHaveBeenCalledWith('magpie', 'deepseek', '/sessions/a.jsonl')
    expect(mocks.overrides.set).not.toHaveBeenCalled()
  })
})
