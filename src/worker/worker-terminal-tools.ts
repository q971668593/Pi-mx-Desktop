import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { sendToMain } from './worker-transport.js'
import type { WorkerIncomingMessage } from './worker-port-types.js'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const pending = new Map<string, { resolve: (value: ToolResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
let sequence = 0

export async function handleTerminalToolResponse(message: WorkerIncomingMessage): Promise<void> {
  const key = String(message.callId || '')
  const entry = pending.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(key)
  entry.resolve(message.result as ToolResult)
}

function callMain(args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const callId = `terminal-${process.pid}-${++sequence}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(callId); reject(new Error('terminal request timed out')) }, 30_000)
    pending.set(callId, { resolve, reject, timer })
    signal?.addEventListener('abort', () => {
      const entry = pending.get(callId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(callId)
      reject(new Error('aborted'))
    }, { once: true })
    sendToMain({ type: 'terminal-tool-request', callId, args })
  })
}

export const terminalToolsExtension: InlineExtension = {
  name: 'pi-desktop-terminal-tools',
  hidden: true,
  factory: (api: ExtensionAPI) => {
    api.registerTool({
      name: 'desktop_terminal',
      label: 'Desktop terminal',
      description: 'Manage the project terminals visible in the desktop sidebar. Use list to inspect running terminals and their recent output, start to launch a long-running command in a visible terminal, and restart to restart a terminal. Use this tool when the user asks to run or manage a service in the sidebar. Use the ordinary bash tool for short commands.',
      promptSnippet: 'Start and manage visible project terminals with desktop_terminal.',
      promptGuidelines: ['When the user asks to start, inspect, or restart a persistent development server or terminal, use desktop_terminal so it is visible in the right sidebar. Use bash for short commands.'],
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'start', 'restart'] },
          id: { type: 'string', description: 'Terminal ID for restart.' },
          command: { type: 'string', description: 'Executable to launch, e.g. npm. For shell syntax use bash or the appropriate shell with arguments. Supply it on restart when the terminal has no saved command.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments to the executable.' },
          cwd: { type: 'string', description: 'Working directory within the current project; defaults to the project root.' },
          label: { type: 'string', description: 'Short terminal label.' },
        },
        required: ['action'],
        additionalProperties: false,
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, args, signal) {
        const result = await callMain(args, signal)
        if (result.isError) throw new Error(result.content.map((item) => item.text).join('\n'))
        return { content: result.content, details: {} }
      },
    })
  },
}
