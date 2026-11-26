import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { DelegateAgentStrip } from './delegate-agent-strip'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const mocks = vi.hoisted(() => ({ openDelegateSessionPreview: vi.fn() }))
vi.mock('@renderer/lib/delegate-session-navigation', () => ({
  openDelegateSessionPreview: mocks.openDelegateSessionPreview,
}))

function delegateItem(overrides: {
  id: string
  runId: string
  agent?: string
  task?: string
  status?: string
  timestamp?: number
}): TimelineItem {
  return {
    id: overrides.id,
    type: 'tool-call',
    toolName: 'acp_delegate',
    timestamp: overrides.timestamp ?? 1_000,
    toolDetails: {
      kind: 'delegate',
      agent: overrides.agent ?? 'researcher',
      runId: overrides.runId,
      task: overrides.task ?? '看代码',
      status: overrides.status ?? 'running',
    },
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.openDelegateSessionPreview.mockResolvedValue(true)
  localStorage.clear()
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
  useUIStore.setState({ timelineItems: [], currentSessionId: 's1' })
})
afterEach(cleanup)

describe('DelegateAgentStrip', () => {
  it('renders nothing when the session never delegated', () => {
    const { container } = render(<DelegateAgentStrip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides everything once all subagents finished', () => {
    useUIStore.setState({
      timelineItems: [delegateItem({ id: 'a', runId: 'del_1', status: 'completed' })],
    })
    const { container } = render(<DelegateAgentStrip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays collapsed on mount and expands on click', async () => {
    useUIStore.setState({
      timelineItems: [delegateItem({ id: 'a', runId: 'del_1' }), delegateItem({ id: 'b', runId: 'del_2' })],
    })
    render(<DelegateAgentStrip />)
    expect(screen.getByText('2 个子 Agent 在跑')).toBeInTheDocument()
    // 挂载时默认收起，进对话不被旧列表糊脸
    expect(screen.queryByTitle(/看代码/)).toBeNull()
    fireEvent.click(screen.getByText('2 个子 Agent 在跑'))
    await waitFor(() => expect(screen.getAllByTitle(/看代码/)).toHaveLength(2))
  })

  it('auto-expands only when a new run shows up', async () => {
    useUIStore.setState({ timelineItems: [delegateItem({ id: 'a', runId: 'del_1' })] })
    render(<DelegateAgentStrip />)
    expect(screen.queryByTitle(/看代码/)).toBeNull()
    useUIStore.setState({
      timelineItems: [
        delegateItem({ id: 'a', runId: 'del_1' }),
        delegateItem({ id: 'b', runId: 'del_2', task: '新任务' }),
      ],
    })
    await waitFor(() => expect(screen.getByTitle(/新任务/)).toBeInTheDocument())
  })

  it('opens the subagent session of the clicked row', async () => {
    useUIStore.setState({ timelineItems: [delegateItem({ id: 'a', runId: 'del_1' })] })
    render(<DelegateAgentStrip />)
    fireEvent.click(screen.getByText('1 个子 Agent 在跑'))
    const row = await screen.findByTitle(/看代码/)
    fireEvent.click(row)
    await waitFor(() => expect(mocks.openDelegateSessionPreview).toHaveBeenCalledTimes(1))
    expect(mocks.openDelegateSessionPreview.mock.calls[0][0]).toMatchObject({ runId: 'del_1', agent: 'researcher' })
  })

  it('dismisses a stuck run and keeps it hidden', async () => {
    useUIStore.setState({
      timelineItems: [delegateItem({ id: 'a', runId: 'del_1' }), delegateItem({ id: 'b', runId: 'del_2' })],
    })
    render(<DelegateAgentStrip />)
    fireEvent.click(screen.getByText('2 个子 Agent 在跑'))
    const rows = await screen.findAllByTitle(/看代码/)
    expect(rows).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '不再显示这一条' })[0])
    await waitFor(() => expect(screen.getByText('1 个子 Agent 在跑')).toBeInTheDocument())
    // 整条叉掉后条子消失
    fireEvent.click(screen.getByRole('button', { name: '不再显示这一条' }))
    await waitFor(() => expect(screen.queryByText(/个子 Agent 在跑/)).toBeNull())
    // localStorage 记住了，重新挂载也不冒出来
    cleanup()
    render(<DelegateAgentStrip />)
    expect(screen.queryByText(/个子 Agent 在跑/)).toBeNull()
  })

  it('hides the previous session subagents after switching sessions', async () => {
    useUIStore.setState({ timelineItems: [delegateItem({ id: 'a', runId: 'del_1' })] })
    render(<DelegateAgentStrip />)
    expect(screen.getByText('1 个子 Agent 在跑')).toBeInTheDocument()
    useUIStore.setState({ timelineItems: [], currentSessionId: 's2' })
    await waitFor(() => expect(screen.queryByText(/个子 Agent/)).toBeNull())
  })
})
