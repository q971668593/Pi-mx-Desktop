import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'
import { ProjectSidebar } from './project-sidebar'
import type { GitWorktreeList } from '@shared/git-worktree'

beforeAll(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), activate: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: mocks.activate,
  switchSessionInPlace: vi.fn(),
  previewSessionInPlace: vi.fn(),
}))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({ useToolCardCatalogReady: () => true }))

/** 主进程那份假配置：隐藏列表（hiddenWorktrees）是唯一事实源。 */
let hidden: string[] = []
let recent: string[] = []

const dispatchHiddenChanged = () =>
  window.dispatchEvent(new CustomEvent('pi-desktop:settings-changed', { detail: { key: 'hiddenWorktrees' } }))

beforeEach(() => {
  __resetRefreshWorkspaceSessionListsForTests()
  mocks.invoke.mockReset()
  mocks.activate.mockReset()
  localStorage.removeItem('pi-desktop:hidden-projects')
  hidden = []
  recent = ['/proj/A', '/proj/B']
  useUIStore.setState({
    currentWorkspace: '/proj/A',
    recentProjects: [],
    hiddenProjects: [],
    projectDisplayNames: {},
    sessions: [],
    sessionsWorkspace: null,
    currentSessionId: null,
    historySessionFile: null,
    timelineItems: [],
    subagentSessionGroup: null,
    sidebarCollapsed: false,
    ephemeralSandboxDraft: false,
  })
  mocks.invoke.mockImplementation(async (method: string, req?: { key?: string; paths?: string[]; path?: string }) => {
    if (method === 'settings.get') {
      if (req?.key === 'recentProjects') return { settings: { recentProjects: recent, recentProjectsFixedOrder: true } }
      if (req?.key === 'hiddenWorktrees') return { settings: { hiddenWorktrees: hidden } }
      if (req?.key === 'recentProjectsFixedOrder') return { settings: { recentProjectsFixedOrder: true } }
      return { settings: {} }
    }
    if (method === 'project.hide') {
      hidden = [...hidden, ...(req?.paths || [])]
      return { ok: true, hiddenProjects: hidden }
    }
    if (method === 'project.restoreRecent') {
      hidden = hidden.filter((p) => p !== req?.path)
      if (req?.path && !recent.includes(req.path)) recent = [req.path, ...recent]
      return { ok: true, recentProjects: recent, hiddenProjects: hidden }
    }
    if (method === 'desktop.gitWorktrees') return { ok: true, repositoryPath: null, trees: [] } satisfies GitWorktreeList
    if (method === 'workspace.sandbox.list') return { sandboxes: [] }
    if (method === 'session.list') return { sessions: [] }
    return { ok: true }
  })
})

function sidebar() {
  return render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

describe('hidden projects', () => {
  it('follows the main-process hidden list, and a re-added project comes back on its own', async () => {
    sidebar()
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy())

    // 隐藏列表（主进程）里多了一个 B → 侧栏收起 B
    hidden = ['/proj/B']
    await act(async () => {
      dispatchHiddenChanged()
    })
    await settle()
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByText('B')).toBeNull()

    // 用户再次主动添加同一个文件夹：主进程 addRecentProject 会解除隐藏 → 侧栏必须跟着显示
    hidden = []
    await act(async () => {
      dispatchHiddenChanged()
    })
    await settle()
    await waitFor(() => expect(screen.getByText('B')).toBeTruthy())
  })

  it('keeps the active project visible even when a stale hidden list still contains it', async () => {
    hidden = ['/proj/A']
    useUIStore.setState({ currentWorkspace: '/proj/A' })
    sidebar()
    // A 是当前项目：即使隐藏列表里还残留它，也不允许从侧栏消失
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy())
  })

  it('migrates the legacy localStorage hidden list into the main process once', async () => {
    localStorage.setItem('pi-desktop:hidden-projects', JSON.stringify(['/proj/B']))
    sidebar()
    await settle()
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('project.hide', { paths: ['/proj/B'] }),
    )
    expect(localStorage.getItem('pi-desktop:hidden-projects')).toBeNull()
  })
})
