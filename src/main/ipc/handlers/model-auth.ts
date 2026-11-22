import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { registerHandlerWithSchema, sendEvent } from '../registry'
import { modelAuthAnswerSchema, modelAuthCancelSchema, modelAuthLoginSchema, modelAuthProvidersSchema } from '../schemas'
import { getActiveSdkModule } from '../sdk-session'
import { resolveActiveAgentDir } from '../../agent-dir'
import { workerManager } from '../../worker-manager'
import { deviceId } from '../../image-gen/identity'
import type { ModelAuthEvent, ModelAuthNotice, ModelAuthPrompt } from '@shared/app-events'

/**
 * 订阅（OAuth）登录：主进程跑 SDK 自己的登录流程，凭据由 SDK 写进 auth.json。
 *
 * 流程里有两种东西要送到界面：`notify`（打开的授权地址、设备码、进度）和 `prompt`
 * （选择账号类型、粘贴回调 URL 等）。notify 直接广播；prompt 挂起等界面用
 * `ipc:model.auth.answer` 回话，取消走 `ipc:model.auth.cancel`。
 */
type PendingPrompt = {
  resolve: (value: string) => void
  reject: (error: Error) => void
}

type LoginSession = {
  providerId: string
  controller: AbortController
  prompts: Map<string, PendingPrompt>
  seq: number
}

const sessions = new Map<string, LoginSession>()

function broadcast(event: ModelAuthEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    sendEvent(win, event)
  }
}

/** Shape of the prompt the SDK hands us (pi-ai AuthPrompt) plus its optional abort signal. */
type SdkPrompt = {
  type: 'text' | 'secret' | 'select' | 'manual_code'
  message: string
  placeholder?: string
  options?: readonly { id: string; label: string; description?: string }[]
  signal?: AbortSignal
}

type SdkEvent = {
  type: 'info' | 'auth_url' | 'device_code' | 'progress'
  message?: string
  links?: readonly { url: string; label?: string }[]
  url?: string
  instructions?: string
  userCode?: string
  verificationUri?: string
  intervalSeconds?: number
  expiresInSeconds?: number
}

function toPrompt(prompt: SdkPrompt): ModelAuthPrompt {
  return {
    kind: prompt.type,
    message: prompt.message,
    placeholder: prompt.placeholder,
    options: prompt.options?.map((option) => ({ ...option })),
  }
}

function toNotice(event: {
  type: 'info' | 'auth_url' | 'device_code' | 'progress'
  message?: string
  links?: readonly { url: string; label?: string }[]
  url?: string
  instructions?: string
  userCode?: string
  verificationUri?: string
  intervalSeconds?: number
  expiresInSeconds?: number
}): ModelAuthNotice {
  switch (event.type) {
    case 'auth_url':
      return { kind: 'auth_url', url: event.url ?? '', instructions: event.instructions }
    case 'device_code':
      return {
        kind: 'device_code',
        userCode: event.userCode ?? '',
        verificationUri: event.verificationUri ?? '',
        intervalSeconds: event.intervalSeconds,
        expiresInSeconds: event.expiresInSeconds,
      }
    case 'progress':
      return { kind: 'progress', message: event.message ?? '' }
    default:
      return {
        kind: 'info',
        message: event.message ?? '',
        links: event.links?.map((link) => ({ ...link })),
      }
  }
}

function askUser(session: LoginSession, prompt: Parameters<typeof toPrompt>[0]): Promise<string> {
  const promptId = `${session.providerId}:${++session.seq}`
  return new Promise<string>((resolve, reject) => {
    session.prompts.set(promptId, { resolve, reject })
    const settle = (): void => {
      session.prompts.delete(promptId)
      prompt.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      settle()
      reject(new Error('LOGIN_CANCELLED'))
    }
    prompt.signal?.addEventListener('abort', onAbort, { once: true })
    broadcast({
      type: 'model-auth',
      providerId: session.providerId,
      phase: 'prompt',
      promptId,
      prompt: toPrompt(prompt),
    })
  })
}

async function reloadModelsAfterCredentialChange(): Promise<void> {
  try {
    await workerManager.reloadModels()
  } catch (error) {
    console.warn('[model-auth] worker reload after login failed (ignored):', error)
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('ipc:model-catalog-changed', {})
  }
}

