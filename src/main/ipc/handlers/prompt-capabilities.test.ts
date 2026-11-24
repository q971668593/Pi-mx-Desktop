import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: any) => Promise<any>>(),
  bind: vi.fn(),
  send: vi.fn(),
  getExtensions: vi.fn(),
  apply: vi.fn(),
}))
vi.mock('../registry', () => ({
  registerHandler: (name: string, fn: any) => mocks.handlers.set(name, fn),
  registerHandlerWithSchema: (name: string, _schema: unknown, fn: any) => mocks.handlers.set(name, fn),
}))
vi.mock('../../worker-manager', () => ({ workerManager: {
  cwd: '/foreground', getExtensionCapabilities: mocks.getExtensions, sendPrompt: mocks.send,
} }))
vi.mock('../../session-bind-state', () => ({ ensureWorkerSessionBound: mocks.bind }))
vi.mock('../../capabilities/session-apply', () => ({ applySessionCapabilities: mocks.apply }))
vi.mock('../../config-store', () => ({ configStore: { get: vi.fn() } }))
vi.mock('../../clipboard-temp-images', () => ({ readRemoteAttachment: vi.fn(), writeClipboardTempImage: vi.fn() }))
vi.mock('../../image-file-access', () => ({ readActionableImage: vi.fn(), resolveActionableImage: vi.fn() }))
vi.mock('electron', () => ({ clipboard: {}, nativeImage: {} }))

import { registerPromptHandlers } from './prompt'

describe('prompt capability application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.bind.mockResolvedValue(null)
    mocks.send.mockResolvedValue(undefined)
    mocks.apply.mockResolvedValue({ applied: true, capabilities: [] })
    registerPromptHandlers()
  })

  it('does not wait for a foreground workspace extension scan before applying a send snapshot', async () => {
    mocks.getExtensions.mockImplementation(() => new Promise(() => {}))
    const send = mocks.handlers.get('ipc:prompt.send')!({ sessionFile: '/other/session', text: 'hello', capabilities: ['web-search'] })
    await send
    await mocks.handlers.get('ipc:capabilities.apply')!({ sessionFile: '/other/session', capabilities: [] })
    expect(mocks.getExtensions).not.toHaveBeenCalled()
    expect(mocks.apply.mock.calls).toEqual([
      ['/other/session', ['web-search']],
      ['/other/session', [], { liveOnly: true }],
    ])
    expect(mocks.send).toHaveBeenCalledWith('hello', '/other/session')
  })
})
