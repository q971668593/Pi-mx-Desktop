import { describe, expect, it } from 'vitest'
import type { AgentErrorEvent, CompletionEvent, MessageEvent, RunEvent, ToolEvent } from '@shared/app-events'
import { shouldForwardEventToRenderer } from './worker-event-filter'

const base = {
  seq: 1,
  workspaceId: '/repo',
  sessionFile: '/repo/.pi/s1.jsonl',
  timestamp: 1000,
}

const makeDelta = (contentKind: 'text' | 'thinking' = 'text'): MessageEvent => ({
  ...base,
  type: 'message',
  role: 'assistant',
  phase: 'delta',
  text: 'tok',
  contentKind,
})

describe('shouldForwardEventToRenderer', () => {
  it('allows foreground message deltas', () => {
    expect(
      shouldForwardEventToRenderer(makeDelta(), {
        fromPoolKey: 'session-a',
        foregroundPoolKey: 'session-a',
      }),
    ).toBe(true)
  })

  it('allows message deltas when foregroundPoolKey is null', () => {
    expect(
      shouldForwardEventToRenderer(makeDelta(), {
        fromPoolKey: 'session-b',
        foregroundPoolKey: null,
      }),
    ).toBe(true)
  })

  it('filters background non-foreground message deltas (text and thinking)', () => {
    expect(
      shouldForwardEventToRenderer(makeDelta('text'), {
        fromPoolKey: 'session-b',
        foregroundPoolKey: 'session-a',
      }),
    ).toBe(false)
    expect(
      shouldForwardEventToRenderer(makeDelta('thinking'), {
        fromPoolKey: 'session-b',
        foregroundPoolKey: 'session-a',
      }),
    ).toBe(false)
  })

  it('forwards background start/end message events, tool events, run events, completion, and errors', () => {
    const startMsg: MessageEvent = { ...base, type: 'message', role: 'assistant', phase: 'start' }
    const endMsg: MessageEvent = { ...base, type: 'message', role: 'assistant', phase: 'end', text: 'done' }
    const toolEv: ToolEvent = { ...base, type: 'tool', toolCallId: 't1', toolName: 'bash', phase: 'update' }
    const runEv: RunEvent = { ...base, type: 'run', phase: 'running' }
    const errEv: AgentErrorEvent = { ...base, type: 'agent_error', text: 'boom' }
    const compEv: CompletionEvent = { ...base, type: 'completion', outcome: 'success', settled: true }

    for (const ev of [startMsg, endMsg, toolEv, runEv, errEv, compEv]) {
      expect(
        shouldForwardEventToRenderer(ev, {
          fromPoolKey: 'session-b',
          foregroundPoolKey: 'session-a',
        }),
      ).toBe(true)
    }
  })
})
