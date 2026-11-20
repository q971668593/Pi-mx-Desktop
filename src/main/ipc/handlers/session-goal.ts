import { z } from 'zod'
import { goalContinuationPrompt } from '@shared/session-goal'
import { registerHandlerWithSchema } from '../registry'
import { getSessionGoalStore } from '../../session-goals-instance'
import { workerManager } from '../../worker-manager'
import {
  sessionGoalClearSchema,
  sessionGoalGetSchema,
  sessionGoalMarkDoneSchema,
  sessionGoalSetSchema,
  sessionGoalToggleCriterionSchema,
} from '../schemas'

/**
 * 目标条 IPC（app 私有状态，见 src/main/session-goals.ts）。
 *
 * 每次写入都把渲染好的 goal 段推给该会话还活着的 worker：下一次 turn 的 system prompt
 * 立即带上新目标，而不用等下一次 prompt 才对齐。没有 worker 时什么都不做——下次发
 * prompt 时 prompt.send 会补推（见 handlers/prompt.ts 的 applyGoal）。
 */
export function registerSessionGoalHandlers(): void {
  const pushToLiveWorker = async (sessionFile: string): Promise<void> => {
    const section = getSessionGoalStore().promptSection(sessionFile)
    try {
      await workerManager.setGoal(section, sessionFile)
    } catch (error) {
      // 目标写盘已经成功：worker 没收到只影响这一轮注入，下次 prompt 会补上。
      console.warn('[IPC:sessionGoal] push to worker failed:', error)
    }
  }

  registerHandlerWithSchema('ipc:sessionGoal.get', sessionGoalGetSchema, async (req) => {
    return { goal: getSessionGoalStore().get(req.sessionFile) }
  })

  registerHandlerWithSchema('ipc:sessionGoal.set', sessionGoalSetSchema, async (req) => {
    const goal = getSessionGoalStore().set({
      sessionFile: req.sessionFile,
      goal: req.goal,
      criteria: req.criteria,
    })
    if (!goal) throw new Error('Invalid session goal: empty goal text')
    await pushToLiveWorker(req.sessionFile)
    return { goal }
  })

  registerHandlerWithSchema('ipc:sessionGoal.toggleCriterion', sessionGoalToggleCriterionSchema, async (req) => {
    const goal = getSessionGoalStore().toggleCriterion(req.sessionFile, req.index)
    if (!goal) throw new Error('No session goal for this session')
    await pushToLiveWorker(req.sessionFile)
    return { goal }
  })

  registerHandlerWithSchema('ipc:sessionGoal.markDone', sessionGoalMarkDoneSchema, async (req) => {
    const store = getSessionGoalStore()
    if (req.expectedUpdatedAt !== undefined && store.get(req.sessionFile)?.updatedAt !== req.expectedUpdatedAt) {
      return { goal: null }
    }
    const before = store.remaining(req.sessionFile)
    const goal = store.markCriteriaDone(req.sessionFile, req.indices)
    if (!goal) throw new Error('No session goal for this session')
    // 只有真的变了才推：模型反复汇报同一批序号时不该每轮重写 system prompt section。
    if (store.remaining(req.sessionFile) !== before) await pushToLiveWorker(req.sessionFile)
    return { goal }
  })

  registerHandlerWithSchema('ipc:sessionGoal.continue', sessionGoalGetSchema.extend({
    runId: z.string().min(1).max(200),
    expectedUpdatedAt: z.number().int().nonnegative(),
  }), async ({ sessionFile, runId, expectedUpdatedAt }) => {
    const store = getSessionGoalStore()
    const remaining = store.remaining(sessionFile)
    if (!remaining || store.get(sessionFile)?.updatedAt !== expectedUpdatedAt) return { sent: false }
    const sent = await workerManager.continueGoal(sessionFile, runId, goalContinuationPrompt(remaining), expectedUpdatedAt)
    return { sent }
  })

  /**
   * 「再次启动目标」：把未完成的验收项拼成续跑提示，直接发一轮。
   * 不依赖上一轮的 runId，所以暂停很久之后也能重新开始。
   */
  registerHandlerWithSchema('ipc:sessionGoal.resume', sessionGoalGetSchema, async ({ sessionFile }) => {
    const store = getSessionGoalStore()
    const goal = store.get(sessionFile)
    if (!goal) return { sent: false, reason: 'no_goal' as const }
    const remaining = store.remaining(sessionFile)
    if (!remaining) return { sent: false, reason: 'done' as const }
    if (!workerManager.hasLiveSessionWorker(sessionFile)) return { sent: false, reason: 'cold' as const }
    await workerManager.sendPrompt(goalContinuationPrompt(remaining), sessionFile)
    return { sent: true }
  })

  registerHandlerWithSchema('ipc:sessionGoal.clear', sessionGoalClearSchema, async (req) => {
    const cleared = getSessionGoalStore().clear(req.sessionFile)
    if (cleared) await pushToLiveWorker(req.sessionFile)
    return { cleared }
  })
}
