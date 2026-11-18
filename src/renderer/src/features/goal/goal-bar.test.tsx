import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { GoalBar } from './goal-bar'
import { useSessionGoalStore } from '@renderer/stores/session-goal-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionGoal } from '@shared/session-goal'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))

const sessionFile = '/sessions/goal.jsonl'

function storedGoal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    sessionFile,
    goal: '首页 banner 抽成组件',
    criteria: [
      { text: '背景图已生成', done: false },
      { text: '高度 700px', done: true },
    ],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
  useUIStore.setState({ historySessionFile: sessionFile })
  useSessionGoalStore.setState({ sessionFile: null, goal: null, loading: false, error: null })
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'sessionGoal.get') return { goal: storedGoal() }
    return {}
  })
})
afterEach(cleanup)

async function renderLoadedBar() {
  render(<GoalBar />)
  return screen.findByText('首页 banner 抽成组件')
}

describe('GoalBar', () => {
  it('loads the goal of the viewed session and shows what is left', async () => {
    await renderLoadedBar()
    expect(mocks.invoke).toHaveBeenCalledWith('sessionGoal.get', { sessionFile })
    expect(screen.getByText('还剩 1 项未达成')).toBeInTheDocument()
    expect(screen.getByText('背景图已生成')).toBeInTheDocument()
  })

  it('ticks a criterion through IPC instead of guessing locally', async () => {
    const done: SessionGoal = storedGoal({
      criteria: [
        { text: '背景图已生成', done: true },
        { text: '高度 700px', done: true },
      ],
    })
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') return { goal: storedGoal() }
      if (channel === 'sessionGoal.toggleCriterion') return { goal: done }
      return {}
    })
    await renderLoadedBar()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(screen.getByText('目标已达成')).toBeInTheDocument())
    expect(mocks.invoke).toHaveBeenCalledWith('sessionGoal.toggleCriterion', { sessionFile, index: 0 })
  })

  it('creates a goal from the placeholder entry, one criterion per line', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') return { goal: null }
      if (channel === 'sessionGoal.set') return { goal: storedGoal({ goal: '完成登录页', criteria: [] }) }
      return {}
    })
    render(<GoalBar />)
    fireEvent.click(await screen.findByText('这个会话要达成什么？（一句话）'))
    fireEvent.change(screen.getByLabelText('这个会话要达成什么？（一句话）'), { target: { value: ' 完成登录页 ' } })
    fireEvent.change(screen.getByLabelText('验收项（每行一条，事后可勾选）'), {
      target: { value: '表单校验\n\n记住我\n表单校验' },
    })
    fireEvent.click(screen.getByRole('button', { name: '设定目标' }))
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('sessionGoal.set', {
        sessionFile,
        goal: '完成登录页',
        criteria: ['表单校验', '记住我'],
      }),
    )
    expect(await screen.findByText('完成登录页')).toBeInTheDocument()
  })

  it('copies the goal and its ticked state, and clears it again', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') return { goal: storedGoal() }
      if (channel === 'sessionGoal.clear') return { cleared: true }
      return {}
    })
    await renderLoadedBar()
    fireEvent.click(screen.getByRole('button', { name: '复制目标与验收项' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('首页 banner 抽成组件\n\n[ ] 背景图已生成\n[x] 高度 700px'),
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '清除目标' }))
    })
    expect(mocks.invoke).toHaveBeenCalledWith('sessionGoal.clear', { sessionFile })
    await waitFor(() => expect(screen.getByText('这个会话要达成什么？（一句话）')).toBeInTheDocument())
  })

  it('renders nothing without a bound session', async () => {
    useUIStore.setState({ historySessionFile: null })
    const { container } = render(<GoalBar />)
    await act(async () => {})
    expect(container.querySelector('[data-goal-bar]')).toBeNull()
  })
})
