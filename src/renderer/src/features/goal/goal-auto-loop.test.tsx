import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOAL_LOOP_SETTLE_DELAY_MS,
  goalLoopStateForTest,
  installGoalAutoLoop,
  resetGoalLoopStates,
  runGoalRound,
  type GoalRoundRuntime,
} from './goal-auto-loop'
import { useSessionGoalStore } from '@renderer/stores/session-goal-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionGoal } from '@shared/session-goal'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ipcClient: { invoke: mocks.invoke },
}))

const sessionFile = '/sessions/goal.jsonl'

function goal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    sessionFile,
    goal: '首页 banner 抽成组件',
    criteria: [
      { text: '背景图已生成', done: false },
      { text: '高度 700px', done: false },
    ],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function runtime(overrides: Partial<GoalRoundRuntime> = {}) {
  const calls = { send: [] as string[], notify: [] as string[] }
  let current: SessionGoal | null = goal()
  const base: GoalRoundRuntime = {
    getSessionFile: () => sessionFile,
    getGoal: () => current,
    getLastAssistantText: () => '',
    isBlocked: () => false,
    markDone: async (indices) => {
      current = {
        ...current!,
        criteria: current!.criteria.map((criterion, index) =>
          indices.includes(index + 1) ? { ...criterion, done: true } : criterion,
        ),
      }
      return current
    },
    send: async (text) => {
      calls.send.push(text)
    },
    notify: ({ kind }) => {
      calls.notify.push(kind)
    },
    ...overrides,
  }
  return { runtime: base, calls, setGoal: (next: SessionGoal | null) => { current = next } }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetGoalLoopStates()
  useSessionGoalStore.setState({ sessionFile: null, goal: null, loading: false, error: null })
  useUIStore.setState({ historySessionFile: sessionFile, runState: { status: 'idle', toolCount: 0, errorCount: 0 } })
})
afterEach(() => {
  cleanup()
  resetGoalLoopStates()
  vi.useRealTimers()
})

