import type { TimelineItem } from '@renderer/stores/ui-store-types'

/**
 * 子 Agent（`acp_delegate`）在时间线里的呈现方式：
 *
 * 每次派发的工具结果带 `details = { kind:'delegate', agent, runId, task, status, … }`，
 * 派发（acp_delegate）时 status 是 'running'，等它（acp_delegate_wait）回来后才补
 * durationMs / exitLabel / file / preview。同一 runId 会出现在两条工具行里，
 * 所以要按 runId 合并，而不是按工具行数数 —— 否则「派了 2 个」会显示成 4 个。
 */
export type DelegateRunState = 'running' | 'completed' | 'failed'

export type DelegateRun = {
  /** 去重键：同一个 runId 的多条工具行合并成一条。 */
  key: string
  runId: string
  agent: string
  task: string
  state: DelegateRunState
  /** 派发那一刻的时间戳（工具行自带 timestamp）。 */
  startedAt: number
  durationMs?: number
  /** 宿主进程写的最终报告路径，点开可看全文。 */
  file?: string
  /** 结束摘要，用来在行里给一句「它做完了什么」。 */
  preview?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function delegateRunFromItem(item: TimelineItem): DelegateRun | null {
  if (item.type !== 'tool-call') return null
  const details = asRecord(item.toolDetails)
  const args = asRecord(item.toolArgs)
  const isDelegateDetails = details?.kind === 'delegate'
  const isLiveAcpDelegate =
    !isDelegateDetails
    && item.toolName === 'acp_delegate'
    && (item.toolPhase === 'start' || item.toolPhase === 'update')
  if (!isDelegateDetails && !isLiveAcpDelegate) return null

  const runId = nonEmptyString(details?.runId) ?? (isLiveAcpDelegate ? nonEmptyString(item.toolCallId) ?? nonEmptyString(item.id) : undefined)
  if (!runId) return null

  const rawStatus = nonEmptyString(details?.status)
  const failed = item.isError === true || rawStatus === 'failed' || rawStatus === 'cancelled'
  const completed = rawStatus === 'completed' || rawStatus === 'done'
  const state: DelegateRunState = failed ? 'failed' : completed ? 'completed' : 'running'
  const durationMs = typeof details?.durationMs === 'number' && Number.isFinite(details.durationMs)
    ? details.durationMs
    : undefined

  return {
    key: runId,
    runId,
    agent: nonEmptyString(details?.agent) ?? nonEmptyString(args?.agent) ?? nonEmptyString(args?.role) ?? 'subagent',
    task: nonEmptyString(details?.task) ?? nonEmptyString(args?.task) ?? nonEmptyString(args?.prompt) ?? '',
    state,
    startedAt: typeof item.timestamp === 'number' ? item.timestamp : 0,
    durationMs,
    file: nonEmptyString(details?.file),
    preview: nonEmptyString(details?.preview),
  }
}

/**
 * 时间线里的所有子 Agent，按 runId 合并，最新的排在前面。
 * 「结束」的信息一旦出现就保留：wait 的那一行即使先到，也不该让状态回到 running。
 */
export function collectDelegateRuns(items: TimelineItem[]): DelegateRun[] {
  const byRunId = new Map<string, DelegateRun>()
  for (const item of items) {
    const run = delegateRunFromItem(item)
    if (!run) continue
    const previous = byRunId.get(run.runId)
    if (!previous) {
      byRunId.set(run.runId, run)
      continue
    }
    const settled = previous.state !== 'running' ? previous.state : run.state
    byRunId.set(run.runId, {
      ...previous,
      ...run,
      // 开始时间取最早的那条（acp_delegate 派发那一行），不是 wait 那一行。
      startedAt: Math.min(previous.startedAt, run.startedAt),
      state: settled,
      task: run.task || previous.task,
      durationMs: run.durationMs ?? previous.durationMs,
      file: run.file ?? previous.file,
      preview: previous.preview ?? run.preview,
    })
  }
  return [...byRunId.values()].sort((left, right) => right.startedAt - left.startedAt)
}

/** 还在跑的那些：底部条上的数字就是它的长度。 */
export function runningDelegateRuns(runs: DelegateRun[]): DelegateRun[] {
  return runs.filter((run) => run.state === 'running')
}

const EMPTY_RUNS: DelegateRun[] = []
const MAX_SIGNATURE_CACHE = 32
const memoByItems = new WeakMap<TimelineItem[], DelegateRun[]>()
const memoBySignature = new Map<string, DelegateRun[]>()

/**
 * Store selector：时间线每个 token 都会换新数组，这里按输入引用和内容签名缓存，
 * 多分屏/多会话并发订阅时不会互相踩缓存，内容没变就返回同一个实例。
 */
export function selectDelegateRuns(items: TimelineItem[]): DelegateRun[] {
  if (items.length === 0) return EMPTY_RUNS
  const cached = memoByItems.get(items)
  if (cached) return cached

  const next = collectDelegateRuns(items)
  if (next.length === 0) {
    memoByItems.set(items, EMPTY_RUNS)
    return EMPTY_RUNS
  }

  const signature = next
    .map((run) => `${run.runId}\u0001${run.state}\u0001${run.agent}\u0001${run.task}\u0001${run.startedAt}`)
    .join('\u0002')
  const existing = memoBySignature.get(signature)
  if (existing) {
    memoBySignature.delete(signature)
    memoBySignature.set(signature, existing)
    memoByItems.set(items, existing)
    return existing
  }

  memoBySignature.set(signature, next)
  if (memoBySignature.size > MAX_SIGNATURE_CACHE) {
    const oldest = memoBySignature.keys().next().value
    if (oldest !== undefined) memoBySignature.delete(oldest)
  }
  memoByItems.set(items, next)
  return next
}
