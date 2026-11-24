import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { restoreQueuedToComposer } from './composer-queue-restore'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), message: vi.fn(), error: vi.fn() } }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn() } }))

describe('restoreQueuedToComposer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useUIStore.setState({ historySessionFile: 'session-a', pendingSteering: [], pendingFollowUp: ['B'] })
  })

  it('restores the worker result without clearing a newer queue in another session', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(ipcClient.invoke).mockReturnValueOnce(new Promise((r) => { resolve = r }) as never)
    const setText = vi.fn()
    const pending = restoreQueuedToComposer({ setText })
    useUIStore.setState({ historySessionFile: 'session-b', pendingFollowUp: ['new'] })
    resolve({ restoredCount: 1, combinedText: 'B' })
    expect(await pending).toBe(1)
    expect(setText).toHaveBeenCalledWith('B')
    expect(useUIStore.getState().pendingFollowUp).toEqual(['new'])
  })

  it('keeps the queue and draft untouched on failure', async () => {
    vi.mocked(ipcClient.invoke).mockRejectedValueOnce(new Error('offline'))
    const setText = vi.fn()
    expect(await restoreQueuedToComposer({ setText, currentText: 'draft' })).toBe(0)
    expect(setText).not.toHaveBeenCalled()
    expect(useUIStore.getState().pendingFollowUp).toEqual(['B'])
  })
})
