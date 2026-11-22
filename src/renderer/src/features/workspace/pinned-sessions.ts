import { useSyncExternalStore } from 'react'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { selectSessionAttention, type SessionAttention } from '@renderer/lib/session-attention'
import type { SessionNode } from './project-session-tree'

export type SidebarSessionFilter = 'all' | 'running' | 'attention'

const STORAGE_KEY = 'pi-desktop:pinned-sessions:v1'
const listeners = new Set<() => void>()

function pinKey(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile)
}

function readStoredPins(): Set<string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map((item) => pinKey(String(item || ''))).filter(Boolean))
  } catch {
    return new Set()
  }
}

let cachedPins: Set<string> = readStoredPins()

function commitPins(next: Set<string>): void {
  cachedPins = next
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    }
  } catch {
    /* ignore storage quota errors */
  }
  for (const listener of listeners) listener()
}

export function reloadPinnedSessions(): void {
  cachedPins = readStoredPins()
  for (const listener of listeners) listener()
}

export function isSessionPinned(pins: ReadonlySet<string>, sessionFile: string | null | undefined): boolean {
  const key = pinKey(sessionFile)
  return !!key && pins.has(key)
}

/** Toggles pin status for `sessionFile`; returns `true` if now pinned. */
export function togglePinSession(sessionFile: string): boolean {
  const key = pinKey(sessionFile)
  if (!key) return false
  const next = new Set(cachedPins)
  const pinned = !next.has(key)
  if (pinned) next.add(key)
  else next.delete(key)
  commitPins(next)
  return pinned
}

export function usePinnedSessions(): ReadonlySet<string> {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => cachedPins,
    () => cachedPins,
  )
}

export function matchesAttentionFilter(
  attention: SessionAttention,
  filter: SidebarSessionFilter,
  liveChildRunning = false,
): boolean {
  if (filter === 'all') return true
  if (filter === 'running') return attention === 'working' || liveChildRunning
  return attention === 'needs-you' || attention === 'done'
}

export function filterNodesByStatus(
  nodes: SessionNode[],
  sessionAttention: Record<string, SessionAttention>,
  filter: SidebarSessionFilter,
): SessionNode[] {
  if (filter === 'all') return nodes
  const out: SessionNode[] = []
  for (const node of nodes) {
    const filteredChildren = filterNodesByStatus(node.children, sessionAttention, filter)
    const attention = selectSessionAttention(node.session.sessionFile, sessionAttention)
    const hasRunningLiveChild = node.liveChildren.some((c) => c.state === 'running') || node.liveChild?.state === 'running'
    const selfMatches = matchesAttentionFilter(attention, filter, hasRunningLiveChild)
    if (selfMatches || filteredChildren.length > 0) {
      out.push({ ...node, children: filteredChildren })
    }
  }
  return out
}

const ATTENTION_PRIORITY: Record<SessionAttention, number> = {
  'idle': 0,
  'done': 1,
  'working': 2,
  'needs-you': 3,
}

/** Aggregates the highest-priority attention state across a project's sessions. */
export function aggregateSessionsAttention(
  sessions: ReadonlyArray<{ sessionFile?: string }>,
  sessionAttention: Record<string, SessionAttention>,
): SessionAttention {
  let best: SessionAttention = 'idle'
  for (const s of sessions) {
    const next = selectSessionAttention(s.sessionFile, sessionAttention)
    if (ATTENTION_PRIORITY[next] > ATTENTION_PRIORITY[best]) {
      best = next
      if (best === 'needs-you') return best
    }
  }
  return best
}
