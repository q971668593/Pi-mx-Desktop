import { describe, expect, it } from 'vitest'
import {
  derivePhase,
  exitLedgerCommands,
  initialSlotState,
  transition,
  turnEndCommands,
  turnStartCommands,
  type SlotEvent,
  type SlotPhase,
  type SlotState,
} from './worker-lifecycle-machine'

function state(phase: SlotPhase, sessionFile: string | null = '/s.jsonl', turnId: number | null = null): SlotState {
  return { phase, sessionFile, turnId, turnSeq: turnId ?? 0 }
}

const ALL_PHASES: SlotPhase[] = ['spawning', 'ready', 'busy', 'draining', 'dead']

/** 每种事件在每种状态下是否允许改变阶段（穷举断言用）。 */
const LEGAL: Record<SlotPhase, Partial<Record<SlotEvent['type'], SlotPhase[]>>> = {
  spawning: { 'spawn.ok': ['ready'], 'spawn.fail': ['dead'], 'stop.request': ['draining'], 'worker.exit': ['dead'], 'session.bind': ['spawning'] },
  ready: { 'turn.start': ['busy'], 'idle.timeout': ['draining'], 'stop.request': ['draining'], 'worker.exit': ['dead'], 'session.bind': ['ready'] },
  busy: { 'turn.end': ['ready'], 'stop.request': ['draining'], 'worker.exit': ['dead'], 'session.bind': ['busy'] },
  draining: { 'stop.done': ['dead'], 'worker.exit': ['dead'], 'stop.request': ['draining'] },
  dead: {},
}

const SAMPLE_EVENTS: SlotEvent[] = [
  { type: 'spawn.ok' },
  { type: 'spawn.fail', message: 'boom' },
  { type: 'session.bind', sessionFile: '/other.jsonl' },
  { type: 'turn.start' },
  { type: 'turn.end', outcome: 'idle' },
  { type: 'turn.end', outcome: 'failed' },
  { type: 'turn.end', outcome: 'cancelled' },
  { type: 'idle.timeout' },
  { type: 'stop.request' },
  { type: 'stop.done' },
  { type: 'worker.exit', code: 0 },
  { type: 'worker.exit', code: 1 },
]

