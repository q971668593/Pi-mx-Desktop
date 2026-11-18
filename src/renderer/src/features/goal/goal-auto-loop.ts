import { toast } from 'sonner'
import { isAbortUiHoldActive } from '@renderer/lib/abort-ui-hold'
import { ipcClient } from '@renderer/lib/ipc-client'
import { extensionUiBlocksComposer } from '@renderer/stores/extension-ui-store'
import { useSessionGoalStore } from '@renderer/stores/session-goal-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { AppEvent } from '@shared/app-events'
import {
  decideGoalLoop,
  goalContinuationPrompt,
  type GoalLoopState,
  type SessionGoal,
} from '@shared/session-goal'
import i18n from '@renderer/lib/i18n'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

/**
 * 目标自动循环由 Worker 的成功完成事件触发。等待收尾时，用户可以暂停续跑。
 * 刹车用 `decideGoalLoop`：连续 3 轮 remaining 没下降就停（还有轮数上限），
 * 停止后不再自动发；用户勾选/改目标/手动发消息后重新开始计数。
 *
 * Worker 从模型自己汇报的 `GOAL-PROGRESS: 1,3` 行读（约定写在注入的 goal section 里），
 * 由主进程落盘 —— 这里不猜完成度。
 */

/** 一轮结束后等一拍再续：让本轮收尾事件（diff / 标题 / 用量）先落地，也给用户按停的机会。 */
export const GOAL_LOOP_SETTLE_DELAY_MS = 800

export type GoalLoopOutcome = 'idle' | 'blocked' | 'continue' | 'done' | 'stalled' | 'capped'

export type GoalRoundRuntime = {
  getSessionFile: () => string | null
  getGoal: () => SessionGoal | null
  reportedIndices: number[]
  /** 现在不该自动发消息（还在跑 / 用户刚按停 / 压缩中 / 扩展弹窗挡着输入）。 */
  isBlocked: () => boolean
  markDone: (indices: number[]) => Promise<SessionGoal | null>
  send: (text: string, sessionFile: string) => Promise<boolean | void>
  notify: (event: { kind: 'done' | 'stalled' | 'capped'; remaining: number }) => void
}

type LoopRecord = GoalLoopState & { goalText: string }

const loopStates = new Map<string, LoopRecord>()

export function goalLoopStateForTest(sessionFile: string): LoopRecord | undefined {
  return loopStates.get(sessionFile)
}

export function resetGoalLoopStates(): void {
  loopStates.clear()
}

function remainingOf(goal: SessionGoal): number {
  return goal.criteria.filter((criterion) => !criterion.done).length
}

/** 跑一轮判定：先吸收模型汇报的进度，再过刹车表，决定「继续/停」。 */
export async function runGoalRound(runtime: GoalRoundRuntime): Promise<GoalLoopOutcome> {
  const sessionFile = runtime.getSessionFile()
  const goal = runtime.getGoal()
  if (!sessionFile || !goal) {
    if (sessionFile) loopStates.delete(sessionFile)
    return 'idle'
  }
  // 编辑过目标文本 = 换了一个目标，旧的刹车计数不再适用。
  const prior = loopStates.get(sessionFile)
  const state = prior && prior.goalText === goal.goal ? prior : null
  const before = remainingOf(goal)

  if (runtime.reportedIndices.length > 0) await runtime.markDone(runtime.reportedIndices)
  // 目标可能在上一轮里被清掉/改掉：以最新状态为准，不能拿旧快照续跑。
  const latest = runtime.getGoal()
  if (!latest) {
    loopStates.delete(sessionFile)
    return 'idle'
  }
  const remaining = remainingOf(latest)

  if (runtime.isBlocked()) return 'blocked'

  const { decision, next } = decideGoalLoop({ remaining, previous: state })
  if (decision === 'done') {
    loopStates.delete(sessionFile)
    // 只在「本来是开着、这轮关上了」时提示，避免每轮都弹一次「目标已达成」。
    if (before > 0 || (state?.lastRemaining ?? 0) > 0) runtime.notify({ kind: 'done', remaining })
    return 'done'
  }
  if (decision === 'stalled' || decision === 'capped') {
    loopStates.delete(sessionFile)
    runtime.notify({ kind: decision, remaining })
    return decision
  }

  const sent = await runtime.send(goalContinuationPrompt(remaining), sessionFile)
  if (sent === false) return 'blocked'
  loopStates.set(sessionFile, { ...next, goalText: latest.goal })
  return 'continue'
}

