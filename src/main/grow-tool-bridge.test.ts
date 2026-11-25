import { describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('./ipc/registry', () => ({ invokeHandler: invoke }))
import { handleGrowToolRequest } from './grow-tool-bridge'

describe('grow tool bridge', () => {
  it('routes through the handler with the slot cwd and reports handler errors', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'revision_conflict', revision: 4 })
    const post = vi.fn()
    await handleGrowToolRequest({ callId: '1', args: { action: 'put_questions', workspaceId: '/other', sessionId: 's', round: 1, questions: [], expectedRevision: 3 } }, { cwd: '/trusted' }, post)
    expect(invoke).toHaveBeenCalledWith('ipc:grow:putQuestions', expect.objectContaining({ workspaceId: '/trusted', expectedRevision: 3 }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'grow-tool-response', callId: '1', result: expect.objectContaining({ isError: true }) }))
  })

  it('routes PRD context requests with the trusted workspace', async () => {
    const post = vi.fn()
    invoke.mockResolvedValueOnce({ ok: true, data: { prdHash: 'h', prdExists: true, trees: [] } })
    await handleGrowToolRequest({ callId: '6', args: { action: 'get_prd_context', workspaceId: '/other', sessionId: 's' } }, { cwd: '/trusted' }, post)
    expect(invoke).toHaveBeenCalledWith('ipc:grow-prd:projectContext', { workspaceId: '/trusted', sessionId: 's' })
    expect(post.mock.calls[0]?.[0].result.content[0].text).toContain('prdHash')
  })

  it('routes plan actions with the trusted workspace', async () => {
    const post = vi.fn()
    invoke.mockResolvedValue({ ok: true, revision: 5 })
    await handleGrowToolRequest({ callId: '4', args: { action: 'begin_plan', sessionId: 's', workspaceId: '/other' } }, { cwd: '/trusted' }, post)
    await handleGrowToolRequest({ callId: '5', args: { action: 'finish_plan', sessionId: 's', expectedRevision: 5 } }, { cwd: '/trusted' }, post)
    expect(invoke).toHaveBeenCalledWith('ipc:grow:beginPlan', { workspaceId: '/trusted', sessionId: 's' })
    expect(invoke).toHaveBeenCalledWith('ipc:grow:finishPlan', { workspaceId: '/trusted', sessionId: 's', expectedRevision: 5 })
  })

  it('returns validation and unknown-action failures to the worker', async () => {
    const post = vi.fn()
    invoke.mockRejectedValueOnce(new Error('invalid input'))
    await handleGrowToolRequest({ callId: '2', args: { action: 'get_state' } }, { cwd: '/trusted' }, post)
    await handleGrowToolRequest({ callId: '3', args: { action: 'bad' } }, { cwd: '/trusted' }, post)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls.map(([m]) => m.result.isError)).toEqual([true, true])
  })
})
