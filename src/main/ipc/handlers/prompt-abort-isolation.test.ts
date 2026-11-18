import { beforeEach, describe, expect, it, vi } from 'vitest'

// electron-store 在非 Electron 环境会把 conf 初始化成 "Please specify the projectName option"，
// 这个测试只需要模块能加载（config-store → browser-host 的导入链），不需要真实持久化。
vi.mock('electron-store', () => ({
  default: class {
    get(_key: string, fallback?: unknown) {
      return fallback
    }
    set() {}
    has() {
      return false
    }
    delete() {}
    clear() {}
    on() {}
    get store() {
      return {}
    }
  },
}))

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  abort: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (
    channel: string,
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => mocks.handlers.set(channel, handler),
  registerHandlerWithSchema: vi.fn(),
}))
vi.mock('../../worker-manager', () => ({
  workerManager: {
    abort: mocks.abort,
    getState: mocks.getState,
  },
}))
vi.mock('../../session-bind-state', () => ({
  ensureWorkerSessionBound: vi.fn(),
}))
vi.mock('../../clipboard-temp-images', () => ({
  writeClipboardTempImage: vi.fn(),
}))

import { registerPromptHandlers } from './prompt'

describe('prompt.abort session isolation', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.abort.mockReset()
    mocks.getState.mockReset()
    registerPromptHandlers()
  })

  it('rejects an abort request without a session file instead of targeting foreground', async () => {
    const handler = mocks.handlers.get('ipc:prompt.abort')
    expect(handler).toBeDefined()

    const result = await handler!({ sessionId: '' })

    expect(result).toEqual({
      aborted: false,
      ignored: true,
      reason: 'session_required',
    })
    expect(mocks.abort).not.toHaveBeenCalled()
  })

  it('aborts only the explicitly requested session', async () => {
    const handler = mocks.handlers.get('ipc:prompt.abort')!
    mocks.getState.mockResolvedValue({
      sessionFile: '/sessions/current.jsonl',
      isStreaming: true,
    })

    const result = await handler({
      sessionId: 'current',
      sessionFile: '/sessions/current.jsonl',
    })

    expect(result).toEqual({ aborted: true })
    expect(mocks.abort).toHaveBeenCalledWith('/sessions/current.jsonl')
  })
})
