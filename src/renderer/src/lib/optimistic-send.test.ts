import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { appendOptimisticOutgoingMessage, bindOptimisticOutgoingToSession, clearOptimisticOutgoing } from './optimistic-send'

describe('optimistic first send across navigation', () => {
  beforeEach(() => {
    useUIStore.setState({
      sessionStates: {}, viewSessionKey: null, currentWorkspace: '/workspace',
      currentSessionId: null, historySessionFile: null, pendingNewSessionPlaceholder: true,
      ephemeralSandboxDraft: false, sessionRuntimeRunning: {},
      timelineItems: [], runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    })
  })

  it('moves the pending turn to its created session after the view switches and rolls back there on failure', () => {
    const token = appendOptimisticOutgoingMessage('first message')!
    useUIStore.setState({ currentSessionId: 'other', historySessionFile: '/other.jsonl', pendingNewSessionPlaceholder: false })
    bindOptimisticOutgoingToSession(token, '/new.jsonl')
    expect(useUIStore.getState().timelineItems).toEqual([])
    const created = useUIStore.getState().sessionStates['/new.jsonl']
    expect(created.timelineItems.map((row) => row.text)).toEqual(['first message', ''])
    expect(created.agentTurnBootstrapping).toBe(true)
    expect(useUIStore.getState().sessionRuntimeRunning['/new.jsonl']).toBe(true)
    clearOptimisticOutgoing(token)
    expect(useUIStore.getState().sessionStates['/new.jsonl'].timelineItems).toEqual([])
    expect(useUIStore.getState().sessionRuntimeRunning['/new.jsonl']).toBeFalsy()
  })
})
