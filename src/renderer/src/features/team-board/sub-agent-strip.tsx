import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { usePaneSessionIdentity } from '@renderer/stores/pane-session-context'
import { openTeamSession, TEAM_BOARD_CHANGED_EVENT, TEAM_BOARD_RUNS_CHANGED_EVENT, notifyTeamBoardChanged, roleLabel } from './team-board-lib'
import type { TeamRun } from '@shared/team-board'

/**
 * 对话顶部的子 Agent 条：当前项目正在跑的派发一目了然，点某一个就跳到它的会话看执行细节。
 * 没有在跑的东西就不渲染，不占地方。
 */
export function SubAgentStrip() {
  const { t } = useTranslation()
  const workspaceId = usePaneSessionIdentity().workspace || ''
  const [runs, setRuns] = useState<TeamRun[]>([])
  const [opening, setOpening] = useState('')

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setRuns([])
      return
    }
    try {
      const response = await ipcClient.invoke('teamBoard.activeRuns', { workspaceId })
      setRuns(Array.isArray(response?.runs) ? response.runs : [])
    } catch {
      /* 看板还没初始化或读失败：条直接不显示 */
    }
  }, [workspaceId])

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

  if (!workspaceId || runs.length === 0) return null

  const open = async (run: TeamRun) => {
    if (opening) return
    setOpening(run.id)
    try {
      await openTeamSession({ workspaceId, sessionFile: run.sessionFile, sessionId: run.sessionId })
      notifyTeamBoardChanged()
    } finally {
      setOpening('')
    }
  }

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1" title={t('team:subagentsHint')}>
      <span className="inline-flex items-center gap-1 text-2xs text-foreground-tertiary">
        <Bot className="h-3 w-3" />
        {t('team:subagents')}
      </span>
      {runs.map((run) => {
        const live = run.status === 'running'
        return (
          <button
            key={run.id}
            type="button"
            onClick={() => void open(run)}
            disabled={opening === run.id}
            title={`${run.taskId} · ${roleLabel(run.role, t)} · ${t(`team:stages.${run.status}`)}${run.report ? ` · ${run.report}` : ''}`}
            className="inline-flex max-w-55 items-center gap-1 truncate rounded-full border border-border/50 bg-[var(--bg-hover)] py-0.5 pl-1.5 pr-2 text-2xs text-foreground-secondary hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              data-live={live}
              style={{ background: live ? 'var(--primary)' : 'var(--warning-semantic)' }}
            />
            <span className="truncate font-medium">{roleLabel(run.role, t)}</span>
            <span className="shrink-0 font-mono opacity-80">{run.taskId}</span>
          </button>
        )
      })}
    </div>
  )
}
