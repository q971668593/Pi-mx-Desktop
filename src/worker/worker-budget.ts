// 运行预算注入（每轮）：把「剩余上下文」的**实测值**和「什么时候才允许停工」写进 pi 的
// 结构化 prompt section，用来消灭「模型自己猜余量」这类假停工理由。
//
// 为什么需要它（2026-11-18 实测，不是猜）：
//   - 那一轮 assistant 的 usage.totalTokens = 100,501，模型 contextWindow = 1,048,000，
//     实际还剩 ≈90%；但它在回复里写「这一步的余量已经不够安全改代码了」然后收工。
//   - 原因不是真没余量：**没有任何环节把实测数字告诉它**。它只能凭「压缩过几次 / 聊了多久」
//     推断，于是把「压缩过一次」当成「快见底」，而 AGENTS.md 又把压缩写成危险信号
//     （压缩后必须重新 read 才能改），刚好给它一个听起来体面的出口。
//   - 给它数字 + 白名单，就能把「猜」变成「读一行」；猜错这件事从根上消失。
//
// 频率设计（重要）：pi 会把 section 的**变更**作为 system 消息追加进 transcript
// （agent-session.js `_preparePromptAndPromptAndToolLoadout` → `diffSystemPromptSections`）。
// 所以这里的文本必须尽量稳定，否则每轮都新增几百 token 的 system 消息，反而更费上下文。
// 做法：剩余百分比按 5% 一档向下取整、只报窗口不报已用量 → 一次会话里文本最多变 ~20 次。

import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  InlineExtension,
} from '@earendil-works/pi-coding-agent'

/**
 * Section key。**不能**用 `desktop_` 前缀：worker-capabilities 每轮会删掉它不认识的
 * `desktop_*` 段，用同前缀会被它顺手清掉。
 */
export const BUDGET_SECTION_KEY = 'runtime_budget'

/** 低于这个剩余比例才允许「收缩交付切片」；它从来不是「允许停工」的界。 */
export const LOW_BUDGET_PERCENT = 15

/** 百分比量化档位，用来压住 transcript 里 section 变更的频率。 */
const PERCENT_BUCKET = 5

export type BudgetSnapshot = {
  /** pi 估计的当前上下文 tokens；刚压缩完 / 首轮为 null（未知，不是 0）。 */
  tokens: number | null
  contextWindow: number
  /** 本会话已压缩次数：用来纠正「压缩过 = 余量少」的误解。 */
  compactions?: number
}

export type BudgetView = {
  contextWindow: number
  leftPercentBucket: number | null
  known: boolean
}

function positiveInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

export function formatWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

export function budgetView(snapshot: BudgetSnapshot): BudgetView {
  const contextWindow = positiveInt(snapshot.contextWindow)
  const tokens = typeof snapshot.tokens === 'number' && Number.isFinite(snapshot.tokens) && snapshot.tokens >= 0
    ? Math.round(snapshot.tokens)
    : null
  if (tokens === null || contextWindow === 0) {
    return { contextWindow, leftPercentBucket: null, known: false }
  }
  const left = Math.max(0, Math.min(100, ((contextWindow - tokens) / contextWindow) * 100))
  return {
    contextWindow,
    leftPercentBucket: Math.floor(left / PERCENT_BUCKET) * PERCENT_BUCKET,
    known: true,
  }
}

/**
 * 生成 model-facing 的预算段。要求：
 *  - 数字只来自实测（pi 的 getContextUsage / 模型目录的 contextWindow），绝不估算；
 *  - 停工的允许理由必须**穷举**，否则模型永远能找到新的措辞；
 *  - 文本随「量化档位」变化，不随每一轮变化（见文件头的 transcript 说明）。
 */