type GoalRun = {
  id: string
  version: number
  goal: Promise<SessionGoal | null>
  indices: number[]
  timer?: ReturnType<typeof setTimeout>
}

export function installGoalAutoLoop() {
  const runs = new Map<string, GoalRun>()
  let disposed = false

  const forget = (sessionFile: string) => {
    clearTimeout(runs.get(sessionFile)?.timer)
    runs.delete(sessionFile)
  }

  function observe(event: AppEvent) {
    if (disposed || (event.type !== 'run' && event.type !== 'completion') || !event.runId) return
    const sessionFile = normalizeSessionFileKey(event.sessionFile || '')
    if (!sessionFile) return
    const current = runs.get(sessionFile)
    const version = useSessionGoalStore.getState().autoRun[sessionFile]
    if (event.type === 'run' && (event.phase === 'started' || event.phase === 'running')) {
      if (current?.id === event.runId) return
      forget(sessionFile)
      if (version === undefined) return
      const goal = ipcClient.invoke('sessionGoal.get', { sessionFile })
        .then((result) => (result?.goal ?? null) as SessionGoal | null)
        .catch(() => null)
      runs.set(sessionFile, { id: event.runId, version, goal, indices: [] })
      return
    }
    if (!current || current.id !== event.runId) return
    if (event.type === 'run') {
      if (event.phase === 'cancelled' || event.phase === 'failed') forget(sessionFile)
      if (event.phase === 'idle' && event.settled) current.indices = event.goalProgress ?? []
      return
    }
    if (event.outcome !== 'success' || current.timer) return
    current.timer = setTimeout(() => void finish(sessionFile, current), GOAL_LOOP_SETTLE_DELAY_MS)
  }

  async function finish(sessionFile: string, run: GoalRun) {
    const valid = () => !disposed && runs.get(sessionFile) === run
      && useSessionGoalStore.getState().autoRun[sessionFile] === run.version
    const blocked = () => {
      const ui = useUIStore.getState()
      const visible = normalizeSessionFileKey(ui.historySessionFile || '') === sessionFile
      return !valid() || isAbortUiHoldActive(sessionFile) || !!ui.compactingSessions[sessionFile]
        || (visible && (!!ui.optimisticPendingUserText || extensionUiBlocksComposer()))
    }
    try {
      let goal = await run.goal
      if (!goal || blocked()) return
      const latest = await ipcClient.invoke('sessionGoal.get', { sessionFile })
      if (blocked() || latest?.goal?.updatedAt !== goal.updatedAt) return
      const result = await runGoalRound({
        getSessionFile: () => sessionFile,
        getGoal: () => goal,
        reportedIndices: run.indices,
        isBlocked: blocked,
        markDone: async (indices) => {
          const response = await ipcClient.invoke('sessionGoal.markDone', {
            sessionFile, indices, expectedUpdatedAt: goal?.updatedAt,
          })
          goal = response?.goal ?? null
          const view = useSessionGoalStore.getState()
          if (goal && view.sessionFile === sessionFile) view.applyGoal(goal)
          return goal
        },
        send: async () => {
          if (!goal || blocked()) return false
          const response = await ipcClient.invoke('sessionGoal.continue', {
            sessionFile, runId: run.id, expectedUpdatedAt: goal.updatedAt,
          })
          return response?.sent === true
        },
        notify: ({ kind, remaining }) => {
          const t = i18n.t.bind(i18n)
          if (kind === 'done') toast.success(t('goal:bar.done'))
          else toast.message(t(kind === 'capped' ? 'goal:bar.loopCapped' : 'goal:bar.loopStalled', { count: remaining }))
        },
      })
      if (result === 'done' || result === 'stalled' || result === 'capped') {
        if (valid()) useSessionGoalStore.getState().setAutoRun(sessionFile, false)
      }
    } catch (error) {
      console.warn('[GoalAutoLoop] round failed:', error)
    } finally {
      if (runs.get(sessionFile) === run) forget(sessionFile)
    }
  }

  const unsubscribe = useSessionGoalStore.subscribe((state, previous) => {
    if (state.autoRun === previous.autoRun) return
    for (const sessionFile of Object.keys(previous.autoRun)) {
      if (state.autoRun[sessionFile] !== previous.autoRun[sessionFile]) {
        forget(sessionFile)
        loopStates.delete(sessionFile)
      }
    }
  })

  return {
    observe,
    dispose() {
      disposed = true
      unsubscribe()
      for (const sessionFile of runs.keys()) forget(sessionFile)
    },
  }
}
