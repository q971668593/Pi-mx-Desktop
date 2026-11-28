import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bot } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { cn } from '@renderer/lib/utils'
import { usePaneSessionIdentity } from '@renderer/stores/pane-session-context'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TeamSnapshot, TeamRun } from '@shared/team-board'
import {
  TEAM_BOARD_CHANGED_EVENT,
  TEAM_BOARD_RUNS_CHANGED_EVENT,
  isSessionRunning,
  notifyTeamBoardChanged,
  openTeamSession,
  returnFromTeamSubagent,
  roleLabel,
  useTeamSubagentReturn,
} from './team-board-lib'

/**
 * 对话输入区上方的子 Agent 条与查看提示栏：
 * 1. 当用户正处于某个团队子代理会话中时，展示当前正在查看的角色/任务并支持一键返回原会话；
 * 2. 当前项目正在运行的团队派发随时可点，点击即切换进去查看实时执行情况。
 */
export function SubAgentStrip() {
  const { t } = useTranslation()
  const { workspace: workspaceId = '', sessionFile: historySessionFile } = usePaneSessionIdentity()
  const sessionRuntimeRunning = useUIStore((s) => s.sessionRuntimeRunning)
  const returnTarget = useTeamSubagentReturn()
  const [snapshot, setSnapshot] = useState<TeamSnapshot | null>(null)
  const [opening, setOpening] = useState('')
  const [returning, setReturning] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setSnapshot(null)
      return
    }
    try {
      const response = await ipcClient.invoke('teamBoard.snapshot', {
        workspaceId,
        ...(historySessionFile ? { sessionFile: historySessionFile } : {}),
      })
      setSnapshot((response?.snapshot ?? null) as TeamSnapshot | null)
    } catch {
      /* 看板还没初始化或读失败：条直接不显示 */
    }
  }, [historySessionFile, workspaceId])

  useEffect(() => {
    void refresh()
    let timer: number | null = null
    const stopTimer = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const syncPolling = (triggerNow: boolean) => {
      stopTimer()
      if (document.hidden) return
      if (triggerNow) void refresh()
      const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
      const intervalMs = focused ? 4000 : 15_000
      timer = window.setInterval(() => {
        if (!document.hidden) void refresh()
      }, intervalMs)
    }
    const onVisibility = () => syncPolling(!document.hidden)
    const onFocus = () => syncPolling(true)
    const onBlur = () => syncPolling(false)

    syncPolling(false)
    window.addEventListener(TEAM_BOARD_RUNS_CHANGED_EVENT, refresh)
    window.addEventListener(TEAM_BOARD_CHANGED_EVENT, refresh)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      stopTimer()
      window.removeEventListener(TEAM_BOARD_RUNS_CHANGED_EVENT, refresh)
      window.removeEventListener(TEAM_BOARD_CHANGED_EVENT, refresh)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [refresh])

  const runs = snapshot?.runs ?? []
  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of snapshot?.tasks ?? []) map.set(task.id, task.title)
    return map
  }, [snapshot?.tasks])

  const activeRuns = useMemo(() => {
    const currentNow = Math.max(nowMs, Date.now())
    return [...runs]
      .reverse()
      .filter(
        (run) =>
          (run.status === 'starting' || run.status === 'running')
          && !run.staleAt
          && (isSessionRunning(sessionRuntimeRunning, run.sessionFile)
            || (run.startedAt > 0 && currentNow - run.startedAt < 30_000)),
      )
  }, [nowMs, runs, sessionRuntimeRunning])

  useEffect(() => {
    const currentNow = Date.now()
    let soonestExpireMs = Infinity
    for (const run of runs) {
      if ((run.status !== 'starting' && run.status !== 'running') || run.staleAt) continue
      if (isSessionRunning(sessionRuntimeRunning, run.sessionFile)) continue
      if (run.startedAt > 0) {
        const remain = run.startedAt + 30_000 - currentNow
        if (remain > 0 && remain < soonestExpireMs) soonestExpireMs = remain
      }
    }
    if (!Number.isFinite(soonestExpireMs)) return
    const timer = window.setTimeout(() => setNowMs(Date.now()), soonestExpireMs + 150)
    return () => window.clearTimeout(timer)
  }, [runs, sessionRuntimeRunning, nowMs])

  const viewingRun = useMemo(() => {
    if (!historySessionFile) return null
    for (let i = runs.length - 1; i >= 0; i--) {
      if (sessionFilesEqual(runs[i].sessionFile, historySessionFile)) return runs[i]
    }
    return null
  }, [runs, historySessionFile])

  const hasReturnTargetForCurrent = Boolean(
    returnTarget && historySessionFile && sessionFilesEqual(returnTarget.subagentSessionFile, historySessionFile),
  )
  const leaderFallback =
    snapshot?.sessions?.Leader?.sessionFile &&
    (!historySessionFile || !sessionFilesEqual(snapshot.sessions.Leader.sessionFile, historySessionFile))
      ? snapshot.sessions.Leader
      : undefined
  const canReturn = hasReturnTargetForCurrent || !!leaderFallback

  if (!workspaceId || (activeRuns.length === 0 && !viewingRun && !hasReturnTargetForCurrent)) {
    return null
  }

  const open = async (run: TeamRun) => {
    if (opening) return
    setOpening(run.id)
    try {
      await openTeamSession({
        workspaceId,
        worktreePath: run.worktreePath,
        sessionFile: run.sessionFile,
        sessionId: run.sessionId,
        rememberReturn: true,
        subagentLabel: `${roleLabel(run.role, t)} · ${run.taskId}`,
      })
      notifyTeamBoardChanged()
    } finally {
      setOpening('')
    }
  }

  const goBack = async () => {
    if (returning) return
    setReturning(true)
    try {
      if (hasReturnTargetForCurrent) {
        await returnFromTeamSubagent()
      } else if (leaderFallback) {
        await openTeamSession({
          workspaceId,
          sessionFile: leaderFallback.sessionFile,
          sessionId: leaderFallback.sessionId,
        })
      }
    } finally {
      setReturning(false)
    }
  }

  const viewingTitle = viewingRun ? taskTitleById.get(viewingRun.taskId) || '' : ''
  const viewingLive = viewingRun
    ? (viewingRun.status === 'starting' || viewingRun.status === 'running') &&
      isSessionRunning(sessionRuntimeRunning, viewingRun.sessionFile)
    : false

  return (
    <div className="mb-1.5 flex flex-col gap-1">
      {(viewingRun || hasReturnTargetForCurrent) && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1 text-2xs text-foreground-secondary">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              viewingLive
                ? 'animate-pulse bg-amber-500'
                : viewingRun?.status === 'failed' || viewingRun?.status === 'cancelled'
                  ? 'bg-destructive'
                  : 'bg-emerald-500',
            )}
          />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">{t('team:subagentSection.viewingBanner')}</span>
            {viewingRun ? (
              <>
                {' · '}
                <span>{roleLabel(viewingRun.role, t)}</span>
                {viewingRun.taskId ? <span className="ml-1 font-mono">{viewingRun.taskId}</span> : null}
                {viewingTitle ? <span className="ml-1 opacity-80">{viewingTitle}</span> : null}
              </>
            ) : returnTarget?.label ? (
              <> · {returnTarget.label}</>
            ) : null}
          </span>
          {viewingRun ? (
            <span className="shrink-0 text-[10px] opacity-80">
              {viewingLive
                ? t('team:runRunning')
                : viewingRun.status === 'running' || viewingRun.status === 'starting'
                  ? t('team:runStarting')
                  : viewingRun.status === 'done'
                    ? t('team:runDone')
                    : viewingRun.status === 'failed'
                      ? t('team:runFailed')
                      : t('team:runCancelled')}
            </span>
          ) : null}
          {canReturn ? (
            <button
              type="button"
              disabled={returning}
              onClick={() => void goBack()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/35 bg-background/85 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-300"
            >
              <ArrowLeft className="h-3 w-3" />
              {t('team:subagentSection.returnToParent')}
            </button>
          ) : null}
        </div>
      )}

      {activeRuns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" title={t('team:subagentsHint')}>
          <span className="inline-flex items-center gap-1 text-2xs text-foreground-tertiary">
            <Bot className="h-3 w-3" />
            {t('team:subagents')}
          </span>
          {activeRuns.map((run) => {
            const runtimeLive = isSessionRunning(sessionRuntimeRunning, run.sessionFile)
            const isViewingThis = Boolean(historySessionFile && sessionFilesEqual(run.sessionFile, historySessionFile))
            const taskTitle = taskTitleById.get(run.taskId)
            const statusText = runtimeLive
              ? t('team:runRunning')
              : run.status === 'starting'
                ? t('team:runStarting')
                : run.status === 'running'
                  ? t('team:runRunning')
                  : t('team:runDone')
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => void open(run)}
                disabled={opening === run.id}
                title={`${run.taskId}${taskTitle ? ` · ${taskTitle}` : ''} · ${roleLabel(run.role, t)} · ${statusText}`}
                className={cn(
                  'inline-flex max-w-64 items-center gap-1 truncate rounded-full border py-0.5 pl-1.5 pr-2 text-2xs transition-colors disabled:opacity-50',
                  isViewingThis
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-border/60 bg-[var(--bg-hover)] text-foreground-secondary hover:border-amber-500/45 hover:text-foreground',
                )}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  data-live={runtimeLive}
                  style={{ background: runtimeLive ? 'var(--brand, #d97706)' : 'var(--warning-semantic)' }}
                />
                <span className="shrink-0 font-medium">{roleLabel(run.role, t)}</span>
                <span className="shrink-0 font-mono opacity-80">{run.taskId}</span>
                {taskTitle ? <span className="min-w-0 truncate opacity-75">{taskTitle}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
