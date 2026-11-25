import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Copy, Pencil, Play, Target, Trash2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import {
  GOAL_LOOP_MAX_ROUNDS,
  decideGoalRunStatus,
  parseGoalCriteriaText,
  type GoalRunStatus,
  type GoalStopReason,
} from '@shared/session-goal'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSessionGoalStore } from '@renderer/stores/session-goal-store'
import { isSessionRunning } from '@renderer/features/team-board/team-board-lib'
import { abortAgentTurn } from '@renderer/lib/composer-abort'

/**
 * 会话目标条：钉在时间线顶部的一个窄条。
 *
 * - 目标与验收项存在主进程的 app 私有状态里（`session-goals.json`），不进 pi 的 JSONL。
 * - 发 prompt 时由主进程把目标渲染成 pi 的 `<goal>` system prompt section，
 *   所以历史消息里只有用户真正说过的话。
 * - 勾选验收项 = 告诉自动循环「这一项不用再做了」，remaining 归零即目标达成。
 *
 * 这一版把「到底有没有在推进」做成可信的状态，而不是靠猜：
 * 状态来自 `decideGoalRunStatus`（共享契约），输入是本轮是否真的在跑 + 开关是否开着 +
 * 有没有因为刹车停下。以前这里把 `sessionRuntimeRunning` 这整张表当布尔用，
 * 空表也是真值，于是徽标永远是「进行中」、按钮永远只出现「终止」，
 * 用户既看不到「已暂停」，也没有地方把自动推进打开。
 */
