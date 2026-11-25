import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MAX_GOAL_LENGTH,
  emptyGoalLoopProgress,
  goalPromptSection,
  goalRemaining as remainingOf,
  normalizeGoalCriteria,
  normalizeGoalLoopProgress,
  type GoalCriterion,
  type GoalLoopProgress,
  type GoalStopReason,
  type SessionGoal,
} from '@shared/session-goal'
import { normalizeSessionFileKey } from '@shared/session-file-key'

export type { GoalCriterion, SessionGoal }

type GoalFile = { version: 1; goals: Record<string, SessionGoal> }

const MAX_GOALS = 200

/**
 * 写入与**注入**用的键必须是同一个字符串。
 *
 * 渲染层用 `normalizeSessionFileKey`（`C:/a/b.jsonl`），而 `prompt.send` 带的 sessionFile 可能是
 * pi 返回的原生路径（`C:\a\b.jsonl`）。两侧不一致时目标会被存到一个键、用另一个键去查：
 * `promptSection()` 返回 null，worker 的 goal 段被当成「用户清掉了目标」而撤下——
 * 目标条显示正常、模型却从头到尾没见过目标。所以这里统一归一化，存量数据也在 load 时搬家。
 */
function goalKey(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile)
}

function empty(): GoalFile {
  return { version: 1, goals: {} }
}

/** 把存量键收敛到归一化形式（旧版本按原样字符串存，盘里可能是反斜杠路径）。 */
function migrate(parsed: GoalFile): GoalFile {
  const goals: Record<string, SessionGoal> = {}
  for (const [rawKey, goal] of Object.entries(parsed.goals)) {
    if (!goal || typeof goal !== 'object') continue
    const key = goalKey(goal.sessionFile || rawKey)
    if (!key) continue
    const previous = goals[key]
    if (previous && previous.updatedAt > (goal.updatedAt ?? 0)) continue
    goals[key] = normalizeGoal({ ...goal, sessionFile: key })
  }
  return { version: 1, goals }
}

/**
 * 盘里的目标可能来自旧版本（没有 autoRun / loop）或被手改过。
 * 读的时候一律过一遍：坏字段回落默认，别把 NaN 或非法停止原因带到 UI。
 *
 * autoRun 缺省是 false：老目标升上来不该自己突然跑起来 —— 用户得自己点一次开始。
 */
function normalizeGoal(goal: SessionGoal): SessionGoal {
  return {
    ...goal,
    autoRun: goal.autoRun === true,
    loop: goal.loop ? normalizeGoalLoopProgress(goal.loop) : emptyGoalLoopProgress(),
  }
}

/**
 * 目标存储：按会话（sessionFile）保存「用户真正想要的最终状态」。
 *
 * 只存 app 私有状态，不进 pi 的 JSONL，也不进 `~/.pi/agent/settings.json`
 * （那是与终端版共用的配置，塞进去会互相污染）。
 */
export class SessionGoalStore {
  private readonly path: string
  private data: GoalFile | null = null

  constructor(dir: string) {
    this.path = join(dir, 'session-goals.json')
  }

  private load(): GoalFile {
    if (this.data) return this.data
    try {
      const raw = readFileSync(this.path, 'utf8')
      const parsed = JSON.parse(raw) as GoalFile
      if (!parsed || parsed.version !== 1 || typeof parsed.goals !== 'object' || !parsed.goals) {
        this.data = empty()
      } else {
        this.data = migrate(parsed)
      }
    } catch {
      // 文件不存在或损坏：从空开始，不能因为历史数据把 app 拖死
      this.data = empty()
    }
    return this.data
  }

