import leaderFace from '@renderer/assets/roles/leader-face.webp'
import leaderFull from '@renderer/assets/roles/leader.webp'
import designerFace from '@renderer/assets/roles/designer-face.webp'
import designerFull from '@renderer/assets/roles/designer.webp'
import frontendFace from '@renderer/assets/roles/frontend-face.webp'
import frontendFull from '@renderer/assets/roles/frontend.webp'
import backendFace from '@renderer/assets/roles/backend-face.webp'
import backendFull from '@renderer/assets/roles/backend.webp'
import testerFace from '@renderer/assets/roles/tester-face.webp'
import testerFull from '@renderer/assets/roles/tester.webp'
import { useSyncExternalStore } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { splitActions } from '@renderer/features/split/split-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TeamRole, TeamRun, TeamStage, TeamStatus, TeamTask } from '@shared/team-board'

/** 阶段色只表达「需要谁动手」，不替代泳道状态色。 */
export const STAGE_TONES: Record<TeamStage, 'danger' | 'warning' | 'success' | 'info' | 'neutral'> = {
  idle: 'neutral',
  queued: 'info',
  running: 'info',
  stale: 'warning',
  'awaiting-approval': 'danger',
  'awaiting-review': 'warning',
  blocked: 'danger',
  failed: 'danger',
  passed: 'info',
  accepted: 'success',
}

export function stageLabel(stage: TeamStage, t: (key: string) => string): string {
  return t(`team:stages.${stage}`)
}

/** 卡片上值得单独提一句的阶段：其它情况由泳道本身表达，不重复标签。 */
export const CARD_STAGES: ReadonlySet<TeamStage> = new Set<TeamStage>([
  'awaiting-approval',
  'stale',
  'failed',
])

export function needsAttention(task: TeamTask): boolean {
  return Boolean(task.approval) || task.blockType === '待用户确认'
}

export const TEAM_AVATARS: Record<TeamRole, { face: string; full: string }> = {
  Leader: { face: leaderFace, full: leaderFull },
  Builder: { face: frontendFace, full: frontendFull },
  Verifier: { face: testerFace, full: testerFull },
  Designer: { face: designerFace, full: designerFull },
}

/** 角色色只表示身份，不随状态/主题变。 */
export const ROLE_COLORS: Record<string, string> = {
  Leader: '#f59e0b',
  Builder: '#3b82f6',
  Verifier: '#eab308',
  Designer: '#ec4899',
  设计师: '#ec4899',
  前端: '#3b82f6',
  后端: '#10b981',
  质量测试: '#eab308',
  产品经理: '#a855f7',
  UI审查: '#eab308',
  测试: '#14b8a6',
}

export const STATUS_COLORS: Record<TeamStatus, string> = {
  待办: '#94a3b8',
  进行中: '#3b82f6',
  待审查: '#f59e0b',
  已通过: '#6366f1',
  阻塞: '#ef4444',
  已验收: '#10b981',
}

export function roleColor(role: string): string {
  return ROLE_COLORS[role] || '#64748b'
}

export function roleAvatar(role: string): string {
  const meta = TEAM_AVATARS[role as TeamRole] ?? (role === '后端' ? { face: backendFace, full: backendFull } : undefined)
  return meta?.face || meta?.full || TEAM_AVATARS.Leader.face
}

export function roleFullAvatar(role: string): string {
  const meta = TEAM_AVATARS[role as TeamRole] ?? (role === '后端' ? { face: backendFace, full: backendFull } : undefined)
  return meta?.full || TEAM_AVATARS.Leader.full
}

export function roleLabel(role: string, t: (key: string) => string): string {
  switch (role) {
    case 'Leader':
      return t('team:roles.Leader')
    case 'Builder':
      return t('team:roles.builder')
    case 'Verifier':
      return t('team:roles.verifier')
    case 'Designer':
      return t('team:roles.designer')
    case '设计师':
      return t('team:roles.designer')
    case '前端':
      return t('team:roles.frontend')
    case '后端':
      return t('team:roles.backend')
    case '质量测试':
      return t('team:roles.qa')
    default:
      return role || t('team:roles.unassigned')
  }
}

