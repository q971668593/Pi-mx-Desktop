import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { GoalBar } from './goal-bar'
import { useSessionGoalStore } from '@renderer/stores/session-goal-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { GoalLoopProgress, SessionGoal } from '@shared/session-goal'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))

const sessionFile = '/sessions/goal.jsonl'

function loopProgress(overrides: Partial<GoalLoopProgress> = {}): GoalLoopProgress {
  return {
    rounds: 0,
    stalledRounds: 0,
    lastRemaining: 1,
    lastAdvancedAt: null,
    lastContinuedAt: null,
    stopReason: null,
    ...overrides,
  }
}


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

  it('stays hidden until a goal is set elsewhere (e.g. the goal command)', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') return { goal: null }
      return {}
    })
    const { container } = render(<GoalBar />)
    await act(async () => {})
    expect(container.querySelector('[data-goal-bar]')).toBeNull()
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
    // 两段式：第一下只进入确认态，不发 IPC——误点一下不该把目标（以及注入给模型的 goal 段）抹掉
    expect(mocks.invoke).not.toHaveBeenCalledWith('sessionGoal.clear', { sessionFile })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认清除' }))
    })
    expect(mocks.invoke).toHaveBeenCalledWith('sessionGoal.clear', { sessionFile })
    // 清掉之后整条收起，不占位（不再回落到占位按钮）。
    await waitFor(() => expect(screen.queryByText('首页 banner 抽成组件')).toBeNull())
  })


  it('shows "等待续跑" while auto-run is on but no round is running', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') return { goal: storedGoal({ autoRun: true }) }
      return {}
    })
    await renderLoadedBar()
    // 徽标不再恒真：开关开着、本轮没跑 → 等待续跑
    expect(screen.getByText('等待续跑')).toBeInTheDocument()
    expect(screen.queryByText('本轮进行中')).toBeNull()
  })

  it('pauses through IPC and remembers why it stopped', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') return { goal: storedGoal({ autoRun: true }) }
      if (channel === 'sessionGoal.setAutoRun') {
        return { goal: storedGoal({ autoRun: false, loop: loopProgress({ stopReason: 'manual' }) }), started: false }
      }
      return {}
    })
    await renderLoadedBar()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    })
    expect(mocks.invoke).toHaveBeenCalledWith('sessionGoal.setAutoRun', {
      sessionFile,
      enabled: false,
      stopReason: 'manual',
    })
    await waitFor(() => expect(screen.getByText('已暂停')).toBeInTheDocument())
  })

  it('starts again from the paused state and asks the main process to run a round', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') return { goal: storedGoal() }
      if (channel === 'sessionGoal.setAutoRun') {
        return { goal: storedGoal({ autoRun: true }), started: true }
      }
      return {}
    })
    await renderLoadedBar()
    expect(screen.getByText('已暂停')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '开始' }))
    })
    expect(mocks.invoke).toHaveBeenCalledWith('sessionGoal.setAutoRun', {
      sessionFile,
      enabled: true,
    })
    await waitFor(() => expect(screen.getByText('等待续跑')).toBeInTheDocument())
  })

  it('reports the stale round count and the stop reason after the brake fires', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') {
        return {
          goal: storedGoal({
            autoRun: false,
            loop: loopProgress({ rounds: 4, stalledRounds: 3, stopReason: 'stalled' }),
          }),
        }
      }
      return {}
    })
    await renderLoadedBar()
    expect(screen.getByText('已停手')).toBeInTheDocument()
    expect(screen.getByText(/第 4\/20 轮/)).toBeInTheDocument()
    // 停手原因挂在徽标 title 上（悬停可读），不在条上另起一行
    expect(screen.getByText('已停手')).toHaveAttribute(
      'title',
      '自动循环已暂停：连续几轮没有进展，还剩 1 项未达成',
    )
  })

  it('keeps the delete control available after the goal is reached', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sessionGoal.get') {
        return {
          goal: storedGoal({
            criteria: [
              { text: '背景图已生成', done: true },
              { text: '高度 700px', done: true },
            ],
          }),
        }
      }
      return {}
    })
    await renderLoadedBar()
    // 达成之后不再显示开始/暂停（没有可推进的东西），但删除必须还在
    expect(screen.queryByRole('button', { name: '开始' })).toBeNull()
    expect(screen.getByRole('button', { name: '清除目标' })).toBeInTheDocument()
  })

  it('renders nothing without a bound session', async () => {
    useUIStore.setState({ historySessionFile: null })
    const { container } = render(<GoalBar />)
    await act(async () => {})
    expect(container.querySelector('[data-goal-bar]')).toBeNull()
  })
})
