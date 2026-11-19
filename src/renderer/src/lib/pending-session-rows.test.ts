import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionItem } from '@renderer/features/workspace/project-sidebar-types'
import {
  PENDING_ROW_TTL_MS,
  clearPendingSessionRowsForTests,
  mergePendingSessionRows,
  pinPendingSessionRow,
} from './pending-session-rows'

const WS = 'D:/workspace/app'
const row = (over: Partial<SessionItem> = {}): SessionItem => ({
  sessionId: 'new-1',
  sessionFile: 'D:/sessions/new-1.jsonl',
  title: 'make a checklist',
  updatedAt: 1000,
  lastUserMessageAt: 1000,
  messageCount: 0,
  modelId: '',
  workspaceId: WS,
  ...over,
} as SessionItem)

beforeEach(() => clearPendingSessionRowsForTests())

describe('pending session rows', () => {
  it('keeps a new session visible when the list has not indexed it yet', () => {
    pinPendingSessionRow(WS, row())
    const merged = mergePendingSessionRows([], WS)
    expect(merged.map((s) => s.sessionId)).toEqual(['new-1'])
    // Still pinned: the next refresh may be just as stale.
    expect(mergePendingSessionRows([], WS).map((s) => s.sessionId)).toEqual(['new-1'])
  })

  it('keeps the first-message title while the server row has no messages', () => {
    pinPendingSessionRow(WS, row())
    const merged = mergePendingSessionRows([row({ title: '(no messages)', firstMessage: '', messageCount: 0 })], WS)
    expect(merged[0].title).toBe('make a checklist')
    // A later list that has read the transcript is authoritative.
    const settled = mergePendingSessionRows([row({ title: 'make a checklist', firstMessage: 'make a checklist', messageCount: 2 })], WS)
    expect(settled[0].messageCount).toBe(2)
    expect(mergePendingSessionRows([], WS)).toEqual([])
  })

  it('does not treat the pending row itself as a settled server row', () => {
    pinPendingSessionRow(WS, row())
    // This is what the optimistic insert sends: the pinned row is already in the list.
    const merged = mergePendingSessionRows([row()], WS)
    expect(merged).toHaveLength(1)
    // Still pinned, so the very next (stale) enumeration cannot drop it.
    expect(mergePendingSessionRows([], WS).map((s) => s.sessionId)).toEqual(['new-1'])
  })

  it('prepends the pending row instead of dropping it when other sessions exist', () => {
    pinPendingSessionRow(WS, row())
    const other = row({ sessionId: 'old-1', title: 'older' })
    expect(mergePendingSessionRows([other], WS).map((s) => s.sessionId)).toEqual(['new-1', 'old-1'])
  })

  it('ignores rows pinned for another workspace', () => {
    pinPendingSessionRow('D:/workspace/other', row())
    expect(mergePendingSessionRows([], WS)).toEqual([])
  })

  it('expires a pin that was never confirmed', () => {
    pinPendingSessionRow(WS, row(), 0)
    expect(mergePendingSessionRows([], WS, PENDING_ROW_TTL_MS + 1)).toEqual([])
  })
})
