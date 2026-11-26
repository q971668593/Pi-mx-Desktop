import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, Loader2, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { selectDelegateRuns, type DelegateRun } from '@renderer/lib/delegate-runs'
import { openDelegateSessionPreview } from '@renderer/lib/delegate-session-navigation'
import { useUIStore } from '@renderer/stores/ui-store'

const DISMISSED_KEY = 'pi-desktop.delegate-strip-dismissed'
const DISMISSED_CAP = 200

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function persistDismissed(next: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-DISMISSED_CAP)))
  } catch {
    /* 忽略：关掉只是本次生效 */
  }
}

/**
 * 右上角「子 Agent」悬浮条：只在有子 Agent 真正在跑时出现。
 *
 * 三条规矩：
 * 1. 没在跑的就不显示 —— 跑完了自动消失，不占地方；
 * 2. 默认收起 —— 只有新派出的子 Agent 出现时才自动展开一次，进对话不会被旧列表糊脸；
 * 3. 状态是按时间线里的工具结果算的，宿主那边没回执的行会一直显示“在跑”，
 *    这种卡死的可以直接叉掉（记到 localStorage，换会话也不会再冒出来）。
 */
export function DelegateAgentStrip() {
  const { t } = useTranslation()
  const currentSessionId = useUIStore((state) => state.currentSessionId)
  const runs = useUIStore((state) => selectDelegateRuns(state.timelineItems))
  const [expanded, setExpanded] = useState(false)
  const [opening, setOpening] = useState('')
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed())
  const seenRunIds = useRef<Set<string>>(new Set())
  const firstSignature = useRef(true)

  const visible = useMemo(
    () => runs.filter((run) => !dismissed.has(run.runId)),
    [runs, dismissed],
  )
  const running = useMemo(() => visible.filter((run) => run.state === 'running'), [visible])

  // 换会话就收起来，见过集合也清掉：新会话的在跑项要当成新的看一次。
  useEffect(() => {
    setExpanded(false)
    seenRunIds.current = new Set()
    firstSignature.current = true
  }, [currentSessionId])

  // 只有“新冒出来”的在跑项才自动展开一次：挂载/进会话第一拍只记录不展开。
  const runningSignature = running.map((run) => run.runId).join('|')
  useEffect(() => {
    const seen = seenRunIds.current
    const ids = runningSignature ? runningSignature.split('|') : []
    const isNew = ids.some((id) => !seen.has(id))
    seenRunIds.current = new Set(ids)
    if (firstSignature.current) {
      firstSignature.current = false
      return
    }
    if (isNew && ids.length > 0) setExpanded(true)
  }, [runningSignature])

  const dismiss = useCallback((runId: string) => {
    setDismissed((previous) => {
      const next = new Set(previous)
      next.add(runId)
      persistDismissed(next)
      return next
    })
  }, [])

  const open = useCallback(
    async (run: DelegateRun) => {
      if (opening) return
      setOpening(run.runId)
      try {
        await openDelegateSessionPreview(run)
      } finally {
        setOpening('')
      }
    },
    [opening],
  )

  // 没在跑的就不展示也不统计：列表里只留运行中，跑完了整条自动消失。
  if (running.length === 0) return null

  return (
    <div className="absolute right-3 top-11 z-20 flex w-full max-w-[320px] flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={t('team:delegate.hint')}
        className="electron-no-drag inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-[color-mix(in_srgb,var(--surface-sidebar)_92%,transparent)] px-2 py-1 text-2xs text-foreground-tertiary shadow-sm hover:text-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        <span>{t('team:delegate.running', { count: running.length })}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')} />
      </button>
      {expanded ? (
        <div
          data-independent-scroll
          className="flex max-h-64 w-full flex-col gap-0.5 overflow-y-auto rounded-lg border border-border/60 bg-card/95 p-1 shadow-lg"
        >
          {running.map((run) => (
            <DelegateRunRow
              key={run.runId}
              run={run}
              opening={opening === run.runId}
              onOpen={() => void open(run)}
              onDismiss={() => dismiss(run.runId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DelegateRunRow({
  run,
  opening,
  onOpen,
  onDismiss,
}: {
  run: DelegateRun
  opening: boolean
  onOpen: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const live = run.state === 'running'
  const task = run.task ? run.task.replace(/\s+/g, ' ').trim() : ''
  return (
    <div className="group flex w-full items-center gap-1 rounded px-1 py-0.5 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground">
      <button
        type="button"
        onClick={onOpen}
        disabled={opening}
        title={task || run.runId}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:opacity-60"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            live ? 'bg-primary' : run.state === 'failed' ? 'bg-destructive' : 'bg-emerald-500',
          )}
        />
        <Bot className="h-3 w-3 shrink-0 opacity-60" />
        <span className="shrink-0 font-medium text-foreground">{run.agent}</span>
        <span className="min-w-0 flex-1 truncate opacity-80">{task}</span>
        <span className="shrink-0 font-mono opacity-60">{run.runId.replace(/^del_/, '')}</span>
        <span className="shrink-0 opacity-60">
          {live ? t('team:delegate.stateRunning') : run.state === 'failed' ? t('team:delegate.stateFailed') : t('team:delegate.stateDone')}
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onDismiss()
        }}
        title="不再显示这一条"
        aria-label="不再显示这一条"
        className="shrink-0 rounded p-0.5 opacity-0 hover:bg-[var(--bg-hover)] group-hover:opacity-70"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
