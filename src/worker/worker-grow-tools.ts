import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { sendToMain } from './worker-transport.js'
import type { WorkerIncomingMessage } from './worker-port-types.js'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const pending = new Map<string, { resolve: (value: ToolResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; cleanup: () => void }>()
let sequence = 0

export async function handleGrowToolResponse(message: WorkerIncomingMessage): Promise<void> {
  const key = String(message.callId || '')
  const entry = pending.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(key)
  entry.cleanup()
  entry.resolve(message.result as ToolResult)
}

function callMain(args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const callId = `grow-${process.pid}-${++sequence}`
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const abort = () => {
      const entry = pending.get(callId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(callId)
      entry.cleanup()
      reject(new Error('aborted'))
    }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      pending.delete(callId)
      cleanup()
      reject(new Error('grow_tree request timed out'))
    }, 60_000)
    pending.set(callId, { resolve, reject, timer, cleanup })
    signal?.addEventListener('abort', abort, { once: true })
    try { sendToMain({ type: 'grow-tool-request', callId, args }) } catch (error) {
      clearTimeout(timer)
      pending.delete(callId)
      cleanup()
      reject(error)
    }
  })
}

export const growToolsExtension: InlineExtension = {
  name: 'pi-desktop-grow-tools',
  hidden: true,
  factory: (api: ExtensionAPI) => {
    api.registerTool({
      name: 'grow_tree',
      label: 'Grow tree',
      description: 'Read a Grow session and publish questions through the app. Use get_state before put_questions and pass its revision as expectedRevision. Before generating plan files call begin_plan; after writing 方案.html and task.manifest.json call finish_plan with the revision returned by begin_plan. On revision conflict, start again with begin_plan and regenerate from current state. Never edit tree.json directly. For user requests that change the project PRD or existing tree answers: first call get_prd_context (pass sessionId of the bound tree when known) to get basePrdHash, baseTreeRevision and the tree list, then emit one ```grow-prd-proposal fence with that JSON (fields: basePrdHash, treeSessionId, baseTreeRevision, reason, proposedPrd, nodeChanges[{nodeId, expectedOldAnswer|null, newAnswer}], newQuestions[]). Never write PRD or tree.json yourself; the user reviews the proposal in the app and confirms before anything is applied.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['get_state', 'put_questions', 'begin_plan', 'finish_plan', 'get_prd_context'] },
          sessionId: { type: 'string', description: 'Grow session id; required for put_questions, begin_plan and finish_plan.' },
          round: { type: 'integer', minimum: 1, maximum: 50 },
          expectedRevision: { type: 'integer', minimum: 0, description: 'For put_questions, revision from get_state; for finish_plan, required revision from begin_plan.' },
          questions: { type: 'array', minItems: 1, maxItems: 8, items: {
            type: 'object', properties: {
              id: { type: 'string', minLength: 1, maxLength: 64 },
              question: { type: 'string', minLength: 1, maxLength: 500 },
              rationale: { type: 'string', maxLength: 500 },
              depends_on: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 64 } },
              chapter_id: { type: 'string', minLength: 1, maxLength: 64 },
              kind: { type: 'string', enum: ['single', 'multiple', 'text'] },
              options: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 160 } },
            }, required: ['id', 'question'], additionalProperties: false,
          } },
        }, required: ['action'], additionalProperties: false,
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, args, signal) {
        const result = await callMain(args, signal)
        if (result.isError) throw new Error(result.content.map((item) => item.text).join('\n'))
        return { content: result.content, details: {} }
      },
    })
  },
}