async function createRuntime(): Promise<{
  login: (providerId: string, type: 'oauth' | 'api_key', interaction: unknown, options?: unknown) => Promise<unknown>
  logout: (providerId: string) => Promise<void>
}> {
  const sdk = await getActiveSdkModule(app.getPath('userData'))
  const ModelRuntime = (sdk as { ModelRuntime?: { create?: (options?: Record<string, unknown>) => Promise<unknown> } })
    .ModelRuntime
  if (!ModelRuntime?.create) throw new Error('当前 Pi SDK 不支持订阅登录，请升级 SDK')
  const agentDir = resolveActiveAgentDir()
  const runtime = (await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
    // The login flow talks to the provider itself; the catalog refresh is not needed here.
    allowModelNetwork: false,
    refreshOnCreate: false,
  })) as {
    login: (providerId: string, type: 'oauth' | 'api_key', interaction: unknown, options?: unknown) => Promise<unknown>
    logout: (providerId: string) => Promise<void>
  }
  return runtime
}

export function registerModelAuthHandlers(): void {
  registerHandlerWithSchema('ipc:model.auth.providers', modelAuthProvidersSchema, async () => {
    const runtime = await createRuntime()
    const list = (runtime as unknown as {
      getProviders: () => readonly {
        id: string
        name?: string
        auth?: {
          oauth?: { login?: unknown; loginLabel?: string; isSubscription?: boolean; name?: string }
          apiKey?: { login?: unknown; name?: string }
        }
      }[]
    }).getProviders()
    return {
      providers: list.map((provider) => ({
        providerId: provider.id,
        name: provider.name || provider.id,
        oauth: provider.auth?.oauth?.login
          ? {
              supported: true,
              loginLabel: provider.auth.oauth.loginLabel,
              subscription: provider.auth.oauth.isSubscription === true,
              methodName: provider.auth.oauth.name,
            }
          : { supported: false },
        apiKey: provider.auth?.apiKey?.login
          ? { supported: true, methodName: provider.auth.apiKey.name }
          : { supported: false },
      })),
    }
  })

  registerHandlerWithSchema('ipc:model.auth.login', modelAuthLoginSchema, async (req) => {
    const providerId = req.providerId
    if (sessions.has(providerId)) throw new Error('该供应商正在登录中')
    if (workerManager.hasActiveTurns) throw new Error('当前有 Agent 正在运行，请等这一轮结束后再登录')

    const session: LoginSession = {
      providerId,
      controller: new AbortController(),
      prompts: new Map(),
      seq: 0,
    }
    sessions.set(providerId, session)

    try {
      const runtime = await createRuntime()
      const interaction = {
        signal: session.controller.signal,
        notify: (event: Parameters<typeof toNotice>[0]) => {
          broadcast({
            type: 'model-auth',
            providerId,
            phase: 'notice',
            notice: toNotice(event),
          })
        },
        prompt: (prompt: Parameters<typeof toPrompt>[0]) => askUser(session, prompt),
      }
      // getDeviceId: Sign in with ChatGPT requires a stable installation UUID; the image-gen
      // identity already keeps one under userData.
      await runtime.login(providerId, req.type ?? 'oauth', interaction, {
        getDeviceId: () => deviceId(app.getPath('userData')),
        agentName: 'pi-desktop',
      })
      await reloadModelsAfterCredentialChange()
      broadcast({ type: 'model-auth', providerId, phase: 'done' })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = session.controller.signal.aborted || message === 'LOGIN_CANCELLED' || /cancel/i.test(message)
      for (const pending of session.prompts.values()) pending.reject(new Error('LOGIN_CANCELLED'))
      session.prompts.clear()
      broadcast({
        type: 'model-auth',
        providerId,
        phase: cancelled ? 'cancelled' : 'error',
        error: cancelled ? undefined : message,
      })
      throw error
    } finally {
      sessions.delete(providerId)
    }
  })

  registerHandlerWithSchema('ipc:model.auth.answer', modelAuthAnswerSchema, async (req) => {
    const session = sessions.get(req.providerId)
    const pending = session?.prompts.get(req.promptId)
    if (!session || !pending) throw new Error('登录提问已失效')
    session.prompts.delete(req.promptId)
    if (req.cancelled) pending.reject(new Error('LOGIN_CANCELLED'))
    else pending.resolve(req.value ?? '')
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:model.auth.cancel', modelAuthCancelSchema, async (req) => {
    const session = sessions.get(req.providerId)
    if (!session) return { ok: true }
    session.controller.abort()
    for (const pending of session.prompts.values()) pending.reject(new Error('LOGIN_CANCELLED'))
    session.prompts.clear()
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:model.auth.logout', modelAuthCancelSchema, async (req) => {
    if (sessions.has(req.providerId)) throw new Error('该供应商正在登录中')
    const runtime = await createRuntime()
    await runtime.logout(req.providerId)
    await reloadModelsAfterCredentialChange()
    return { ok: true }
  })
}