  private persist(): void {
    const data = this.load()
    const keys = Object.keys(data.goals)
    if (keys.length > MAX_GOALS) {
      // 按 updatedAt 淘汰最旧的，避免文件无限增长
      const sorted = keys.sort((a, b) => data.goals[a].updatedAt - data.goals[b].updatedAt)
      for (const key of sorted.slice(0, keys.length - MAX_GOALS)) delete data.goals[key]
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch (error) {
      console.warn('[SessionGoal] 写入失败（忽略）:', error)
    }
  }

  get(sessionFile: string | null | undefined): SessionGoal | null {
    const key = goalKey(sessionFile)
    if (!key) return null
    const goal = this.load().goals[key]
    return goal ? normalizeGoal(goal) : null
  }

  /** 设置/编辑目标；已有验收项按文本保留 done 标记（编辑不该把打过勾的清掉）。 */
  set(input: {
    sessionFile: string | null | undefined
    goal: string
    criteria?: string[]
    now?: number
  }): SessionGoal | null {
    const key = goalKey(input.sessionFile)
    const goal = String(input.goal ?? '').trim().slice(0, MAX_GOAL_LENGTH)
    if (!key || !goal) return null
    const data = this.load()
    const previous = data.goals[key]
    const now = Math.max(input.now ?? Date.now(), (previous?.updatedAt ?? -1) + 1)
    const source = input.criteria ?? previous?.criteria.map((criterion) => criterion.text) ?? []
    const criteria = normalizeGoalCriteria(source).map((text) => {
      const prior = previous?.criteria.find((criterion) => criterion.text === text)
      return { text, done: prior?.done ?? false }
    })
    const next: SessionGoal = {
      sessionFile: key,
      goal,
      criteria,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      // 编辑目标不改变「要不要自动推进」；换了目标文本就把旧的刹车计数清掉。
      autoRun: previous?.autoRun === true,
      loop:
        previous && previous.goal === goal
          ? normalizeGoalLoopProgress(previous.loop)
          : emptyGoalLoopProgress(),
    }
    data.goals[key] = next
    this.persist()
    return next
  }

  /**
   * 自动推进开关。开启时清掉旧的停止原因（用户重新按了开始），
   * 关闭时记下是用户自己按的（区别于刹车停下）。
   *
   * 返回 null = 没有这个目标。
   */
  setAutoRun(
    sessionFile: string | null | undefined,
    enabled: boolean,
    now?: number,
    stopReason?: GoalStopReason,
  ): SessionGoal | null {
    const current = this.get(sessionFile)
    if (!current) return null
    const loop = normalizeGoalLoopProgress(current.loop)
    const next: SessionGoal = {
      ...current,
      autoRun: enabled,
      loop: {
        ...loop,
        stopReason: enabled ? null : stopReason ?? 'manual',
      },
      updatedAt: Math.max(now ?? Date.now(), current.updatedAt + 1),
    }
    return this.replace(current.sessionFile, next)
  }

  /**
   * 记一次自动续跑：轮数 +1，起跑前看到的 remaining 存作下一轮的比较基准。
   * 不改 updatedAt —— 这条不改变目标内容，不该让 goal 段的乐观校验失败。
   * 「有没有推进」由上一轮的 lastRemaining 对比得出，不让渲染层自己算。
   */
  markLoopContinued(
    sessionFile: string | null | undefined,
    input: { rounds: number; stalledRounds: number; remaining: number; now?: number },
  ): SessionGoal | null {
    const current = this.get(sessionFile)
    if (!current) return null
    const loop = normalizeGoalLoopProgress(current.loop)
    const remaining = Math.max(0, Math.floor(input.remaining))
    const now = input.now ?? Date.now()
    // 上一次比较基准比现在大 = 这一轮真的少了一项，记下推进时间。
    const advanced = loop.lastContinuedAt !== null && remaining < loop.lastRemaining
    return this.replace(current.sessionFile, {
      ...current,
      loop: {
        rounds: Math.max(0, Math.floor(input.rounds)),
        stalledRounds: Math.max(0, Math.floor(input.stalledRounds)),
        lastRemaining: remaining,
        lastAdvancedAt: advanced ? now : loop.lastAdvancedAt,
        lastContinuedAt: now,
        stopReason: null,
      },
    })
  }

  /** 记一次「有进展」：remaining 比上轮小，就把最后推进时间刷新。 */
  markLoopAdvanced(sessionFile: string | null | undefined, now?: number): SessionGoal | null {
    const current = this.get(sessionFile)
    if (!current) return null
    return this.replace(current.sessionFile, {
      ...current,
      loop: { ...normalizeGoalLoopProgress(current.loop), lastAdvancedAt: now ?? Date.now() },
    })
  }

  toggleCriterion(sessionFile: string | null | undefined, index: number, now?: number): SessionGoal | null {
    const current = this.get(sessionFile)
    if (!current) return null
    const target = current.criteria[index]
    if (!target) return current
    return this.replace(current.sessionFile, {
      ...current,
      criteria: current.criteria.map((criterion, i) =>
        i === index ? { ...criterion, done: !criterion.done } : criterion,
      ),
      updatedAt: Math.max(now ?? Date.now(), current.updatedAt + 1),
    })
  }

  /**
   * 把若干条验收项标记为已达成（模型按 `GOAL-PROGRESS: 1,3` 汇报，1 起算）。
   * 返回改动后的目标；没有目标或没有有效下标时返回原值/ null。
   */
  markCriteriaDone(
    sessionFile: string | null | undefined,
    indices: readonly number[],
    now?: number,
  ): SessionGoal | null {
    const current = this.get(sessionFile)
    if (!current) return null
    const wanted = new Set(
      indices
        .map((index) => Math.floor(index) - 1)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < current.criteria.length),
    )
    if (wanted.size === 0) return current
    let changed = false
    const criteria = current.criteria.map((criterion, index) => {
      if (!wanted.has(index) || criterion.done) return criterion
      changed = true
      return { ...criterion, done: true }
    })
    if (!changed) return current
    return this.replace(current.sessionFile, { ...current, criteria, updatedAt: Math.max(now ?? Date.now(), current.updatedAt + 1) })
  }

  clear(sessionFile: string | null | undefined): boolean {
    const key = goalKey(sessionFile)
    if (!key) return false
    const data = this.load()
    if (!data.goals[key]) return false
    delete data.goals[key]
    this.persist()
    return true
  }

  /** 未完成的标准数：0 表示目标可判定为达成。 */
  remaining(sessionFile: string | null | undefined): number {
    return remainingOf(this.get(sessionFile)?.criteria)
  }

  /** 注入 worker 的 system prompt 段；没有目标时为 null。 */
  promptSection(sessionFile: string | null | undefined): string | null {
    return goalPromptSection(this.get(sessionFile))
  }

  private replace(sessionFile: string, next: SessionGoal): SessionGoal {
    const data = this.load()
    data.goals[sessionFile] = next
    this.persist()
    return next
  }
}
