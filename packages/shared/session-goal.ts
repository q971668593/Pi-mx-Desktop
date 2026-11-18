/**
 * 会话目标（目标条）的共享契约：主进程持久化、worker 注入、渲染层展示共用同一份形状。
 *
 * 纯数据 + 纯函数，不带运行时依赖（packages/shared 不许 import electron）。
 * 目标只存在 app 私有状态里：不进 pi 的 JSONL，也不进与终端版共用的
 * `~/.pi/agent/settings.json`。
 */

export type GoalCriterion = { text: string; done: boolean }

export type SessionGoal = {
  sessionFile: string
  /** 一句话目标：用户要的最终状态。 */
  goal: string
  /** 可判定的验收标准；driver 每轮据此判断是否还要继续。 */
  criteria: GoalCriterion[]
  createdAt: number
  updatedAt: number
}

/** pi 的 system prompt section 名：pi 会把它渲染成 `<goal>…</goal>`。 */
export const GOAL_SECTION_KEY = 'goal'

/** 验收项上限：目标条要读得下，注入也要短。 */
export const MAX_GOAL_CRITERIA = 12
/** 单条验收项上限（字符）。 */
export const MAX_GOAL_CRITERION_LENGTH = 200
/** 目标本身的上限（字符）。 */
export const MAX_GOAL_LENGTH = 400

/** 模型在回复末尾报告进度用的行前缀。 */
export const GOAL_PROGRESS_PREFIX = 'GOAL-PROGRESS:'

/** 自动循环的刹车：连续这么多轮 remaining 没下降就停。 */
export const GOAL_LOOP_STALL_LIMIT = 3
/** 自动循环的硬上限（轮），防止目标一直「差一点」。 */
export const GOAL_LOOP_MAX_ROUNDS = 20

export function goalRemaining(criteria: readonly GoalCriterion[] | null | undefined): number {
  return (criteria ?? []).filter((criterion) => !criterion.done).length
}

/**
 * 归一化验收项：去空白、丢空行、去重（保序）、截断超长项、限数量。
 * UI 的「每行一条」与 IPC 校验共用，保证存进去的就是要注入的。
 */
export function normalizeGoalCriteria(input: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input ?? []) {
    const text = String(raw ?? '').trim().slice(0, MAX_GOAL_CRITERION_LENGTH)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= MAX_GOAL_CRITERIA) break
  }
  return out
}

/** 把多行文本拆成验收项（目标条编辑器：一行一条）。 */
export function parseGoalCriteriaText(text: string): string[] {
  return normalizeGoalCriteria(String(text ?? '').split(/\r?\n/))
}

function mark(done: boolean): string {
  return done ? '[已达成]' : '[未达成]'
}

/**
 * system prompt 的 goal 段：目标 + 验收项 + 推进规则。
 *
 * 注入走 pi 的 structured prompt section（不是往用户消息里塞前缀），所以历史消息里
 * 只有用户真正说的话；section 变化由 pi 自己以 system message 形式同步给模型。
 * 没有目标时返回 null（= 把 section 撤掉）。
 */
export function goalPromptSection(goal: SessionGoal | null | undefined): string | null {
  const text = String(goal?.goal ?? '').trim()
  if (!goal || !text) return null
  const criteria = goal.criteria ?? []
  const lines = [
    '本会话目标（用户设定，不是建议）：',
    text.slice(0, MAX_GOAL_LENGTH),
    '',
  ]
  if (criteria.length > 0) {
    lines.push('验收标准（未达成的才是本轮要推进的）：')
    criteria.forEach((criterion, index) => {
      lines.push(`${index + 1}. ${mark(criterion.done)} ${criterion.text}`)
    })
    lines.push(
      '',
      '推进规则：',
      '- 只做让未达成验收标准真正成立的工作；不要用「已完成」代替验证。',
      `- 每轮回复的最后单独一行输出进度：\`${GOAL_PROGRESS_PREFIX} 1,3\`（本轮完成后达到的标准编号，1 起算；没有新增就写 \`${GOAL_PROGRESS_PREFIX} none\`）。`,
      '- 不要修改目标或验收标准本身；需要调整就告诉用户。',
    )
  } else {
    lines.push('这个目标还没有验收标准：先和用户确认「怎样算完成」，再动手。')
  }
  return lines.join('\n')
}

