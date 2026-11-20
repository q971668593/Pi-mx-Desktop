import { afterEach, describe, expect, it } from 'vitest'
import { handleFlushqueue } from './worker-handlers-turn'
import { st } from '../worker-runtime'

const originalSession = st.session
const originalTurnActive = st.agentTurnActive

afterEach(() => {
  st.session = originalSession
  st.agentTurnActive = originalTurnActive
})

function fakeSession(overrides: Record<string, unknown> = {}) {
  const calls: { steer: string[]; prompt: string[] } = { steer: [], prompt: [] }
  const session = {
    isStreaming: false,
    clearQueue: () => ({ steering: ['先改 A'], followUp: ['然后跑测试'] }),
    steer: async (text: string) => { calls.steer.push(text) },
    prompt: async (text: string) => { calls.prompt.push(text) },
    ...overrides,
  }
  return { session, calls }
}

describe('handleFlushqueue 主动立即发送队列', () => {
  it('运行中把全部排队消息提升为 steer（最靠前的可投递点），不杀当前工具调用', async () => {
    const { session, calls } = fakeSession({ isStreaming: true })
    st.session = session as never
    const replies: Record<string, unknown>[] = []

    await handleFlushqueue({ type: 'flushQueue' } as never, (payload) => replies.push(payload))

    expect(calls.steer).toEqual(['先改 A', '然后跑测试'])
    expect(calls.prompt).toEqual([])
    expect(replies).toEqual([{ type: 'flushQueue-done', flushed: 2, mode: 'steer' }])
  })

  it('空闲时直接开一轮，把排队消息合并成一次 prompt', async () => {
    const { session, calls } = fakeSession()
    st.session = session as never
    st.agentTurnActive = false
    const replies: Record<string, unknown>[] = []

    await handleFlushqueue({ type: 'flushQueue' } as never, (payload) => replies.push(payload))

    expect(calls.steer).toEqual([])
    expect(calls.prompt).toEqual(['先改 A\n\n然后跑测试'])
    expect(replies[0]).toEqual({ type: 'flushQueue-done', flushed: 2, mode: 'prompt' })
    expect(st.agentTurnActive).toBe(false)
  })

  it('没有排队消息时不做任何事', async () => {
    const { session, calls } = fakeSession({ clearQueue: () => ({ steering: [], followUp: [] }) })
    st.session = session as never
    const replies: Record<string, unknown>[] = []

    await handleFlushqueue({ type: 'flushQueue' } as never, (payload) => replies.push(payload))

    expect(calls.steer).toEqual([])
    expect(calls.prompt).toEqual([])
    expect(replies).toEqual([{ type: 'flushQueue-done', flushed: 0, mode: 'none' }])
  })
})
