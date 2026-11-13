import { describe, expect, it, vi } from 'vitest'

const sent = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./worker-transport.js', () => ({ sendToMain: (message: Record<string, unknown>) => sent.push(message) }))

import { handleTerminalToolResponse, terminalToolsExtension } from './worker-terminal-tools'

describe('desktop terminal tool', () => {
  it('forwards tool calls and returns the matching terminal result', async () => {
    let definition: { execute: (id: string, args: unknown) => Promise<unknown> } | undefined
    await (terminalToolsExtension as { factory: (api: unknown) => void }).factory({ registerTool: (value: typeof definition) => { definition = value } })
    const result = definition!.execute('call', { action: 'list' })
    const request = sent.at(-1)!
    expect(request).toMatchObject({ type: 'terminal-tool-request', args: { action: 'list' } })
    await handleTerminalToolResponse({ type: 'terminal-tool-response', callId: request.callId, result: { content: [{ type: 'text', text: '{"terminals":[]}' }] } })
    await expect(result).resolves.toMatchObject({ content: [{ type: 'text', text: '{"terminals":[]}' }] })
  })
})