describe('runGoalRound', () => {
  it('continues the goal when the turn settled with work left', async () => {
    const { runtime: deps, calls } = runtime()
    await expect(runGoalRound(deps)).resolves.toBe('continue')
    expect(calls.send).toHaveLength(1)
    expect(calls.send[0]).toContain('还剩 2 项')
    expect(goalLoopStateForTest(sessionFile)).toMatchObject({ rounds: 1, lastRemaining: 2, stalledRounds: 0 })
  })

  it('absorbs the GOAL-PROGRESS line before deciding, so real progress is not a stall', async () => {
    const { runtime: deps, calls } = runtime({ getLastAssistantText: () => '做完了\nGOAL-PROGRESS: 1' })
    await expect(runGoalRound(deps)).resolves.toBe('continue')
    expect(calls.send[0]).toContain('还剩 1 项')
  })

  it('stops after three rounds without the remaining count dropping', async () => {
    const { runtime: deps, calls } = runtime()
    const outcomes: string[] = []
    for (let round = 0; round < 4; round += 1) outcomes.push(await runGoalRound(deps))
    expect(outcomes).toEqual(['continue', 'continue', 'continue', 'stalled'])
    expect(calls.send).toHaveLength(3)
    expect(calls.notify).toEqual(['stalled'])
    expect(goalLoopStateForTest(sessionFile)).toBeUndefined()
  })

  it('resets the stall counter when a criterion is actually ticked off', async () => {
    const { runtime: deps, calls } = runtime()
    await runGoalRound(deps)
    await runGoalRound(deps)
    expect(goalLoopStateForTest(sessionFile)?.stalledRounds).toBe(1)
    const progressed = runtime({ getLastAssistantText: () => 'GOAL-PROGRESS: 2' })
    await runGoalRound(progressed.runtime)
    expect(goalLoopStateForTest(sessionFile)?.stalledRounds).toBe(0)
    expect(progressed.calls.send[0]).toContain('还剩 1 项')
    expect(calls.send).toHaveLength(2)
  })

  it('reports the goal as reached instead of sending another round', async () => {
    const { runtime: deps, calls } = runtime()
    await runGoalRound(deps)
    deps.getGoal = () => goal({ criteria: [{ text: 'a', done: true }, { text: 'b', done: true }] })
    await expect(runGoalRound(deps)).resolves.toBe('done')
    expect(calls.send).toHaveLength(1)
    expect(calls.notify).toEqual(['done'])
  })

  it('does not repeat the "reached" toast for a goal that was already complete', async () => {
    const { runtime: deps, calls } = runtime()
    deps.getGoal = () => goal({ criteria: [{ text: 'a', done: true }] })
    await expect(runGoalRound(deps)).resolves.toBe('done')
    expect(calls.notify).toHaveLength(0)
    expect(calls.send).toHaveLength(0)
  })

  it('never sends while the session is busy, stopping, compacting or blocked by a dialog', async () => {
    const { runtime: deps, calls } = runtime({ isBlocked: () => true })
    await expect(runGoalRound(deps)).resolves.toBe('blocked')
    expect(calls.send).toHaveLength(0)
    expect(calls.notify).toHaveLength(0)
  })

  it('does nothing without a goal or without a bound session', async () => {
    const noGoal = runtime()
    noGoal.setGoal(null)
    await expect(runGoalRound(noGoal.runtime)).resolves.toBe('idle')
    const noSession = runtime({ getSessionFile: () => null })
    await expect(runGoalRound(noSession.runtime)).resolves.toBe('idle')
    expect(noGoal.calls.send).toHaveLength(0)
    expect(noSession.calls.send).toHaveLength(0)
  })

  it('stops when the goal was cleared while the round was settling', async () => {
    const { runtime: deps, calls } = runtime()
    const first = deps.getGoal
    let reads = 0
    deps.getGoal = () => {
      reads += 1
      return reads === 1 ? first() : null
    }
    await expect(runGoalRound(deps)).resolves.toBe('idle')
    expect(calls.send).toHaveLength(0)
    expect(goalLoopStateForTest(sessionFile)).toBeUndefined()
  })

  it('starts a fresh brake count when the user changes the goal text', async () => {
    const { runtime: deps } = runtime()
    await runGoalRound(deps)
    await runGoalRound(deps)
    expect(goalLoopStateForTest(sessionFile)?.stalledRounds).toBe(1)
    deps.getGoal = () => goal({ goal: '换成移动端适配' })
    await expect(runGoalRound(deps)).resolves.toBe('continue')
    expect(goalLoopStateForTest(sessionFile)?.rounds).toBe(1)
  })
})

describe('installGoalAutoLoop wiring', () => {
  it('turns a settled turn into one continuation prompt, debounced', async () => {
    vi.useFakeTimers()
    mocks.invoke.mockResolvedValue({})
    useSessionGoalStore.setState({ sessionFile, goal: goal(), loading: false, error: null })
    useUIStore.setState({ runState: { status: 'running', toolCount: 0, errorCount: 0 } })
    const uninstall = installGoalAutoLoop()
    try {
      await act(async () => {
        useUIStore.setState({ runState: { status: 'idle', toolCount: 0, errorCount: 0 } })
        await vi.advanceTimersByTimeAsync(GOAL_LOOP_SETTLE_DELAY_MS + 20)
      })
      expect(mocks.invoke).toHaveBeenCalledWith('prompt.send', {
        sessionFile,
        text: expect.stringContaining('继续推进本会话目标'),
      })
    } finally {
      uninstall()
    }
  })

  it('drops the continuation if a new turn started during the settle delay', async () => {
    vi.useFakeTimers()
    mocks.invoke.mockResolvedValue({})
    useSessionGoalStore.setState({ sessionFile, goal: goal(), loading: false, error: null })
    useUIStore.setState({ runState: { status: 'running', toolCount: 0, errorCount: 0 } })
    const uninstall = installGoalAutoLoop()
    try {
      await act(async () => {
        useUIStore.setState({ runState: { status: 'idle', toolCount: 0, errorCount: 0 } })
        useUIStore.setState({ runState: { status: 'running', toolCount: 0, errorCount: 0 } })
        await vi.advanceTimersByTimeAsync(GOAL_LOOP_SETTLE_DELAY_MS + 20)
      })
      expect(mocks.invoke).not.toHaveBeenCalledWith('prompt.send', expect.anything())
    } finally {
      uninstall()
    }
  })
})
