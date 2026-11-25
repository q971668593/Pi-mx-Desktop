import { describe, expect, it } from 'vitest'
import { collectDelegateRuns, delegateRunFromItem, runningDelegateRuns } from './delegate-runs'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

function toolItem(overrides: Partial<TimelineItem>): TimelineItem {
  return {
    id: overrides.id ?? 'item',
    type: 'tool-call',
    toolName: 'acp_delegate',
    timestamp: 1_000,
    ...overrides,
  }
}

describe('delegateRunFromItem', () => {
  it('reads the delegate details off the tool row', () => {
    const run = delegateRunFromItem(
      toolItem({
        toolDetails: { kind: 'delegate', agent: 'researcher', runId: 'del_abc', task: '看代码', status: 'running' },
      }),
    )
    expect(run).toMatchObject({ runId: 'del_abc', agent: 'researcher', task: '看代码', state: 'running' })
  })

  it('ignores unrelated tool details', () => {
    expect(delegateRunFromItem(toolItem({ toolDetails: { kind: 'other' } }))).toBeNull()
    expect(delegateRunFromItem(toolItem({ toolDetails: null }))).toBeNull()
    expect(delegateRunFromItem({ id: 'x', type: 'user-message', timestamp: 1 })).toBeNull()
  })

  it('marks a failed delegate', () => {
    const run = delegateRunFromItem(
      toolItem({
        isError: true,
        toolDetails: { kind: 'delegate', agent: 'worker', runId: 'del_x', task: 't', status: 'running' },
      }),
    )
    expect(run?.state).toBe('failed')
  })
})

describe('collectDelegateRuns', () => {
  it('merges the dispatch row and the wait row by runId', () => {
    const runs = collectDelegateRuns([
      toolItem({
        id: 'a',
        timestamp: 1_000,
        toolDetails: { kind: 'delegate', agent: 'researcher', runId: 'del_1', task: '任务', status: 'running' },
      }),
      toolItem({
        id: 'b',
        timestamp: 2_000,
        toolName: 'acp_delegate_wait',
        toolDetails: {
          kind: 'delegate',
          agent: 'researcher',
          runId: 'del_1',
          task: '任务',
          status: 'completed',
          durationMs: 1234,
          file: 'C:/t/del_1.out',
        },
      }),
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      runId: 'del_1',
      state: 'completed',
      durationMs: 1234,
      file: 'C:/t/del_1.out',
      // 开始时间取派发那一行，不是 wait 那一行
      startedAt: 1_000,
    })
  })

  it('keeps two different runs apart and sorts newest first', () => {
    const runs = collectDelegateRuns([
      toolItem({
        id: 'a',
        timestamp: 1_000,
        toolDetails: { kind: 'delegate', agent: 'one', runId: 'del_1', task: 'a', status: 'running' },
      }),
      toolItem({
        id: 'b',
        timestamp: 5_000,
        toolDetails: { kind: 'delegate', agent: 'two', runId: 'del_2', task: 'b', status: 'running' },
      }),
    ])
    expect(runs.map((run) => run.runId)).toEqual(['del_2', 'del_1'])
    expect(runningDelegateRuns(runs)).toHaveLength(2)
  })

  it('never regresses a finished run back to running', () => {
    const runs = collectDelegateRuns([
      toolItem({
        id: 'a',
        timestamp: 1_000,
        toolDetails: { kind: 'delegate', agent: 'r', runId: 'del_1', task: 't', status: 'completed' },
      }),
      toolItem({
        id: 'b',
        timestamp: 2_000,
        toolDetails: { kind: 'delegate', agent: 'r', runId: 'del_1', task: 't', status: 'running' },
      }),
    ])
    expect(runs[0].state).toBe('completed')
    expect(runningDelegateRuns(runs)).toHaveLength(0)
  })
})
