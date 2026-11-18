import { toast } from 'sonner'
import { isAbortUiHoldActive } from '@renderer/lib/abort-ui-hold'
import { ipcClient } from '@renderer/lib/ipc-client'
import { extensionUiBlocksComposer } from '@renderer/stores/extension-ui-store'
import { useSessionGoalStore } from '@renderer/stores/session-goal-store'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  decideGoalLoop,
  goalContinuationPrompt,
  parseGoalProgress,
  type GoalLoopState,
  type SessionGoal,
} from '@shared/session-goal'
import i18n from '@renderer/lib/i18n'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

/**
 * 目标自动循环（渲染层驱动）。
 *
 * 一轮结束（run 回到 idle）且目标还有未达成项时，自动发一条「继续推进目标」的 prompt。
 * 刹车用 `decideGoalLoop`：连续 3 轮 remaining 没下降就停（还有轮数上限），
 * 停止后不再自动发；用户勾选/改目标/手动发消息后重新开始计数。
 *
 * 进度从模型自己汇报的 `GOAL-PROGRESS: 1,3` 行读（约定写在注入的 goal section 里），
 * 由主进程落盘 —— 这里不猜完成度。
 */

/** 一轮结束后等一拍再续：让本轮收尾事件（diff / 标题 / 用量）先落地，也给用户按停的机会。 */
export const GOAL_LOOP_SETTLE_DELAY_MS = 800

export type GoalLoopOutcome = 'idle' | 'blocked' | 'continue' | 'done' | 'stalled' | 'capped'

export type GoalRoundRuntime = {
  getSessionFile: () => string | null
  getGoal: () => SessionGoal | null
  /** 本轮（刚刚结束的那一轮）最后一条 assistant 正文。 */
  getLastAssistantText: () => string
  /** 现在不该自动发消息（还在跑 / 用户刚按停 / 压缩中 / 扩展弹窗挡着输入）。 */
  isBlocked: () => boolean
  markDone: (indices: number[]) => Promise<SessionGoal | null>
  send: (text: string, sessionFile: string) => Promise<void>
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

  const indices = parseGoalProgress(runtime.getLastAssistantText(), goal.criteria.length)
  if (indices && indices.length > 0) await runtime.markDone(indices)
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

  loopStates.set(sessionFile, { ...next, goalText: latest.goal })
  await runtime.send(goalContinuationPrompt(remaining), sessionFile)
  return 'continue'
}

function lastAssistantText(): string {
  const items = useUIStore.getState().timelineItems
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.type !== 'assistant-message') continue
    const text = String((item as { text?: string }).text ?? '').trim()
    if (text) return text
  }
  return ''
}

function createRuntime(): GoalRoundRuntime {
  const viewedSession = (): string | null =>
    normalizeSessionFileKey(useUIStore.getState().historySessionFile) || null
  return {
    getSessionFile: () => {
      const store = useSessionGoalStore.getState()
      const session = viewedSession()
      return session && store.sessionFile === session ? session : null
    },
    getGoal: () => {
      const store = useSessionGoalStore.getState()
      const session = viewedSession()
      if (!session || store.sessionFile !== session) return null
      return store.goal
    },
    getLastAssistantText: lastAssistantText,
    isBlocked: () => {
      const ui = useUIStore.getState()
      if (ui.runState.status !== 'idle') return true
      // 用户刚敲了一条还没落到 run 状态（乐观行）：别抢在用户消息之前自动续。
      if (ui.optimisticPendingUserText) return true
      const session = ui.historySessionFile
      if (session && isAbortUiHoldActive(session)) return true
      if (session && ui.compactingSessions[session]) return true
      return extensionUiBlocksComposer()
    },
    markDone: (indices) => useSessionGoalStore.getState().markCriteriaDone(indices),
    send: async (text, sessionFile) => {
      await ipcClient.invoke('prompt.send', { sessionFile, text })
    },
    notify: ({ kind, remaining }) => {
      const t = i18n.t.bind(i18n)
      if (kind === 'done') {
        toast.success(t('goal:bar.done'))
        return
      }
      toast.message(kind === 'capped' ? t('goal:bar.loopCapped', { count: remaining }) : t('goal:bar.loopStalled', { count: remaining }))
    },
  }
}

/**
 * 挂到 UI store 上：只在「running → idle」这一次真实收尾时触发，且同一次收尾只排一个定时器。
 * 返回卸载函数（app 卸载 / 测试用）。
 */
export function installGoalAutoLoop(runtime: GoalRoundRuntime = createRuntime()): () => void {
  let lastStatus = useUIStore.getState().runState.status
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let inFlight = false

  const unsubscribe = useUIStore.subscribe((state) => {
    const status = state.runState.status
    const settled = lastStatus === 'running' && status === 'idle'
    lastStatus = status
    if (!settled || disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (disposed || inFlight) return
      inFlight = true
      void runGoalRound(runtime)
        .catch((error) => console.warn('[GoalAutoLoop] round failed:', error))
        .finally(() => {
          inFlight = false
        })
    }, GOAL_LOOP_SETTLE_DELAY_MS)
  })

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
