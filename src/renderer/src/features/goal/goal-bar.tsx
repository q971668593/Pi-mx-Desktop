import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCircle2, ChevronDown, Copy, Pencil, Target, Trash2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { parseGoalCriteriaText } from '@shared/session-goal'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSessionGoalStore } from '@renderer/stores/session-goal-store'

/**
 * 会话目标条：钉在时间线顶部的一个窄条。
 *
 * - 目标与验收项存在主进程的 app 私有状态里（`session-goals.json`），不进 pi 的 JSONL。
 * - 发 prompt 时由主进程把目标渲染成 pi 的 `<goal>` system prompt section，
 *   所以历史消息里只有用户真正说过的话。
 * - 勾选验收项 = 告诉自动循环「这一项不用再做了」，remaining 归零即目标达成。
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

  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  /** 两段式清除：误点一次不该把目标（以及注入给模型的 goal 段）直接抹掉。 */
  const [confirmClear, setConfirmClear] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [criteriaDraft, setCriteriaDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const goalInputRef = useRef<HTMLInputElement>(null)

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

  // 没有绑定的会话（首页/新建会话）：目标条不占位。
  if (!sessionFile) return null

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
    <div className={cn('shrink-0 px-4 pt-2 sm:px-6', className)} data-goal-bar>
      <div className="rounded-lg border border-border/50 bg-card/50 px-2.5 py-1.5">
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
              {remaining === 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('goal:bar.done')}
                </span>
              ) : goal.criteria.length > 0 ? (
                <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                  {t('goal:bar.remaining', { count: remaining })}
                </span>
              ) : null}
              <div className="flex shrink-0 items-center gap-0.5">
                {remaining > 0 && (
                  <button type="button" aria-pressed={autoRun} onClick={() => setAutoRun(sessionFile, !autoRun)}
                    className="rounded px-1.5 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] aria-pressed:text-accent">
                    {t(autoRun ? 'goal:bar.pauseAutoRun' : 'goal:bar.enableAutoRun')}
                  </button>
                )}
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
