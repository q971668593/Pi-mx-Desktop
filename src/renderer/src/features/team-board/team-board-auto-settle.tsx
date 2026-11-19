import { useEffect, useRef } from 'react'
import type { AppEvent } from '@shared/app-events'
import type { TeamRun } from '@shared/team-board'
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
    return onAppEvent((event) => {
      const outcome = outcomeOf(event)
      if (!outcome || !('sessionFile' in event) || typeof event.sessionFile !== 'string' || !event.sessionFile) return
      const file = event.sessionFile
      const key = normalizeSessionFileKey(file) || file
      let matchedKey = ''
      let matched: TeamRun | undefined
      for (const [runKey, run] of runsRef.current) {
        if (runKey === key || sessionFilesEqual(run.sessionFile, file)) {
          matchedKey = runKey
          matched = run
          break
        }
      }
      if (!matched) return
      // 先摘掉再调用：completion 和 settled 可能同一轮都到，避免重复落账。
      runsRef.current.delete(matchedKey)
      void ipcClient
        .invoke('teamBoard.settleRun', { workspaceId, sessionFile: matched.sessionFile, outcome })
        .then(() => notifyTeamBoardChanged())
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
