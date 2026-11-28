import { extractToolText } from '@extension-compat/renderer/tool-output'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { sessionKeyOf, type SessionState } from '@renderer/stores/session-state'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import type { TeamRun } from '@shared/team-board'
import { shortModel } from './team-board-lib'

export function findSessionStateForRun(
  sessionStates: Record<string, SessionState> | undefined,
  sessionFile: string,
): SessionState | undefined {
  if (!sessionStates || !sessionFile) return undefined
  const key = sessionKeyOf(sessionFile)
  if (key && sessionStates[key]) return sessionStates[key]
  if (sessionStates[sessionFile]) return sessionStates[sessionFile]
  for (const [entryKey, state] of Object.entries(sessionStates)) {
    if (sessionFilesEqual(entryKey, sessionFile) || (state.workerLiveSnapshot?.sessionFile && sessionFilesEqual(state.workerLiveSnapshot.sessionFile, sessionFile))) {
      return state
    }
  }
  return undefined
}

function fileBaseName(value: string): string {
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || value
}

export const SILENT_WARNING_MS = 90_000

export type SubagentActivityStep = {
  id: string
  kind: 'tool' | 'error' | 'message'
  text: string
  isError?: boolean
  isRunning?: boolean
  timestamp: number
}

export type SubagentTelemetry = {
  slot?: number
  model: string
  currentAction: string
  toolCount: number
  fileCount: number
  errorCount: number
  lastActivityAt: number
  silentMs: number
  isSilentWarning: boolean
  recentSteps: SubagentActivityStep[]
}

/** 给同时在跑的子代理按角色分配稳定工位号（Builder #1、Builder #2…），同一张卡在列表和看板卡片保持同号。 */
export function assignRunSlots(runs: readonly TeamRun[]): Map<string, number> {
  const active = runs
    .filter((run) => run.status === 'starting' || run.status === 'running')
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  const counters = new Map<string, number>()
  const slots = new Map<string, number>()
  for (const run of active) {
    const next = (counters.get(run.role) ?? 0) + 1
    counters.set(run.role, next)
    slots.set(run.id, next)
  }
  return slots
}

export function formatWorkerBadge(roleLabelText: string, slot?: number): string {
  return slot ? `${roleLabelText} #${slot}` : roleLabelText
}

function argString(args: unknown, keys: string[]): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const record = args as Record<string, unknown>
  for (const key of keys) {
    const val = record[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return ''
}

function clipText(value: string, max = 52): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}

export function describeToolCall(item: TimelineItem): string {
  const name = (item.toolName || '').toLowerCase()
  const statusLine = typeof item.toolStatusLine === 'string' ? item.toolStatusLine.trim() : ''
  const filePath = argString(item.toolArgs, ['path', 'file_path', 'filePath', 'target_file'])
  const fileBase = filePath ? fileBaseName(filePath) : ''
  if (name === 'edit' || name === 'write' || name === 'insert') {
    return fileBase ? `编辑 ${fileBase}` : statusLine || '编辑文件'
  }
  if (name === 'read' || name === 'ls') {
    return fileBase ? `读取 ${fileBase}` : statusLine || '查看文件'
  }
  if (name === 'bash') {
    const cmd = argString(item.toolArgs, ['command', 'cmd'])
    return cmd ? `运行 ${clipText(cmd, 38)}` : statusLine || '执行命令'
  }
  if (name === 'grep' || name === 'ffgrep' || name === 'find' || name === 'fffind') {
    const pattern = argString(item.toolArgs, ['pattern', 'query', 'glob'])
    return pattern ? `搜索 ${clipText(pattern, 32)}` : statusLine || '搜索代码'
  }
  if (name === 'team_board') {
    const action = argString(item.toolArgs, ['action'])
    return action ? `看板 · ${action}` : '更新看板'
  }
  if (statusLine) return clipText(statusLine, 48)
  const outputPreview = extractToolText(item.toolOutput || '')
  if (outputPreview && item.toolPhase !== 'start') {
    return `${item.toolName || 'tool'}`
  }
  return item.toolName || 'tool'
}

