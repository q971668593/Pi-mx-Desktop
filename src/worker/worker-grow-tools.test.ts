import { describe, expect, it, vi } from 'vitest'
const send = vi.hoisted(() => vi.fn())
vi.mock('./worker-transport.js', () => ({ sendToMain: send }))
import { growToolsExtension, handleGrowToolResponse } from './worker-grow-tools'

describe('grow worker tool', () => {
  it('routes responses and surfaces handler errors', async () => {
    let tool: any
    ;(growToolsExtension as any).factory({ registerTool: (value: unknown) => { tool = value } })
    const request = tool.execute('id', { action: 'get_state', sessionId: 's' })
    const message = send.mock.calls.at(-1)![0]
    expect(message).toMatchObject({ type: 'grow-tool-request', args: { action: 'get_state', sessionId: 's' } })
    await handleGrowToolResponse({ type: 'grow-tool-response', callId: message.callId, result: { content: [{ type: 'text', text: 'conflict' }], isError: true } } as any)
    await expect(request).rejects.toThrow('conflict')
  })
})
