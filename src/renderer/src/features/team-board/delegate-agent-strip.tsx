import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, Loader2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { selectDelegateRuns, type DelegateRun } from '@renderer/lib/delegate-runs'
import { openDelegateSessionPreview } from '@renderer/lib/delegate-session-navigation'
import { useUIStore } from '@renderer/stores/ui-store'

/**
 * 底部「子 Agent」条：把 `acp_delegate` 派出去的子 Agent 摆在输入框上方。
 *
 * 以前这里什么都不显示，是因为它只认 pi-subagents 的 tree 模版工具卡，
 * 而 acp_delegate 的卡片模版不是 tree —— 于是「派了两个子 Agent」在界面上看不见、
 * 也点不进去。现在按 runId 从工具结果里收集，点一行就打开那个子 Agent 的只读会话，
 * 看它的思考过程和进度。
 */
export function DelegateAgentStrip() {
  const { t } = useTranslation()
  const currentSessionId = useUIStore((state) => state.currentSessionId)
  const runs = useUIStore((state) => selectDelegateRuns(state.timelineItems))
  const [expanded, setExpanded] = useState(false)
  const [opening, setOpening] = useState('')

  const running = useMemo(() => runs.filter((run) => run.state === 'running'), [runs])
  const finished = useMemo(() => runs.filter((run) => run.state !== 'running'), [runs])

  // 换会话就收起来：别把上一个会话的子 Agent 列表留在新会话里。
  useEffect(() => {
    setExpanded(false)
  }, [currentSessionId])

  // 有新的子 Agent 开始跑时自动展开一次，让「派出去了」这件事看得见。
  const runningSignature = running.map((run) => run.runId).join('|')
  useEffect(() => {
    if (runningSignature) setExpanded(true)
  }, [runningSignature])

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

  if (runs.length === 0) return null

  const visible = expanded ? [...running, ...finished] : []

  return (
    <div className="mb-1.5 flex flex-col gap-1">
      {visible.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card/70 px-1.5 py-1">
          {visible.map((run) => (
            <DelegateRunRow
              key={run.runId}
              run={run}
              opening={opening === run.runId}
              onOpen={() => void open(run)}
            />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={t('team:delegate.hint')}
        className="inline-flex w-fit items-center gap-1.5 rounded px-1 py-0.5 text-2xs text-foreground-tertiary hover:bg-[var(--bg-hover)] hover:text-foreground"
      >
        {running.length > 0 ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        ) : (
          <Bot className="h-3 w-3" />
        )}
        <span>
          {running.length > 0
            ? t('team:delegate.running', { count: running.length })
            : t('team:delegate.idle', { count: finished.length })}
        </span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')} />
      </button>
    </div>
  )
}

function DelegateRunRow({
  run,
  opening,
  onOpen,
}: {
  run: DelegateRun
  opening: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const live = run.state === 'running'
  const task = run.task ? run.task.replace(/\s+/g, ' ').trim() : ''
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={opening}
      title={task || run.runId}
      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-60"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          live ? 'bg-primary' : run.state === 'failed' ? 'bg-destructive' : 'bg-emerald-500',
        )}
      />
      <span className="shrink-0 font-medium text-foreground">{run.agent}</span>
      <span className="min-w-0 flex-1 truncate opacity-80">{task}</span>
      <span className="shrink-0 font-mono opacity-60">{run.runId.replace(/^del_/, '')}</span>
      <span className="shrink-0 opacity-60">
        {live
          ? t('team:delegate.stateRunning')
          : run.state === 'failed'
            ? t('team:delegate.stateFailed')
            : t('team:delegate.stateDone')}
      </span>
      {opening ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
    </button>
  )
}
