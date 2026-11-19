import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTreeOverlay } from './session-tree-overlay'
import { useUIStore } from '@renderer/stores/ui-store'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'

vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))
vi.mock('@renderer/features/timeline/timeline-view-jump', () => ({
  requestTimelineViewEntry: vi.fn(),
}))

const nodes = [
  { id: 'u1', depth: 0, entryType: 'message', role: 'user', preview: '第一条用户消息', isLeaf: false },
  { id: 'a1', depth: 1, entryType: 'message', role: 'assistant', preview: '第一条回复', isLeaf: true },
]

const rAF = () => new Promise((r) => requestAnimationFrame(() => r(null)))

beforeEach(() => {
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
  vi.clearAllMocks()
})

describe('SessionTreeOverlay interaction', () => {
  it('Escape closes the overlay', () => {
    const onClose = vi.fn()
    render(<SessionTreeOverlay open onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('clicking a node opens the node detail, and Escape closes the detail before the overlay', () => {
    const onClose = vi.fn()
    render(<SessionTreeOverlay open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /第一条用户消息/i }))
    expect(document.querySelector('[data-session-node-detail]')).not.toBeNull()

    // The dialog owns Escape while it is open, so the overlay behind it stays put.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the node detail offers an explicit continue action instead of a click gesture', async () => {
    const onClose = vi.fn()
    render(<SessionTreeOverlay open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /第一条用户消息/i }))
    // 树上的主动作是「从此开子分支」（= 回到该轮之前 + 原文回填），Fork 新会话只是次按钮。
    const detail = document.querySelector('[data-session-node-detail]') as HTMLElement
    fireEvent.click(within(detail).getByRole('button', { name: /Branch from here|从此开子分支/i }))
    await rAF()

    expect(navigateSessionToEntry).toHaveBeenCalledWith('u1')
    expect(onClose).toHaveBeenCalled()
  })
})