export function extractSubagentTelemetry(input: {
  run: TeamRun
  sessionState?: SessionState
  fallbackModel?: string
  slot?: number
  nowMs: number
}): SubagentTelemetry {
  const { run, sessionState, fallbackModel, slot, nowMs } = input
  const items = sessionState?.timelineItems ?? []
  const runState = sessionState?.runState
  const isActive = run.status === 'starting' || run.status === 'running'
  const model = runState?.model || run.model || fallbackModel || ''

  const touchedFiles = new Set<string>()
  for (const fc of sessionState?.fileChanges ?? []) {
    if (fc.path) touchedFiles.add(fc.path.replace(/\\/g, '/').toLowerCase())
  }

  let toolItems = 0
  let errItems = 0
  let lastTs = Number.isFinite(run.startedAt) ? run.startedAt : 0
  let latestActiveTool = ''
  const steps: SubagentActivityStep[] = []

  for (const item of items) {
    if (typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp > lastTs) {
      lastTs = item.timestamp
    }
    if (item.type === 'tool-call') {
      toolItems += 1
      if (item.isError) errItems += 1
      const name = (item.toolName || '').toLowerCase()
      if (name === 'edit' || name === 'write' || name === 'insert') {
        const p = argString(item.toolArgs, ['path', 'file_path', 'filePath', 'target_file'])
        if (p) touchedFiles.add(p.replace(/\\/g, '/').toLowerCase())
      }
      const running = item.toolPhase === 'start' || item.toolPhase === 'update'
      const desc = describeToolCall(item)
      if (running) latestActiveTool = desc
      steps.push({
        id: item.id,
        kind: 'tool',
        text: desc,
        isError: item.isError,
        isRunning: running,
        timestamp: item.timestamp,
      })
    } else if (item.type === 'error') {
      errItems += 1
      const errText = clipText(String(item.text || '执行出错'), 60)
      steps.push({
        id: item.id,
        kind: 'error',
        text: errText,
        isError: true,
        timestamp: item.timestamp,
      })
    } else if (item.type === 'assistant-message') {
      const txt = String(item.text || '').trim()
      if (txt) {
        steps.push({
          id: item.id,
          kind: 'message',
          text: clipText(txt, 64),
          timestamp: item.timestamp,
        })
      }
    }
  }

  const toolCount = Math.max(runState?.toolCount ?? 0, toolItems)
  const errorCount = Math.max(runState?.errorCount ?? 0, errItems)
  const fileCount = touchedFiles.size

  let currentAction = ''
  if (isActive) {
    if (latestActiveTool) currentAction = latestActiveTool
    else if (runState?.activeToolStatus) currentAction = clipText(runState.activeToolStatus, 48)
    else if (runState?.activeTool) currentAction = runState.activeTool
    else if (sessionState?.streamingAssistantId) currentAction = '正在生成回复…'
    else if (runState?.status === 'running') currentAction = '思考中…'
    else if (steps.length > 0) currentAction = steps[steps.length - 1].text
    else if (model) currentAction = `模型 ${shortModel(model)}`
  } else if (run.report?.text) {
    currentAction = clipText(run.report.text, 52)
  } else if (steps.length > 0) {
    currentAction = steps[steps.length - 1].text
  }

  const silentMs = isActive && lastTs > 0 ? Math.max(0, nowMs - lastTs) : 0
  const isSilentWarning = isActive && !run.staleAt && lastTs > 0 && silentMs >= SILENT_WARNING_MS

  return {
    slot,
    model,
    currentAction,
    toolCount,
    fileCount,
    errorCount,
    lastActivityAt: lastTs,
    silentMs,
    isSilentWarning,
    recentSteps: steps.slice(-4).reverse(),
  }
}
