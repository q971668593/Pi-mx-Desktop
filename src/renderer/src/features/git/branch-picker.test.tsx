import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { BranchPickerPopover, type BranchStatus } from './branch-picker'

// Assertions use the English copy; the app ships Chinese by default.
beforeAll(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))

const status: BranchStatus = {
  isRepo: true,
  branch: 'main',
  head: 'abc1234',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  dirty: 0,
}

const branches = {
  branches: [
    { name: 'main', remote: false, head: 'abc1234', date: 1, upstream: 'origin/main', current: true, worktree: null },
    { name: 'feature/x', remote: false, head: 'def5678', date: 2, upstream: null, current: false, worktree: null },
    { name: 'origin/feature/y', remote: true, head: 'aaa9999', date: 3, upstream: null, current: false, worktree: null },
  ],
}

function renderPicker(onSwitched = vi.fn()) {
  const anchor = { current: document.createElement('button') }
  document.body.append(anchor.current)
  const onClose = vi.fn()
  render(<BranchPickerPopover cwd="/repo" status={status} anchorRef={anchor} onClose={onClose} onSwitched={onSwitched} />)
  return { onClose, onSwitched }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ currentWorkspace: '/repo', sessions: [], sessionAttention: {} })
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'git.branches') return branches
    if (channel === 'git.switchBranch') return { ok: true, branch: 'feature/x', stashed: false }
    return {}
  })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('BranchPickerPopover', () => {
  it('lists local and remote branches and marks the current one', async () => {
    renderPicker()
    const current = await screen.findByRole('option', { name: /main/ })
    expect(current).toHaveAttribute('aria-selected', 'true')
    expect(current).toBeDisabled()
    expect(screen.getByRole('option', { name: /feature\/x/ })).toBeEnabled()
    expect(await screen.findByRole('option', { name: /origin\/feature\/y/ })).toBeEnabled()
  })

  it('switches branch on click, closes the popover and reports back', async () => {
    const { onClose, onSwitched } = renderPicker()
    fireEvent.click(await screen.findByRole('option', { name: /feature\/x/ }))

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('git.switchBranch', { cwd: '/repo', name: 'feature/x', remote: false }),
    )
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(onSwitched).toHaveBeenCalled())
  })

  it('creates a branch from the typed name', async () => {
    renderPicker()
    await screen.findByRole('option', { name: /feature\/x/ })
    fireEvent.click(screen.getByRole('button', { name: /new branch/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'feature/z' } })
    fireEvent.click(screen.getByRole('button', { name: /create.*feature\/z/i }))

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('git.switchBranch', { cwd: '/repo', name: 'feature/z', create: true }),
    )
  })

  it('asks for confirmation when a turn is still running here', async () => {
    useUIStore.setState({
      currentWorkspace: '/repo',
      sessions: [{ sessionId: 'a', sessionFile: '/s/a.jsonl', workspaceId: '/repo', title: 'A', modelId: '', updatedAt: 1 }],
      sessionAttention: { '/s/a.jsonl': 'working' },
    })
    renderPicker()
    fireEvent.click(await screen.findByRole('option', { name: /feature\/x/ }))

    // No switch yet: the dialog explains why first.
    expect(mocks.invoke).not.toHaveBeenCalledWith('git.switchBranch', expect.anything())
    fireEvent.click(await screen.findByRole('button', { name: /switch anyway/i }))
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('git.switchBranch', { cwd: '/repo', name: 'feature/x', remote: false }),
    )
  })

  it('offers stash-and-switch when git reports a dirty conflict', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'git.branches') return branches
      if (channel === 'git.switchBranch') return { ok: false, reason: 'dirty-conflict', files: ['src/a.ts'] }
      return {}
    })
    renderPicker()
    fireEvent.click(await screen.findByRole('option', { name: /feature\/x/ }))
    fireEvent.click(await screen.findByRole('button', { name: /stash and switch/i }))

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('git.switchBranch', {
        cwd: '/repo',
        name: 'feature/x',
        remote: false,
        stash: true,
      }),
    )
  })
})