export function buildBudgetSection(snapshot: BudgetSnapshot): string {
  const view = budgetView(snapshot)
  const compactions = Math.max(0, Math.round(snapshot.compactions ?? 0))

  const facts = view.known
    ? `窗口 ${formatWindow(view.contextWindow)} tokens，本轮剩余 ≈${view.leftPercentBucket}%（宿主实测），本会话已压缩 ${compactions} 次。`
    : view.contextWindow > 0
      ? `窗口 ${formatWindow(view.contextWindow)} tokens；已用量暂时未知（刚压缩完时会出现，下一条回复后自动恢复）。`
      : '窗口与已用量未知（模型目录里没有 contextWindow），按「不动用余量当理由」处理。'

  const lines = [
    '## 运行预算（宿主实测，每轮自动刷新；这是给你的运行条件，不是任务，不要复述它）',
    '',
    `- ${facts}`,
    '- 这是唯一的预算事实源。你看不到 token 计数器，也无法从对话长度或压缩次数推断余量 —— 只能读这一行。',
    '- 结束当前轮次、把决定权交回用户，只有三种允许的理由：',
    '  1. 需要用户做产品决策；',
    '  2. 外部硬阻塞（缺依赖 / 缺权限 / 网络不可用）；',
    '  3. 目标与看板已全部达成。',
    `- 「余量不够」「怕交半成品」「怕把门禁弄红」都不是停工理由；剩余 ≥ ${LOW_BUDGET_PERCENT}% 时必须继续动手。`,
    `- 剩余 < ${LOW_BUDGET_PERCENT}% 时：交最小可验证切片（tsc / 测试实跑通过）+ 在末尾写清下一轮入口，然后继续 —— 仍然不要问「要不要继续」。`,
    '- 压缩次数多 ≠ 余量少。压缩后先 read 再改是流程要求，不是停工理由。',
  ]
  return lines.join('\n')
}

type StartEvent = Pick<BeforeAgentStartEvent, 'systemPrompt'> & {
  systemPromptOptions?: { sections?: Record<string, string> }
}

type BudgetContext = {
  getContextUsage?: () => { tokens: number | null; contextWindow: number } | undefined
  sessionManager?: { getEntries?: () => Iterable<{ type?: string }> }
}

/** 压缩次数只用于「纠正误解」，数不出来就当 0，绝不因为统计失败把这一段丢掉。 */
export function countCompactions(ctx?: BudgetContext): number {
  try {
    let count = 0
    for (const entry of ctx?.sessionManager?.getEntries?.() ?? []) {
      if (entry?.type === 'compaction') count++
    }
    return count
  } catch {
    return 0
  }
}

export function snapshotFromContext(ctx?: BudgetContext): BudgetSnapshot {
  let tokens: number | null = null
  let contextWindow = 0
  try {
    const usage = ctx?.getContextUsage?.()
    if (usage) {
      tokens = typeof usage.tokens === 'number' ? usage.tokens : null
      contextWindow = positiveInt(usage.contextWindow)
    }
  } catch {
    // 取不到 usage 就当未知：仍然发段，只是说「未知」，不要静默消失
  }
  return { tokens, contextWindow, compactions: countCompactions(ctx) }
}

/**
 * 把预算写进这一轮的 system prompt：有结构化 sections 就只改自己那一段（其它段不动，
 * 也不重写整个 prompt，保住缓存）；老 SDK 没有 sections 时才退化成追加。
 */
export function withRuntimeBudget(
  event: StartEvent,
  ctx?: BudgetContext,
): BeforeAgentStartEventResult | undefined {
  const section = buildBudgetSection(snapshotFromContext(ctx))
  const target = event.systemPromptOptions?.sections
  if (target) {
    if (target[BUDGET_SECTION_KEY] !== section) target[BUDGET_SECTION_KEY] = section
    return undefined
  }
  return { systemPrompt: `${event.systemPrompt}\n\n${section}` }
}

export const runtimeBudgetExtension: InlineExtension = {
  name: 'pi-desktop-runtime-budget',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event, ctx) => withRuntimeBudget(event, ctx as BudgetContext))
  },
}
