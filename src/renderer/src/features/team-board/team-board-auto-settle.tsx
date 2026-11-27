import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { AppEvent } from '@shared/app-events'
import type { TeamRun } from '@shared/team-board'
import i18n from '@renderer/lib/i18n'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  TEAM_BOARD_CHANGED_EVENT,
  TEAM_BOARD_RUNS_CHANGED_EVENT,
  notifyTeamBoardChanged,
} from './team-board-lib'

/**
 * 后台上工落账：面板派发的角色会话结束时（idle settled / failed / cancelled / completion），
 * 把记录交给主进程，成功的派发自动把卡片从「进行中」推进到「待审查」。
 *
 * 挂在 App 常驻位置（不在面板里），所以切到别的右侧栏标签、甚至看别的对话时也能落账；
 * 只跟踪 `协作/团队.json` 里登记过的派发，用户自己在角色会话里闲聊不会动看板。
 */
export function TeamBoardAutoSettle() {
  const workspaceId = useUIStore((state) => state.currentWorkspace)
  const runsRef = useRef(new Map<string, TeamRun>())
  const workspaceRef = useRef(workspaceId)
  const loadingRef = useRef(false)
  workspaceRef.current = workspaceId

  useEffect(() => {
    runsRef.current.clear()
    if (!workspaceId) return

    const load = async () => {
      if (loadingRef.current) return
      loadingRef.current = true
      try {
        const response = await ipcClient.invoke('teamBoard.activeRuns', { workspaceId })
        if (workspaceRef.current !== workspaceId) return
        const map = new Map<string, TeamRun>()
        for (const run of (response?.runs || []) as TeamRun[]) {
          map.set(normalizeSessionFileKey(run.sessionFile) || run.sessionFile, run)
        }
        runsRef.current = map
      } catch {
        /* 未初始化的项目没有看板：静默 */
      } finally {
        loadingRef.current = false
      }
    }

    void load()
    const onRunsChanged = () => void load()
    window.addEventListener(TEAM_BOARD_RUNS_CHANGED_EVENT, onRunsChanged)
    window.addEventListener(TEAM_BOARD_CHANGED_EVENT, onRunsChanged)
    return () => {
      window.removeEventListener(TEAM_BOARD_RUNS_CHANGED_EVENT, onRunsChanged)
      window.removeEventListener(TEAM_BOARD_CHANGED_EVENT, onRunsChanged)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    // 看门狗 tick：派发超过 30 分钟没有活动就标超时并把卡移到「阻塞 / 待用户确认」。
    // 主进程算，这里只负责隔一分钟叫一次；项目没初始化时静默。
    const sweep = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const response = await ipcClient.invoke('teamBoard.sweep', { workspaceId })
        if (cancelled) return
        const blocked = (response?.blocked || []) as string[]
        if (!blocked.length) return
        notifyTeamBoardChanged()
        toast.message(i18n.t('team:sweepBlocked', { count: blocked.length }), {
          description: blocked.join('、'),
        })
      } catch {
        /* 未初始化 / 工作区不可用时静默 */
      }
    }

    void sweep()
    const timer = setInterval(() => void sweep(), 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    const findMatch = (map: Map<string, TeamRun>, file: string): [string, TeamRun] | null => {
      const key = normalizeSessionFileKey(file) || file
      for (const [runKey, run] of map) {
        if (runKey === key || sessionFilesEqual(run.sessionFile, file)) return [runKey, run]
      }
      return null
    }
    const settleRun = (matchedKey: string, matched: TeamRun, outcome: 'success' | 'failed' | 'cancelled') => {
      // 先摘掉再调用：completion 和 settled 可能同一轮都到，避免重复落账。
      runsRef.current.delete(matchedKey)
      void ipcClient
        .invoke('teamBoard.settleRun', { workspaceId, sessionFile: matched.sessionFile, outcome, closedBy: 'host' })
        .then(() => notifyTeamBoardChanged())
        .catch(() => {})
    }

    return onAppEvent((event) => {
      const outcome = outcomeOf(event)
      if (!outcome || !('sessionFile' in event) || typeof event.sessionFile !== 'string' || !event.sessionFile) return
      const file = event.sessionFile
      const direct = findMatch(runsRef.current, file)
      if (direct) {
        settleRun(direct[0], direct[1], outcome)
        return
      }
      // 主进程通过 team_board 工具派发或打回返工时，面板未必打开；未命中缓存时懒拉一次活跃 Run。
      void ipcClient
        .invoke('teamBoard.activeRuns', { workspaceId })
        .then((response) => {
          if (workspaceRef.current !== workspaceId || !response?.exists) return
          const map = new Map<string, TeamRun>()
          for (const run of (response.runs || []) as TeamRun[]) {
            map.set(normalizeSessionFileKey(run.sessionFile) || run.sessionFile, run)
          }
          runsRef.current = map
          const lazy = findMatch(map, file)
          if (lazy) settleRun(lazy[0], lazy[1], outcome)
        })
        .catch(() => {})
    })
  }, [workspaceId])

  return null
}

function outcomeOf(event: AppEvent): 'success' | 'failed' | 'cancelled' | null {
  if (event.type === 'completion') return event.outcome
  if (event.type !== 'run') return null
  if (event.phase === 'failed') return 'failed'
  if (event.phase === 'cancelled') return 'cancelled'
  if (event.phase === 'idle' && event.settled === true) return 'success'
  return null
}
