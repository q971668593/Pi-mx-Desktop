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
      description: 'Manage the project terminals visible in the desktop sidebar. One terminal per job: start types into an idle terminal this tool opened earlier (clearing it first), and when the command is a dev server it replaces the one already serving the same directory instead of opening a second one, so ports never conflict. Use list to see the running terminals with their ports, restart to re-run one (same id, fresh shell), and close when done (all:true for every terminal this tool opened). Never keep two servers for the same project. Terminals the user opened are never reused or closed.',
      promptSnippet: 'Start and manage visible project terminals with desktop_terminal.',
      promptGuidelines: [
        'When the user asks to start, inspect, or restart a persistent development server or terminal, use desktop_terminal so it is visible in the right sidebar. Use bash for short commands.',
        'Never open a second terminal for the same project to run something again: call desktop_terminal list first, then restart the terminal that is still serving (its ports are in the list). A fresh terminal for a dev server only moves it to another port and leaves the old process running.',
        'Reuse a terminal instead of adding another: desktop_terminal start clears and reuses an idle terminal it opened earlier, so run your checks one after another in the same terminal rather than starting a new one per command.',
        'When you no longer need the terminals you opened (finished checks, stopped processes), close them with desktop_terminal close — close all:true at the end of a task. Never close or reuse a terminal the user opened: the tool refuses terminals it did not create.',
      ],
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'start', 'restart', 'close'] },
          id: { type: 'string', description: 'Terminal ID for restart or close.' },
          command: { type: 'string', description: 'Executable to launch, e.g. npm. For shell syntax use bash or the appropriate shell with arguments. Supply it on restart when the terminal has no saved command.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments to the executable.' },
          cwd: { type: 'string', description: 'Working directory within the current project; defaults to the project root.' },
          label: { type: 'string', description: 'Short terminal label.' },
          replace: { type: 'boolean', description: 'start only: stop the AI terminal already serving this directory and run the command in its place. Use it when you need a visibly fresh shell; a dev server is replaced automatically even without it.' },
          all: { type: 'boolean', description: 'close only: close every terminal this tool opened in the project.' },
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
