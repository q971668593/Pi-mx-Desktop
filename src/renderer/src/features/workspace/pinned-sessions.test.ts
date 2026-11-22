import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionNode } from './project-session-tree'
import {
  aggregateSessionsAttention,
  filterNodesByStatus,
  isSessionPinned,
  matchesAttentionFilter,
  reloadPinnedSessions,
  togglePinSession,
  usePinnedSessions,
} from './pinned-sessions'
import { renderHook, act } from '@testing-library/react'

const makeNode = (id: string, file: string, children: SessionNode[] = []): SessionNode => ({
  key: file,
  session: {
    sessionId: id,
    sessionFile: file,
    updatedAt: 1000,
    modelId: 'gpt-4o',
    title: id,
  },
  children,
  liveChildren: [],
})

describe('pinned-sessions & sidebar status filters', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadPinnedSessions()
  })

  it('persists and toggles pinned sessions in localStorage', () => {
    const { result } = renderHook(() => usePinnedSessions())
    expect(isSessionPinned(result.current, 'E:\\repo\\s1.jsonl')).toBe(false)

    act(() => {
      expect(togglePinSession('E:\\repo\\s1.jsonl')).toBe(true)
    })
    expect(isSessionPinned(result.current, 'e:/repo/s1.jsonl')).toBe(true)

    act(() => {
      expect(togglePinSession('e:/repo/s1.jsonl')).toBe(false)
    })
    expect(isSessionPinned(result.current, 'e:/repo/s1.jsonl')).toBe(false)
  })

  it('matches working / needs-you / done attention states accurately', () => {
    expect(matchesAttentionFilter('working', 'running')).toBe(true)
    expect(matchesAttentionFilter('done', 'running')).toBe(false)
    expect(matchesAttentionFilter('idle', 'running', true)).toBe(true)
    expect(matchesAttentionFilter('needs-you', 'attention')).toBe(true)
    expect(matchesAttentionFilter('done', 'attention')).toBe(true)
    expect(matchesAttentionFilter('working', 'attention')).toBe(false)
  })

  it('preserves parent node when only a child matches the status filter', () => {
    const child = makeNode('c1', '/repo/c1.jsonl')
    const parent = makeNode('p1', '/repo/p1.jsonl', [child])
    const other = makeNode('o1', '/repo/o1.jsonl')

    const filtered = filterNodesByStatus([parent, other], { '/repo/c1.jsonl': 'working' }, 'running')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].session.sessionId).toBe('p1')
    expect(filtered[0].children).toHaveLength(1)
  })

  it('aggregates project attention by severity needs-you > working > done > idle', () => {
    const sessions = [{ sessionFile: '/repo/s1.jsonl' }, { sessionFile: '/repo/s2.jsonl' }]
    expect(aggregateSessionsAttention(sessions, { '/repo/s1.jsonl': 'done', '/repo/s2.jsonl': 'working' })).toBe('working')
    expect(aggregateSessionsAttention(sessions, { '/repo/s1.jsonl': 'working', '/repo/s2.jsonl': 'needs-you' })).toBe('needs-you')
    expect(aggregateSessionsAttention(sessions, {})).toBe('idle')
  })
})