export function statusLabel(status: TeamStatus, t: (key: string) => string): string {
  switch (status) {
    case '待办':
      return t('team:statuses.todo')
    case '进行中':
      return t('team:statuses.inProgress')
    case '待审查':
      return t('team:statuses.review')
    case '已通过':
      return t('team:statuses.passed')
    case '阻塞':
      return t('team:statuses.blocked')
    case '已验收':
      return t('team:statuses.accepted')
    default:
      return status
  }
}

export function effortLabel(effort: string, t: (key: string) => string): string {
  if (!effort) return t('team:settings.defaultEffort')
  const known = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  return known.includes(effort) ? t(`team:efforts.${effort}`) : effort
}

export function shortModel(model: string): string {
  const value = String(model || '').trim()
  if (!value) return ''
  const slash = value.lastIndexOf('/')
  return slash >= 0 ? value.slice(slash + 1) : value
}

export function isSessionRunning(
  map: Record<string, boolean> | null | undefined,
  sessionFile: string | undefined,
): boolean {
  if (!map || !sessionFile) return false
  for (const [key, running] of Object.entries(map)) {
    if (running && sessionFilesEqual(key, sessionFile)) return true
  }
  return false
}

export function activeRun(task: TeamTask, runs: TeamRun[]): TeamRun | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    if (run.taskId !== task.id) continue
    if (run.status === 'starting' || run.status === 'running') return run
  }
  return undefined
}

export function latestRun(task: TeamTask, runs: TeamRun[]): TeamRun | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].taskId === task.id) return runs[i]
  }
  return undefined
}

export type TeamSubagentReturnTarget = {
  workspaceId: string
  sessionId: string
  sessionFile: string
  subagentSessionFile: string
  label?: string
}

let returnTarget: TeamSubagentReturnTarget | null = null
const returnListeners = new Set<() => void>()

function emitReturnChange(): void {
  for (const listener of returnListeners) listener()
}

export function rememberTeamSubagentReturn(target: TeamSubagentReturnTarget | null): void {
  returnTarget = target
  emitReturnChange()
}

export function clearTeamSubagentReturn(): void {
  if (!returnTarget) return
  returnTarget = null
  emitReturnChange()
}

export function getTeamSubagentReturn(): TeamSubagentReturnTarget | null {
  return returnTarget
}

function subscribeTeamSubagentReturn(listener: () => void): () => void {
  returnListeners.add(listener)
  return () => {
    returnListeners.delete(listener)
  }
}

export function useTeamSubagentReturn(): TeamSubagentReturnTarget | null {
  return useSyncExternalStore(subscribeTeamSubagentReturn, getTeamSubagentReturn, getTeamSubagentReturn)
}

export async function returnFromTeamSubagent(): Promise<boolean> {
  const target = returnTarget
  clearTeamSubagentReturn()
  if (!target) return false
  await activateWorkspace(target.workspaceId, {
    sessionId: target.sessionId,
    sessionFile: target.sessionFile,
  })
  return true
}

