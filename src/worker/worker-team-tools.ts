import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { sendToMain } from './worker-transport.js'
import type { WorkerIncomingMessage } from './worker-port-types.js'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const pending = new Map<string, { resolve: (value: ToolResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
let sequence = 0

export async function handleTeamToolResponse(message: WorkerIncomingMessage): Promise<void> {
  const key = String(message.callId || '')
  const entry = pending.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(key)
  entry.resolve(message.result as ToolResult)
}

function callMain(args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const callId = `team-${process.pid}-${++sequence}`
  return new Promise((resolve, reject) => {
    // 派发要起一个后台会话：给足 5 分钟，别让正常的建会话被当成超时。
    const timer = setTimeout(() => {
      pending.delete(callId)
      reject(new Error('team_board request timed out'))
    }, 300_000)
    pending.set(callId, { resolve, reject, timer })
    signal?.addEventListener('abort', () => {
      const entry = pending.get(callId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(callId)
      reject(new Error('aborted'))
    }, { once: true })
    sendToMain({ type: 'team-tool-request', callId, args })
  })
}

/**
 * `team_board`：工作团队看板的写入通道。
 *
 * 没有这个工具时，Leader 只能干聊（提示词又不许它改看板），于是它把活自己干了、
 * 面板永远是 0 张卡。这个工具把「拆卡 / 改状态 / 派发」变成模型可调用的动作，
 * 落盘与派发仍然走主进程里面板用的同一套函数。
 */
export const teamToolsExtension: InlineExtension = {
  name: 'pi-desktop-team-tools',
  hidden: true,
  factory: (api: ExtensionAPI) => {
    api.registerTool({
      name: 'team_board',
      label: 'Work team board',
      description:
        'Read and write the project work-team board (.文档/开发规范/看板/当前批次.md). Use action=snapshot to see the batch, goals, roles and task cards; action=create_task to add 1-12 cards for the roles; action=dispatch to hand a card to its role in a background session; action=move_task to move a card between 待办/进行中/待审查/阻塞/实现完成; action=comment to append a note to a card. Cards created here show up in the right-panel 工作团队 board immediately, and a dispatched card lands in 待审查 by itself when that session finishes. Never mark a card 已验收 — only the human confirms acceptance.',
      promptSnippet: 'Split the PRD into task cards and dispatch them on the work-team board with team_board.',
      promptGuidelines: [
        'When the user asks to break work down, split it into cards with team_board action=create_task (one card per independently verifiable deliverable, each with role + concrete acceptance items), then dispatch the ones that can start now.',
        'Read the board first (action=snapshot) so you reuse existing card ids instead of creating duplicates.',
        'Do not implement the card work yourself once it is dispatched: the role session does it. Your job is scope, splitting, dispatch and reporting.',
        'Acceptance is human-only: never move a card to 已验收, and do not fake reports. Push to 待审查 and let the owner verify.',
      ],
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['snapshot', 'create_task', 'move_task', 'dispatch', 'comment'],
            description: 'snapshot=read board; create_task=add cards; move_task=change one card status; dispatch=start the card role session; comment=append a note to a card.',
          },
          tasks: {
            type: 'array',
            description: 'create_task only: cards to create, in order.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short imperative title.' },
                role: { type: 'string', enum: ['Leader', '设计师', '前端', '后端', '质量测试'] },
                acceptance: { type: 'array', items: { type: 'string' }, description: 'Verifiable acceptance items, one per line; concrete enough for the tester to check.' },
                input: { type: 'string', description: 'What this card needs (files, doc sections, decisions).' },
                output: { type: 'string', description: 'Expected artifacts/paths.' },
                note: { type: 'string', description: 'Extra constraints or context.' },
                wave: { type: 'string', description: 'Optional wave label, e.g. W1.' },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Card ids that must be 已验收 before this one can start.' },
              },
              required: ['title', 'role'],
            },
          },
          taskId: { type: 'string', description: 'move_task / dispatch / comment: target card id (e.g. T-003).' },
          status: { type: 'string', enum: ['待办', '进行中', '待审查', '阻塞', '实现完成'], description: 'move_task: target status.' },
          blockType: { type: 'string', enum: ['待用户确认', '缺环境/工具', '外部依赖', '执行失败'], description: 'move_task: required when moving to 阻塞.' },
          reason: { type: 'string', description: 'move_task to 阻塞: what is blocking.' },
          note: { type: 'string', description: 'comment / move_task: one-line note written to the card.' },
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
