import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDelegateSessionPreview } from './delegate-session-navigation'
import { useUIStore } from '@renderer/stores/ui-store'
import type { DelegateRun } from './delegate-runs'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  previewSessionInPlace: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({ previewSessionInPlace: mocks.previewSessionInPlace }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

function run(overrides: Partial<DelegateRun> = {}): DelegateRun {
  return {
    key: 'del_1',
    runId: 'del_1',
    agent: 'researcher',
    task: '看代码',
    state: 'running',
    startedAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.previewSessionInPlace.mockResolvedValue(undefined)
  useUIStore.setState({
    currentWorkspace: '/ws',
    currentSessionId: 's1',
    historySessionFile: '/sessions/parent.jsonl',
    subagentSessionGroup: null,
  })
})

describe('openDelegateSessionPreview', () => {
  it('resolves the temp session file, prepares it read-only and previews it', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'delegate.sessionFiles') return { files: { del_1: '/temp/del_1.session.jsonl' } }
      if (channel === 'session.prepare') return { sessionId: 'child', sessionFile: '/temp/del_1.session.jsonl' }
      return {}
    })
    await expect(openDelegateSessionPreview(run())).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('delegate.sessionFiles', { runIds: ['del_1'] })
    expect(mocks.invoke).toHaveBeenCalledWith('session.prepare', {
      sessionFile: '/temp/del_1.session.jsonl',
      bind: false,
    })
    // 绑定 group：侧栏和「返回上一级」才知道这个预览属于谁
    expect(useUIStore.getState().subagentSessionGroup).toMatchObject({
      parentSessionFile: '/sessions/parent.jsonl',
      previewSessionFile: '/temp/del_1.session.jsonl',
    })
    expect(mocks.previewSessionInPlace).toHaveBeenCalledWith('child', '/temp/del_1.session.jsonl', expect.any(Number))
  })

  it('tells the user when the temp session file is already gone', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'delegate.sessionFiles') return { files: { del_1: null } }
      return {}
    })
    await expect(openDelegateSessionPreview(run())).resolves.toBe(false)
    expect(mocks.toastError).toHaveBeenCalled()
    expect(mocks.previewSessionInPlace).not.toHaveBeenCalled()
  })

  it('bails out without a bound session', async () => {
    useUIStore.setState({ historySessionFile: null })
    await expect(openDelegateSessionPreview(run())).resolves.toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