describe('worker lifecycle machine', () => {
  it('starts in spawning with no session and no turn', () => {
    expect(initialSlotState()).toEqual({ phase: 'spawning', sessionFile: null, turnId: null, turnSeq: 0 })
  })

  it('runs the happy path: spawn → turn → idle turn end', () => {
    let result = transition(initialSlotState(), { type: 'spawn.ok' })
    expect(result.state.phase).toBe('ready')

    result = transition(result.state, { type: 'session.bind', sessionFile: '/a.jsonl' })
    expect(result.state.sessionFile).toBe('/a.jsonl')

    result = transition(result.state, { type: 'turn.start' })
    expect(result.state).toMatchObject({ phase: 'busy', turnId: 1 })
    expect(result.commands).toEqual([{ type: 'run.begin' }])

    result = transition(result.state, { type: 'turn.end', outcome: 'idle' })
    expect(result.state).toMatchObject({ phase: 'ready', turnId: null })
    expect(result.commands).toEqual([{ type: 'run.release' }])
  })

  it('increments turnId per turn so late events from the previous turn stay distinguishable', () => {
    let result = transition(state('ready'), { type: 'turn.start' })
    expect(result.state.turnId).toBe(1)
    result = transition(result.state, { type: 'turn.end', outcome: 'idle' })
    result = transition(result.state, { type: 'turn.start' })
    expect(result.state.turnId).toBe(2)
    expect(result.state.turnSeq).toBe(2)
  })

  it('ignores turn.end while ready (late run event must not release a run that never began)', () => {
    const result = transition(state('ready'), { type: 'turn.end', outcome: 'idle' })
    expect(result.state.phase).toBe('ready')
    expect(result.commands).toEqual([])
  })

  it('ignores turn.start while spawning or draining', () => {
    for (const phase of ['spawning', 'draining'] as SlotPhase[]) {
      const result = transition(state(phase), { type: 'turn.start' })
      expect(result.state.phase).toBe(phase)
      expect(result.commands).toEqual([])
    }
  })

  it('marks failed turns as orphans before releasing the ledger', () => {
    const result = transition(state('busy', '/s.jsonl', 1), { type: 'turn.end', outcome: 'failed' })
    expect(result.commands).toEqual([
      { type: 'run.mark-orphan', reason: 'turn-failed' },
      { type: 'run.release' },
    ])
  })

  it('never recycles a busy slot on idle timeout', () => {
    const result = transition(state('busy', '/s.jsonl', 1), { type: 'idle.timeout' })
    expect(result.state.phase).toBe('busy')
    expect(result.commands).toEqual([])
  })

  it('recycles an idle ready slot on timeout and disposes it', () => {
    const result = transition(state('ready'), { type: 'idle.timeout' })
    expect(result.state.phase).toBe('draining')
    expect(result.commands).toEqual([{ type: 'slot.dispose' }])
  })

  it('stop.request is idempotent', () => {
    const first = transition(state('ready'), { type: 'stop.request' })
    expect(first.commands).toEqual([{ type: 'slot.dispose' }])
    const second = transition(first.state, { type: 'stop.request' })
    expect(second.state).toBe(first.state)
    expect(second.commands).toEqual([])
  })

  it('stop.done is a no-op outside draining', () => {
    for (const phase of ['spawning', 'ready', 'busy'] as SlotPhase[]) {
      const result = transition(state(phase), { type: 'stop.done' })
      expect(result.state.phase).toBe(phase)
      expect(result.commands).toEqual([])
    }
  })

  it('stop.done is silent even if the slot was busy', () => {
    const result = transition(state('draining', '/s.jsonl', 3), { type: 'stop.done' })
    expect(result.state).toMatchObject({ phase: 'dead', turnId: null })
    expect(result.commands).toEqual([])
  })

  it('unexpected exit while busy notifies, orphans and releases', () => {
    const result = transition(state('busy', '/s.jsonl', 1), { type: 'worker.exit', code: 1 })
    expect(result.state.phase).toBe('dead')
    expect(result.commands).toEqual([
      { type: 'notify.fatal', message: 'Worker 已退出（code 1）' },
      { type: 'run.mark-orphan', reason: 'worker-exit:1' },
      { type: 'run.release' },
    ])
  })

  it('clean exit while busy only releases (no fatal noise)', () => {
    const result = transition(state('busy', '/s.jsonl', 1), { type: 'worker.exit', code: 0 })
    expect(result.commands).toEqual([{ type: 'run.release' }])
  })

  it('exit during draining is expected: no fatal, no run bookkeeping', () => {
    const result = transition(state('draining'), { type: 'worker.exit', code: 1 })
    expect(result.state.phase).toBe('dead')
    expect(result.commands).toEqual([])
  })

  it('nothing happens after dead (no double notify, no double dispose)', () => {
    for (const event of SAMPLE_EVENTS) {
      const result = transition(state('dead'), event)
      expect(result.state.phase).toBe('dead')
      expect(result.commands).toEqual([])
    }
  })

  it('exhaustive: every phase × event stays within the legal edges and never throws', () => {
    for (const phase of ALL_PHASES) {
      for (const event of SAMPLE_EVENTS) {
        const before = state(phase, '/s.jsonl', phase === 'busy' ? 1 : null)
        const result = transition(before, event)
        const allowed = LEGAL[phase][event.type]
        if (allowed) {
          expect(allowed).toContain(result.state.phase)
        } else {
          expect(result.state.phase).toBe(phase)
          expect(result.commands).toEqual([])
        }
        // 状态对象不可被原地修改
        expect(before.phase).toBe(phase)
      }
    }
  })

  it('derives the phase from the live slot fields', () => {
    expect(derivePhase({ stopping: true, agentTurnActive: true })).toBe('draining')
    expect(derivePhase({ stopping: false, agentTurnActive: true })).toBe('busy')
    expect(derivePhase({ stopping: false, agentTurnActive: false })).toBe('ready')
  })

  it('exitLedgerCommands: crash during a turn orphans + releases', () => {
    expect(exitLedgerCommands('busy', 1)).toEqual([
      { type: 'run.mark-orphan', reason: 'worker-exit:1' },
      { type: 'run.release' },
    ])
  })

  it('exitLedgerCommands: clean exit during a turn only releases', () => {
    expect(exitLedgerCommands('busy', 0)).toEqual([{ type: 'run.release' }])
  })

  it('exitLedgerCommands: crash while idle or draining touches nothing', () => {
    expect(exitLedgerCommands('ready', 1)).toEqual([])
    expect(exitLedgerCommands('draining', 1)).toEqual([])
    expect(exitLedgerCommands('dead', 1)).toEqual([])
  })

  it('turnStartCommands only begins a run from ready', () => {
    expect(turnStartCommands('ready')).toEqual([{ type: 'run.begin' }])
    expect(turnStartCommands('busy')).toEqual([])
    expect(turnStartCommands('draining')).toEqual([])
    expect(turnStartCommands('spawning')).toEqual([])
  })

  it('turnEndCommands only settles a tracked turn', () => {
    expect(turnEndCommands('busy', 'idle')).toEqual([{ type: 'run.release' }])
    expect(turnEndCommands('busy', 'cancelled')).toEqual([{ type: 'run.release' }])
    expect(turnEndCommands('busy', 'failed')).toEqual([
      { type: 'run.mark-orphan', reason: 'turn-failed' },
      { type: 'run.release' },
    ])
    expect(turnEndCommands('ready', 'idle')).toEqual([])
  })

  it('sessionFile survives every transition so routing keys stay stable', () => {
    for (const phase of ALL_PHASES) {
      for (const event of SAMPLE_EVENTS) {
        const result = transition(state(phase, '/keep.jsonl', 1), event)
        if (event.type === 'session.bind') continue
        if (result.state.phase === 'dead') continue
        expect(result.state.sessionFile).toBe('/keep.jsonl')
      }
    }
  })
})