export function formatRunElapsed(startedAt: number, endedAt?: number, now = Date.now()): string {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return ''
  const end = typeof endedAt === 'number' && Number.isFinite(endedAt) && endedAt >= startedAt ? endedAt : now
  const totalSeconds = Math.max(0, Math.floor((end - startedAt) / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}h ${String(remainMinutes).padStart(2, '0')}m`
}

/**
 * 打开角色/子代理会话：优先用派发记录里的 sessionId；缺失时先 `session.prepare`，
 * 再回退到 worktree/主工作区会话列表补齐。
 * 始终以主工作区 `workspaceId` 激活视图，避免把临时 worktree 路径当成当前项目并卸载工作团队面板。
 */
export async function openTeamSession(input: {
  workspaceId: string
  sessionFile: string
  sessionId?: string | null
  worktreePath?: string | null
  rememberReturn?: boolean
  subagentLabel?: string
}): Promise<void> {
  const { workspaceId, sessionFile } = input
  let sessionId = input.sessionId || ''
  if (!sessionId) {
    const prepared = await ipcClient.invoke('session.prepare', { sessionFile, bind: false }).catch(() => null)
    if (prepared?.sessionId) sessionId = String(prepared.sessionId)
  }
  if (!sessionId) {
    const lookupWorkspace = input.worktreePath || workspaceId
    const list = await ipcClient.invoke('session.list', { workspaceId: lookupWorkspace, refresh: true }).catch(() => null)
    const rows = (list?.sessions || []) as Array<{ sessionId?: string; sessionFile?: string }>
    sessionId = rows.find((row) => row.sessionFile && sessionFilesEqual(row.sessionFile, sessionFile))?.sessionId || ''
  }
  if (!sessionId) throw new Error('session id not found for ' + sessionFile)

  if (input.rememberReturn) {
    const ui = useUIStore.getState()
    const currentFile = ui.historySessionFile
    const currentId = ui.currentSessionId
    if (currentFile && currentId && !sessionFilesEqual(currentFile, sessionFile)) {
      const existing = returnTarget
      if (existing && sessionFilesEqual(existing.subagentSessionFile, currentFile)) {
        rememberTeamSubagentReturn({
          ...existing,
          subagentSessionFile: sessionFile,
          label: input.subagentLabel ?? existing.label,
        })
      } else {
        rememberTeamSubagentReturn({
          workspaceId: ui.currentWorkspace || workspaceId,
          sessionId: currentId,
          sessionFile: currentFile,
          subagentSessionFile: sessionFile,
          label: input.subagentLabel,
        })
      }
    }
  } else {
    clearTeamSubagentReturn()
  }

  await activateWorkspace(workspaceId, { sessionId, sessionFile })
}

/** 在右侧分屏中直接打开子代理会话，左侧继续保持当前对话（如 Leader）。 */
export async function openTeamSessionInSplit(input: {
  workspaceId: string
  sessionFile: string
  sessionId?: string | null
  worktreePath?: string | null
  title?: string
}): Promise<boolean> {
  const { workspaceId, sessionFile } = input
  let sessionId = input.sessionId || ''
  if (!sessionId) {
    const prepared = await ipcClient.invoke('session.prepare', { sessionFile, bind: false }).catch(() => null)
    if (prepared?.sessionId) sessionId = String(prepared.sessionId)
  }
  if (!sessionId) {
    const lookupWorkspace = input.worktreePath || workspaceId
    const list = await ipcClient.invoke('session.list', { workspaceId: lookupWorkspace, refresh: true }).catch(() => null)
    const rows = (list?.sessions || []) as Array<{ sessionId?: string; sessionFile?: string }>
    sessionId = rows.find((row) => row.sessionFile && sessionFilesEqual(row.sessionFile, sessionFile))?.sessionId || ''
  }
  if (!sessionId) throw new Error('session id not found for ' + sessionFile)
  return splitActions.open(
    {
      sessionId,
      sessionFile,
      workspace: workspaceId,
      title: input.title || '',
    },
    { side: 'right' },
  )
}

/** 会话结束后让面板刷新（side panel 与后台 watcher 的轻量信号）。 */
export const TEAM_BOARD_CHANGED_EVENT = 'pi-desktop:team-board-changed'
export const TEAM_BOARD_RUNS_CHANGED_EVENT = 'pi-desktop:team-board-runs-changed'

export function notifyTeamBoardChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(TEAM_BOARD_CHANGED_EVENT))
  } catch {
    /* noop */
  }
}

export function notifyTeamRunsChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(TEAM_BOARD_RUNS_CHANGED_EVENT))
  } catch {
    /* noop */
  }
}

export function sessionFileName(sessionFile: string): string {
  const normalized = String(sessionFile || '').split(String.fromCharCode(92)).join('/')
  return normalized.split('/').filter(Boolean).pop() || normalized
}
