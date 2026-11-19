import type { SessionItem } from '@renderer/features/workspace/project-sidebar-types'
import { workspacePathKey } from '@shared/workspace-path'

/**
 * Rows for sessions that exist on screen but are not in `session.list` yet.
 *
 * `session.new` returns the new session file before the list process has indexed it, and the very
 * next refresh can therefore come back without it. Replacing the sidebar list with that answer made
 * a brand-new conversation vanish until the user clicked the project (which refreshed again). This
 * module keeps those rows pinned, prepends them to every list, and hands the row over to the server
 * answer only once it carries the first message (so the sidebar title is not "(no messages)").
 *
 * Pure data + a module-level map; no React, no IPC.
 */

export const PENDING_ROW_TTL_MS = 10 * 60_000

type Pending = { workspaceKey: string; row: SessionItem; pinnedAt: number }

const pending = new Map<string, Pending>()

const keyOf = (workspaceId: string, sessionId: string) => `${workspacePathKey(workspaceId)}\u0000${sessionId}`

/**
 * Only a row that has read at least one message is authoritative. "Has a title" is not enough:
 * the optimistic row carries a title too, and treating it as settled dropped the pin before the
 * list process had indexed the file.
 */
function isSettledListRow(row: SessionItem): boolean {
  return (row.messageCount ?? 0) > 0
}

/** Title the list process invents for a session it has not read yet ("(no messages)", raw id). */
function isPlaceholderTitle(row: SessionItem): boolean {
  const title = String(row.title ?? '')
  return !title || title.startsWith('(') || title === row.sessionId.slice(0, 8)
}

export function pinPendingSessionRow(workspaceId: string, row: SessionItem, now = Date.now()): void {
  if (!workspaceId || !row?.sessionId) return
  pending.set(keyOf(workspaceId, row.sessionId), { workspaceKey: workspacePathKey(workspaceId), row, pinnedAt: now })
}

export function unpinPendingSessionRow(workspaceId: string, sessionId: string): void {
  pending.delete(keyOf(workspaceId, sessionId))
}

export function clearPendingSessionRowsForTests(): void {
  pending.clear()
}

function livePending(workspaceId: string, now: number): SessionItem[] {
  const workspaceKey = workspacePathKey(workspaceId)
  const rows: SessionItem[] = []
  for (const [key, entry] of pending) {
    if (now - entry.pinnedAt > PENDING_ROW_TTL_MS) {
      pending.delete(key)
      continue
    }
    if (entry.workspaceKey === workspaceKey) rows.push(entry.row)
  }
  return rows
}

/**
 * Merge the pinned rows into a fresh `session.list` answer:
 *  - missing from the list   → prepended (still pinned),
 *  - listed without a title  → the pinned title wins (still pinned, so the next refresh keeps it),
 *  - listed with a title     → server truth wins and the row is unpinned.
 */
export function mergePendingSessionRows(list: SessionItem[], workspaceId: string, now = Date.now()): SessionItem[] {
  const pinned = livePending(workspaceId, now)
  if (pinned.length === 0) return list
  const byId = new Map(list.map((row) => [row.sessionId, row]))
  const extra: SessionItem[] = []
  for (const row of pinned) {
    const listed = byId.get(row.sessionId)
    if (!listed) {
      extra.push(row)
      continue
    }
    const settled = isSettledListRow(listed)
    byId.set(row.sessionId, {
      ...listed,
      // A user rename on an empty session wins over our first-message title.
      title: settled || !isPlaceholderTitle(listed) ? listed.title : row.title,
      firstMessage: listed.firstMessage || row.firstMessage,
      lastUserMessageAt: listed.lastUserMessageAt ?? row.lastUserMessageAt,
      updatedAt: Math.max(listed.updatedAt || 0, row.updatedAt || 0),
    })
    if (settled) unpinPendingSessionRow(workspaceId, row.sessionId)
  }
  const merged = list.map((row) => byId.get(row.sessionId) ?? row)
  return [...extra, ...merged]
}
