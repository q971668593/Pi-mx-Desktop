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
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
  useUIStore.setState({ timelineItems: [], currentSessionId: 's1' })
})
afterEach(cleanup)

describe('DelegateAgentStrip', () => {
  it('renders nothing when the session never delegated', () => {
    const { container } = render(<DelegateAgentStrip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('counts running subagents and lists them once expanded', async () => {
    useUIStore.setState({
      timelineItems: [delegateItem({ id: 'a', runId: 'del_1' }), delegateItem({ id: 'b', runId: 'del_2' })],
    })
    render(<DelegateAgentStrip />)
    expect(screen.getByText('2 个子 Agent 在跑')).toBeInTheDocument()
    // 有子 Agent 在跑时自动展开，行直接可见
    await waitFor(() => expect(screen.getAllByTitle(/看代码/)).toHaveLength(2))
  })

  it('opens the subagent session of the clicked row', async () => {
    useUIStore.setState({ timelineItems: [delegateItem({ id: 'a', runId: 'del_1' })] })
    render(<DelegateAgentStrip />)
    const row = await screen.findByTitle(/看代码/)
    fireEvent.click(row)
    await waitFor(() => expect(mocks.openDelegateSessionPreview).toHaveBeenCalledTimes(1))
    expect(mocks.openDelegateSessionPreview.mock.calls[0][0]).toMatchObject({ runId: 'del_1', agent: 'researcher' })
  })

  it('shows finished subagents after they are done', async () => {
    useUIStore.setState({
      timelineItems: [delegateItem({ id: 'a', runId: 'del_1', status: 'completed' })],
    })
    render(<DelegateAgentStrip />)
    expect(screen.getByText('1 个子 Agent 已完成')).toBeInTheDocument()
    // 没有在跑的不自动展开，点一下才展开
    expect(screen.queryByTitle(/看代码/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /1 个子 Agent 已完成/ }))
    await waitFor(() => expect(screen.getByTitle(/看代码/)).toBeInTheDocument())
  })

  it('hides the previous session subagents after switching sessions', async () => {
    useUIStore.setState({ timelineItems: [delegateItem({ id: 'a', runId: 'del_1' })] })
    render(<DelegateAgentStrip />)
    await waitFor(() => expect(screen.getByTitle(/看代码/)).toBeInTheDocument())
    useUIStore.setState({ timelineItems: [], currentSessionId: 's2' })
    await waitFor(() => expect(screen.queryByText(/个子 Agent/)).toBeNull())
  })
})
