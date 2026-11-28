import { randomUUID } from 'node:crypto'
import {
  TEAM_RUN_REPORT_KINDS,
  canonicalTeamRole,
  emptyTeamState,
  isTeamRole,
  normalizeTeamRoleBindings,
  sanitizeTeamText,
  type TeamRoleBinding,
  type TeamRun,
  type TeamRunReport,
  type TeamRunReportKind,
  type TeamRunStatus,
  type TeamState,
  type TeamStatus,
} from '@shared/team-board'

const RUN_STATUSES: TeamRunStatus[] = ['starting', 'running', 'done', 'failed', 'cancelled']

function normalizeReport(value: unknown): TeamRunReport | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const kind = String(record.kind ?? '')
  if (!(TEAM_RUN_REPORT_KINDS as readonly string[]).includes(kind)) return undefined
  const verdict =
    record.verdict === 'deliver' || record.verdict === 'hold' || record.verdict === 'discard' ? record.verdict : undefined
  return {
    kind: kind as TeamRunReportKind,
    ...(typeof record.text === 'string' && record.text.trim()
      ? { text: sanitizeTeamText(record.text, 300) }
      : {}),
    at: typeof record.at === 'number' ? record.at : Date.now(),
    ...(verdict ? { verdict } : {}),
  }
}

function normalizeRun(value: unknown): TeamRun | null {
  if (!value || typeof value !== 'object') return null
  const run = value as Record<string, unknown>
  if (typeof run.sessionFile !== 'string' || !run.sessionFile) return null
  const role = canonicalTeamRole(run.role)
  const status = String(run.status ?? '') as TeamRunStatus
  const report = normalizeReport(run.report)
  return {
    id: typeof run.id === 'string' && run.id ? run.id : randomUUID(),
    taskId: typeof run.taskId === 'string' ? run.taskId : '',
    role,
    sessionFile: run.sessionFile,
    ...(typeof run.sessionId === 'string' && run.sessionId ? { sessionId: run.sessionId } : {}),
    ...(typeof run.model === 'string' && run.model ? { model: sanitizeTeamText(run.model, 200) } : {}),
    ...(typeof run.originSessionFile === 'string' && run.originSessionFile ? { originSessionFile: run.originSessionFile } : {}),
    status: RUN_STATUSES.includes(status) ? status : 'done',
    startedAt: typeof run.startedAt === 'number' ? run.startedAt : 0,
    ...(typeof run.endedAt === 'number' ? { endedAt: run.endedAt } : {}),
    ...(typeof run.settledTo === 'string' ? { settledTo: run.settledTo as TeamStatus } : {}),
    ...(report ? { report } : {}),
    ...(typeof run.worktreePath === 'string' && run.worktreePath ? { worktreePath: sanitizeTeamText(run.worktreePath, 500) } : {}),
    ...(typeof run.branch === 'string' && run.branch ? { branch: sanitizeTeamText(run.branch, 120) } : {}),
    ...(typeof run.staleAt === 'number' ? { staleAt: run.staleAt } : {}),
    ...(run.closedBy === 'human' || run.closedBy === 'host' ? { closedBy: run.closedBy } : {}),
  }
}

export function parseTeamState(text: string): TeamState {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? normalizeTeamState(parsed as Partial<TeamState>) : emptyTeamState()
  } catch {
    return emptyTeamState()
  }
}

function normalizeSessionMap(raw: unknown): TeamState['sessions'] {
  const sessions: TeamState['sessions'] = {}
  if (raw && typeof raw === 'object') {
    for (const [role, value] of Object.entries(raw)) {
      const canonical = canonicalTeamRole(role)
      if (!isTeamRole(canonical) || !value || typeof value !== 'object') continue
      const entry = value as { sessionFile?: unknown; sessionId?: unknown; updatedAt?: unknown }
      if (typeof entry.sessionFile !== 'string' || !entry.sessionFile) continue
      sessions[canonical] = {
        sessionFile: entry.sessionFile,
        ...(typeof entry.sessionId === 'string' && entry.sessionId ? { sessionId: entry.sessionId } : {}),
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
      }
    }
  }
  return sessions
}

function normalizeTeamState(parsed: Partial<TeamState>): TeamState {
  const sessions = normalizeSessionMap(parsed.sessions)
  const runs: TeamRun[] = Array.isArray(parsed.runs)
    ? parsed.runs.map(normalizeRun).filter((run): run is TeamRun => !!run).slice(-200)
    : []

  let sessionRoles: Record<string, TeamRoleBinding[]> | undefined
  if (parsed.sessionRoles && typeof parsed.sessionRoles === 'object') {
    const entries = Object.entries(parsed.sessionRoles).slice(-80)
    const next: Record<string, TeamRoleBinding[]> = {}
    for (const [key, value] of entries) {
      if (!key || !Array.isArray(value)) continue
      next[key] = normalizeTeamRoleBindings(value)
    }
    if (Object.keys(next).length > 0) sessionRoles = next
  }

  let sessionRoleSessions: Record<string, TeamState['sessions']> | undefined
  if (parsed.sessionRoleSessions && typeof parsed.sessionRoleSessions === 'object') {
    const entries = Object.entries(parsed.sessionRoleSessions).slice(-80)
    const next: Record<string, TeamState['sessions']> = {}
    for (const [key, value] of entries) {
      if (!key) continue
      const normalized = normalizeSessionMap(value)
      if (Object.keys(normalized).length > 0) next[key] = normalized
    }
    if (Object.keys(next).length > 0) sessionRoleSessions = next
  }

  return {
    version: 1,
    sessions,
    runs,
    ...(sessionRoles ? { sessionRoles } : {}),
    ...(sessionRoleSessions ? { sessionRoleSessions } : {}),
  }
}
