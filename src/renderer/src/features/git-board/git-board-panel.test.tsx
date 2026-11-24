import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { GitBoardPanel } from './git-board-panel'

// Assertions use the English copy; the app ships Chinese by default.
beforeAll(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))

const overview = {
  ok: true,
  status: { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 },
  files: [],
  branches: [
    { name: 'main', kind: 'local', current: true, hash: 'abc1234', upstream: 'origin/main', ahead: 0, behind: 0, subject: 'init' },
    { name: 'feature/x', kind: 'local', current: false, hash: 'def5678', upstream: null, ahead: 0, behind: 0, subject: 'work' },
  ],
  commits: [],
  hasMore: false,
  stashes: [],
  tags: [],
  remotes: [{ name: 'origin', fetch: 'git@example.com:a/b.git', push: 'git@example.com:a/b.git' }],
  worktrees: [],
  operation: null,
}

const branchRefs = {
  branches: [
    { name: 'main', remote: false, head: 'abc1234', date: 1, upstream: 'origin/main', current: true, worktree: null },
    { name: 'feature/x', remote: false, head: 'def5678', date: 2, upstream: null, current: false, worktree: null },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ currentWorkspace: '/repo' })
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'gitBoard.changes') return { ok: true, status: overview.status, files: overview.files, operation: null }
    if (channel === 'gitBoard.overview') return overview
    if (channel === 'git.branchStatus') {
      return { isRepo: true, branch: 'main', head: 'abc1234', upstream: 'origin/main', ahead: 0, behind: 0, dirty: 0 }
    }
    if (channel === 'git.branches') return branchRefs
    if (channel === 'git.switchBranch') return { ok: true, branch: 'feature/x', stashed: false }
    return {}
  })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('GitBoardPanel branch header', () => {
  it('keeps an in-flight suggestion across unmounts and isolates workspaces', async () => {
    let resolve!: (result: unknown) => void
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'gitBoard.suggestCommit') return new Promise((done) => { resolve = done })
      if (channel === 'gitBoard.changes') return { ok: true, status: overview.status, files: overview.files, operation: null }
      if (channel === 'gitBoard.overview') return overview
      if (channel === 'git.branchStatus') return { isRepo: true, branch: 'main', head: 'abc', upstream: null, ahead: 0, behind: 0, dirty: 0 }
      return {}
    })
    const view = render(<GitBoardPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write message' }))
    await waitFor(() => expect(resolve).toBeDefined())
    view.unmount()
    useUIStore.setState({ currentWorkspace: '/other' })
    const other = render(<GitBoardPanel />)
    expect(await screen.findByPlaceholderText('Commit message')).toHaveValue('')
    await act(async () => resolve({ ok: true, text: 'feat: saved' }))
    expect(screen.getByPlaceholderText('Commit message')).toHaveValue('')
    other.unmount()
    useUIStore.setState({ currentWorkspace: '/repo' })
    render(<GitBoardPanel />)
    expect(await screen.findByPlaceholderText('Commit message')).toHaveValue('feat: saved')
  })
  it('opens the branch picker from the header label instead of staying read-only', async () => {
    render(<GitBoardPanel />)

    const trigger = await screen.findByRole('button', { name: /Branch main/ })
    fireEvent.click(trigger)

    // The picker lists the other local branch and can switch to it.
    const target = await screen.findByRole('option', { name: /feature\/x/ })
    fireEvent.click(target)

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('git.switchBranch', { cwd: '/repo', name: 'feature/x', remote: false }),
    )
    // Reload after the switch so the panel header shows the new branch.
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'gitBoard.overview').length).toBeGreaterThan(1))
  })
})
