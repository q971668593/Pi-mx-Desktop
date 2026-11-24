import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'
import { SandboxContextMenuPortal } from './sandbox-context-menu'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))

describe('sandbox deletion', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

  it('refreshes and reports deletion success even if subsequent state cleanup throws', async () => {
    const path = 'C:/sandbox/chat'
    useUIStore.getState().setWorkspace(path)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(useUIStore.getState(), 'clearTimeline').mockImplementation(() => { throw new Error('cleanup failed') })
    invoke.mockResolvedValue({ ok: true })
    const refresh = vi.fn()
    render(<SandboxContextMenuPortal menu={{ x: 0, y: 0, path, label: 'Chat' }} onClose={() => {}} onListChange={refresh} />)
    await act(async () => { fireEvent.click(screen.getByText('common:sidebar.delete')) })
    await act(async () => { fireEvent.click(screen.getByText('common:confirm')) })
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('common:sidebar.deleted')
    expect(error).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  it('refreshes and reports failure when deletion fails', async () => {
    invoke.mockResolvedValue({ ok: false })
    const refresh = vi.fn()
    render(<SandboxContextMenuPortal menu={{ x: 0, y: 0, path: 'C:/sandbox/chat', label: 'Chat' }} onClose={() => {}} onListChange={refresh} />)
    await act(async () => { fireEvent.click(screen.getByText('common:sidebar.delete')) })
    await act(async () => { fireEvent.click(screen.getByText('common:confirm')) })
    expect(toast.error).toHaveBeenCalledWith('common:sidebar.deleteFailed')
    expect(refresh).toHaveBeenCalled()
  })
  it('clears the current sandbox and refreshes the list after successful deletion', async () => {
    const path = 'C:/sandbox/chat'
    useUIStore.getState().setWorkspace(path)
    useUIStore.getState().setCurrentSession('session')
    invoke.mockResolvedValue({ ok: true })
    const refresh = vi.fn()
    render(<SandboxContextMenuPortal menu={{ x: 0, y: 0, path, label: 'Chat' }} onClose={() => {}} onListChange={refresh} />)
    await act(async () => { fireEvent.click(screen.getByText('common:sidebar.delete')) })
    await act(async () => { fireEvent.click(screen.getByText('common:confirm')) })
    expect(toast.error).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
    expect(useUIStore.getState().currentWorkspace).toBeNull()
  })
})