export function GoalBar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const historySessionFile = useUIStore((state) => state.historySessionFile)
  const sessionFile = useSessionGoalStore((state) => state.sessionFile)
  const goal = useSessionGoalStore((state) => state.goal)
  const load = useSessionGoalStore((state) => state.load)
  const setGoal = useSessionGoalStore((state) => state.setGoal)
  const toggleCriterion = useSessionGoalStore((state) => state.toggleCriterion)
  const clearGoal = useSessionGoalStore((state) => state.clear)
  const setAutoRun = useSessionGoalStore((state) => state.setAutoRun)
  const autoRun = useSessionGoalStore((state) => sessionFile !== null && state.autoRun[sessionFile] !== undefined)
  const startBlocked = useSessionGoalStore((state) => state.startBlocked)
  const clearStartBlocked = useSessionGoalStore((state) => state.clearStartBlocked)

  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  /** 两段式清除：误点一次不该把目标（以及注入给模型的 goal 段）直接抹掉。 */
  const [confirmClear, setConfirmClear] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [starting, setStarting] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [criteriaDraft, setCriteriaDraft] = useState('')
  const [saving, setSaving] = useState(false)
  /** 只让「上次推进 3 分钟前」这种相对时间自己走，不为它挂整表重渲染。 */
  const [, setClock] = useState(0)
  const goalInputRef = useRef<HTMLInputElement>(null)

  // 本轮是否真的在跑：按当前会话在运行表里查，不能把整张表当布尔。
  const runInProgress = useUIStore((state) => isSessionRunning(state.sessionRuntimeRunning, historySessionFile ?? undefined))

  // 切换会话：重新拉目标，并把编辑态收起来（不同会话的目标不该串到编辑器里）
  useEffect(() => {
    setEditing(false)
    setExpanded(true)
    void load(historySessionFile)
  }, [historySessionFile, load])

  const remaining = useMemo(
    () => (goal ? goal.criteria.filter((criterion) => !criterion.done).length : 0),
    [goal],
  )

  useEffect(() => {
    if (editing) goalInputRef.current?.focus()
  }, [editing])

  // 确认态会自己超时退回：用户点了第一个＋、然后去干别的，不该在下一次点击时意外清除。
  useEffect(() => {
    if (!confirmClear) return
    const timer = setTimeout(() => setConfirmClear(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  // 目标变了（清除/重设/切会话）就不再需要确认。
  useEffect(() => {
    setConfirmClear(false)
  }, [goal?.updatedAt, sessionFile])

  // 相对时间每 30 秒刷一次就够，不值得为它高频重渲染整条。
  const lastAdvancedAt = goal?.loop?.lastAdvancedAt ?? null
  useEffect(() => {
    if (lastAdvancedAt === null) return
    const timer = setInterval(() => setClock((value) => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [lastAdvancedAt])

  const beginEdit = useCallback(() => {
    setGoalDraft(goal?.goal ?? '')
    setCriteriaDraft((goal?.criteria ?? []).map((criterion) => criterion.text).join('\n'))
    setEditing(true)
    setExpanded(true)
  }, [goal])

  const submit = useCallback(async () => {
    const text = goalDraft.trim()
    if (!text || saving) return
    setSaving(true)
    try {
      const saved = await setGoal(text, parseGoalCriteriaText(criteriaDraft))
      if (saved) {
        setEditing(false)
        setExpanded(true)
      }
    } finally {
      setSaving(false)
    }
  }, [criteriaDraft, goalDraft, saving, setGoal])

  const copy = useCallback(async () => {
    if (!goal) return
    const lines = [goal.goal]
    if (goal.criteria.length > 0) {
      lines.push('', ...goal.criteria.map((criterion) => `${criterion.done ? '[x]' : '[ ]'} ${criterion.text}`))
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success(t('goal:bar.copied'))
    } catch (error) {
      console.warn('[GoalBar] copy failed:', error)
    }
  }, [goal, t])

  /** 开始/暂停：开关落盘在主进程，这里只负责把「点了就有反应」做出来。 */
  const start = useCallback(() => {
    if (starting || !sessionFile) return
    setStarting(true)
    // 主进程收到 true 会自己唤醒冷会话再发第一轮，并回传这是否真的发出去了。
    setAutoRun(sessionFile, true)
    setTimeout(() => setStarting(false), 600)
  }, [sessionFile, setAutoRun, starting])

  const pause = useCallback(
    (reason: GoalStopReason = 'manual') => {
      if (!sessionFile) return
      setAutoRun(sessionFile, false, reason)
    },
    [sessionFile, setAutoRun],
  )

  /** 立即打断正在跑的这一轮（暂停只断「下一轮」，这一轮要停得靠 abort）。 */
  const stopNow = useCallback(() => {
    if (!sessionFile || stopping) return
    setStopping(true)
    pause('manual')
    void (async () => {
      try {
        await abortAgentTurn()
      } finally {
        setStopping(false)
      }
    })()
  }, [pause, sessionFile, stopping])

  // 没有绑定的会话（首页/新建会话），或还没有定目标：目标条不占位。
  // 目标只通过指令设定（如 /目标），定好之后这条才出现，可勾选、可改。
  if (!sessionFile || (!goal && !editing)) return null

  const status: GoalRunStatus = decideGoalRunStatus({
    remaining,
    autoRun,
    runInProgress,
    stopReason: goal?.loop?.stopReason ?? null,
  })
  const rounds = goal?.loop?.rounds ?? 0

  const editor = (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <input
        ref={goalInputRef}
        value={goalDraft}
        onChange={(event) => setGoalDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false)
        }}
        placeholder={t('goal:bar.placeholder')}
        aria-label={t('goal:bar.placeholder')}
        className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-foreground-secondary/60 focus:border-border"
      />
      <textarea
        value={criteriaDraft}
        onChange={(event) => setCriteriaDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false)
          // 验收项是多行文本：Enter 换行，Ctrl/Cmd+Enter 保存
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={t('goal:bar.criteriaHint')}
        aria-label={t('goal:bar.criteriaHint')}
        rows={3}
        className="w-full resize-y rounded-md border border-border/60 bg-transparent px-2 py-1 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-foreground-secondary/60 focus:border-border"
      />
      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={!goalDraft.trim() || saving}
          className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {t('goal:bar.set')}
        </button>
      </div>
    </form>
  )

  return (
    <div className={cn('shrink-0', className)} data-goal-bar data-goal-status={status}>
      <div className="mb-2 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1.5 shadow-sm">
        {editing ? (
          editor
        ) : !goal ? (
          <button
            type="button"
            onClick={beginEdit}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <Target className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('goal:bar.placeholder')}</span>
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/70" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[12px]',
                  remaining === 0 ? 'text-foreground-secondary line-through decoration-1' : 'text-foreground',
                )}
                title={goal.goal}
              >
                {goal.goal}
              </span>
              <span
                className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px]', statusClass(status))}
                title={statusHint(t, status, goal.loop?.stopReason ?? null, remaining)}
              >
                {statusLabel(t, status)}
              </span>
              {remaining > 0 && goal.criteria.length > 0 ? (
                <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                  {t('goal:bar.remaining', { count: remaining })}
                </span>
              ) : null}
              {/* 跑了多少轮 + 上次真正推进的时间：让「有没有在动」一眼可查，不必翻时间线。 */}
              {remaining > 0 && (rounds > 0 || lastAdvancedAt !== null) ? (
                <span
                  className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-foreground-secondary/80"
                  title={t('goal:bar.roundsHint', { max: GOAL_LOOP_MAX_ROUNDS })}
                >
                  {rounds > 0 ? t('goal:bar.rounds', { count: rounds, max: GOAL_LOOP_MAX_ROUNDS }) : null}
                  {rounds > 0 && lastAdvancedAt !== null ? ' · ' : null}
                  {lastAdvancedAt !== null
                    ? t('goal:bar.lastAdvanced', { time: relativeTime(t, lastAdvancedAt) })
                    : null}
                </span>
              ) : null}
              <div className="flex shrink-0 items-center gap-0.5">
                {/* 三个主控按钮常驻：目标达成后也要能删、能重看，不能整组消失。 */}
                {remaining > 0 ? (
                  autoRun ? (
                    <button
                      type="button"
                      onClick={() => pause('manual')}
                      aria-label={t('goal:bar.pause')}
                      title={t('goal:bar.pause')}
                      className="rounded px-1.5 py-0.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
                    >
                      {t('goal:bar.pause')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={starting}
                      onClick={start}
                      aria-label={t('goal:bar.start')}
                      title={t('goal:bar.start')}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      {t(starting ? 'goal:bar.starting' : 'goal:bar.start')}
                    </button>
                  )
                ) : null}
                {/* 只在真的有一轮在跑时才出现：它打断的是当前这轮，不是开关。 */}
                {runInProgress ? (
                  <button
                    type="button"
                    disabled={stopping}
                    onClick={stopNow}
                    className="rounded px-1.5 py-0.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-destructive disabled:opacity-50"
                  >
                    {t(stopping ? 'goal:bar.stopping' : 'goal:bar.stop')}
                  </button>
                ) : null}
                {goal.criteria.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-label={t('goal:bar.toggle')}
                    aria-expanded={expanded}
                    className="rounded p-1 text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-foreground"
                  >
                    <ChevronDown className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void copy()}
                  aria-label={t('goal:bar.copy')}
                  title={t('goal:bar.copy')}
                  className="rounded p-1 text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={beginEdit}
                  aria-label={t('goal:bar.edit')}
                  title={t('goal:bar.edit')}
                  className="rounded p-1 text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmClear) {
                      setConfirmClear(true)
                      return
                    }
                    setConfirmClear(false)
                    void clearGoal()
                  }}
                  aria-label={confirmClear ? t('goal:bar.clearConfirm') : t('goal:bar.clear')}
                  title={confirmClear ? t('goal:bar.clearConfirm') : t('goal:bar.clear')}
                  className={cn(
                    'rounded p-1 text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-destructive',
                    confirmClear && 'bg-destructive/10 text-destructive',
                  )}
                >
                  {confirmClear ? (
                    <span className="text-[11px] leading-none">{t('goal:bar.clearConfirm')}</span>
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
            {startBlocked ? (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive/90" role="status">
                <span className="min-w-0 flex-1">
                  {t(startBlocked === 'wake_failed' ? 'goal:bar.wakeFailed' : 'goal:bar.startFailed')}
                </span>
                <button
                  type="button"
                  onClick={clearStartBlocked}
                  className="shrink-0 rounded px-1 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
                  aria-label={t('goal:bar.dismissHint')}
                >
                  {t('goal:bar.dismissHint')}
                </button>
              </p>
            ) : null}
            {expanded && goal.criteria.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5 pl-[1.375rem]">
                {goal.criteria.map((criterion, index) => (
                  <li key={`${index}:${criterion.text}`}>
                    <label className="flex cursor-pointer items-start gap-1.5 text-[11.5px] leading-relaxed text-foreground-secondary hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={criterion.done}
                        onChange={() => void toggleCriterion(index)}
                        aria-label={t('goal:bar.toggle')}
                        className="mt-[3px] h-3 w-3 shrink-0"
                      />
                      <span
                        className={cn(
                          'min-w-0',
                          criterion.done && 'text-foreground-secondary/60 line-through decoration-1',
                        )}
                      >
                        {criterion.text}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function statusClass(status: GoalRunStatus): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'running':
      return 'bg-primary/15 text-primary'
    case 'waiting':
      return 'bg-primary/10 text-primary/80'
    case 'stopped':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
    default:
      return 'bg-[var(--bg-hover)] text-foreground-secondary'
  }
}

function statusLabel(t: (key: string) => string, status: GoalRunStatus): string {
  switch (status) {
    case 'done':
      return t('goal:bar.done')
    case 'running':
      return t('goal:bar.running')
    case 'waiting':
      return t('goal:bar.waiting')
    case 'stopped':
      return t('goal:bar.stopped')
    default:
      return t('goal:bar.paused')
  }
}

function statusHint(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: GoalRunStatus,
  stopReason: GoalStopReason | null,
  remaining: number,
): string | undefined {
  if (status === 'waiting') return t('goal:bar.waitingHint')
  if (status === 'paused') return t('goal:bar.pausedHint')
  if (status === 'stopped') {
    return stopReason === 'stalled'
      ? t('goal:bar.loopStalled', { count: remaining })
      : t('goal:bar.loopCapped', { count: remaining })
  }
  return undefined
}

/** 「3 分钟前」这种相对时间；超过一天就退回具体日期，省得读不出是哪天。 */
function relativeTime(t: (key: string, options?: Record<string, unknown>) => string, timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return t('goal:bar.timeJustNow')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('goal:bar.timeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('goal:bar.timeHours', { count: hours })
  return new Date(timestamp).toLocaleDateString()
}