/**
 * 解析模型汇报的进度行，返回 1 起的验收项序号（已去重、已过滤越界）。
 * 没有进度行返回 null（= 本轮没有任何进度声明）；`none` 返回 []。
 * 多处出现时以最后一处为准（模型可能先写草稿）。
 */
export function parseGoalProgress(text: string, criteriaCount: number): number[] | null {
  if (criteriaCount <= 0) return null
  const none = /^(?:none|无|没有|暂无)$/i
  const digitsOnly = /^[\d\s,，、.。]+$/
  let last: string | null = null
  // 只看「独立成行」的汇报：正文里提到这个约定（或在示例里带括号说明）不算进度，
  // 否则模型复述一遍指令就能把验收项刷成已完成。
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^[`*_>#\-\s]+/, '')
    if (!cleaned.toUpperCase().startsWith(GOAL_PROGRESS_PREFIX)) continue
    const body = cleaned.slice(GOAL_PROGRESS_PREFIX.length).replace(/[`*_]/g, ' ').trim()
    if (!body && !none.test(body)) continue
    if (!none.test(body) && !digitsOnly.test(body)) continue
    last = body
  }
  if (last === null) return null
  if (none.test(last)) return []
  const indices = new Set<number>()
  for (const token of last.split(/[^0-9]+/)) {
    if (!token) continue
    const index = Number(token)
    if (!Number.isInteger(index) || index < 1 || index > criteriaCount) continue
    indices.add(index)
  }
  return [...indices].sort((a, b) => a - b)
}

/** 自动循环发给模型的那一轮提示（进历史消息，用户看得见这轮是自动续的）。 */
export function goalContinuationPrompt(remaining: number): string {
  return [
    `继续推进本会话目标：还剩 ${Math.max(1, remaining)} 项验收标准未达成（清单见系统提示的 goal 段）。`,
    '先核对上一轮的实际结果，再接着做；不要重复已经完成的工作。',
    `结束时按约定输出 \`${GOAL_PROGRESS_PREFIX}\` 行。`,
  ].join('\n')
}

export type GoalLoopState = {
  /** 连续多少轮 remaining 没有下降。 */
  stalledRounds: number
  /** 上一轮开始时的 remaining。 */
  lastRemaining: number
  /** 已经自动续了多少轮。 */
  rounds: number
}

export type GoalLoopDecision = 'continue' | 'done' | 'stalled' | 'capped'

export type GoalLoopResult = {
  decision: GoalLoopDecision
  next: GoalLoopState
}

/**
 * 自动循环的刹车（纯函数）：
 * - remaining 归零 → done
 * - 连续 `stallLimit` 轮 remaining 没有下降 → stalled
 * - 超过 `maxRounds` → capped
 * - 否则 continue，并记下本轮开始时的 remaining 作为下一轮的比较基准
 */
export function decideGoalLoop(input: {
  remaining: number
  previous: GoalLoopState | null
  /** 本轮开始前（或上次决策后）的 remaining；缺省用 previous.lastRemaining。 */
  baselineRemaining?: number
  stallLimit?: number
  maxRounds?: number
}): GoalLoopResult {
  const stallLimit = Math.max(1, input.stallLimit ?? GOAL_LOOP_STALL_LIMIT)
  const maxRounds = Math.max(1, input.maxRounds ?? GOAL_LOOP_MAX_ROUNDS)
  const remaining = Math.max(0, Math.floor(input.remaining))
  const previous = input.previous
  const baseline = Math.max(0, Math.floor(input.baselineRemaining ?? previous?.lastRemaining ?? remaining))
  if (remaining <= 0) {
    return { decision: 'done', next: { stalledRounds: 0, lastRemaining: 0, rounds: previous?.rounds ?? 0 } }
  }
  if (!previous) {
    return { decision: 'continue', next: { stalledRounds: 0, lastRemaining: remaining, rounds: 1 } }
  }
  if (previous.rounds >= maxRounds) {
    return { decision: 'capped', next: previous }
  }
  const stalledRounds = remaining < baseline ? 0 : previous.stalledRounds + 1
  const next: GoalLoopState = { stalledRounds, lastRemaining: remaining, rounds: previous.rounds + 1 }
  if (stalledRounds >= stallLimit) return { decision: 'stalled', next }
  return { decision: 'continue', next }
}
