import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { TreePanel } from './tree-panel'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { requestTimelineViewEntry } from '@renderer/features/timeline/timeline-view-jump'

vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))
vi.mock('@renderer/features/timeline/timeline-view-jump', () => ({
  requestTimelineViewEntry: vi.fn(),
}))

const nodes = [
  { id: 'u1', depth: 0, entryType: 'message', role: 'user', preview: '第一条用户消息', isLeaf: false },
  { id: 'a1', depth: 1, entryType: 'message', role: 'assistant', preview: '第一条回复', isLeaf: false },
  { id: 'u2', depth: 2, entryType: 'message', role: 'user', preview: '第二条用户消息', isLeaf: false },
  { id: 'a2', depth: 3, entryType: 'message', role: 'assistant', preview: '第二条回复', isLeaf: true },
]

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  vi.mocked(requestTimelineViewEntry).mockClear()
  vi.mocked(refreshSessionTree).mockClear()
  useUIStore.setState({
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/session.jsonl',
    rewindTreeNodes: nodes as never,
    rewindLoadingTree: false,
    rewindTreeError: undefined,
    rewindKey: '/tmp/proj/session.jsonl',
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('TreePanel refresh behaviour', () => {
  it('refreshes the tree on mount and when the session file changes', () => {
    const refresh = vi.mocked(refreshSessionTree)
    render(<TreePanel />)
    // 树数据是发送时点的快照：即使非空也要在挂载时刷新，
    // 否则「新消息已写入 JSONL 但树未更新」的情况会一直显示旧数据
    expect(refresh).toHaveBeenCalledWith('/tmp/proj/session.jsonl')

    act(() => useUIStore.setState({ historySessionFile: '/other/session.jsonl' }))
    expect(refresh).toHaveBeenLastCalledWith('/other/session.jsonl')
  })
})

describe('TreePanel user-only filter', () => {
  it('shows the user-only filter as a selected radio and filters out replies', () => {
    render(<TreePanel />)
    const chip = screen.getByRole('radio', { name: '提问轮次' })
    expect(chip).toHaveAttribute('aria-checked', 'true')

    expect(screen.getByRole('button', { name: /第一条用户消息/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /第一条回复/i })).toBeNull()
  })

  // The tree used to jump the timeline on a single click and rewind on a double click; it now
  // opens the node detail dialog, where Continue / Ask again / Fork are explicit choices.
  it('clicking a user row opens the node detail instead of moving the conversation', () => {
    render(<TreePanel />)
    fireEvent.click(screen.getByRole('button', { name: /第一条用户消息/i }))

    expect(document.querySelector('[data-session-node-detail]')).not.toBeNull()
    expect(requestTimelineViewEntry).not.toHaveBeenCalled()
    expect(navigateSessionToEntry).not.toHaveBeenCalled()
  })

  // 「从此开子分支」是树上的主动作：不打开详情、直接回到该轮之前（原文回填输入框），
  // 发送后即在同一 jsonl 里形成兄弟分支。Fork 到新会话降级到详情次按钮与侧栏右键。
  it('branching straight from a question card rewinds to that turn', () => {
    render(<TreePanel />)
    const branchButtons = screen.getAllByRole('button', { name: '从此开子分支' })
    expect(branchButtons.length).toBeGreaterThan(0)

    fireEvent.click(branchButtons[0])

    expect(navigateSessionToEntry).toHaveBeenCalledWith('u1')
    expect(document.querySelector('[data-session-node-detail]')).toBeNull()
  })
})
