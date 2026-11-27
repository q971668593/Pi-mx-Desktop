import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { sendToMain } from './worker-transport.js'
import type { WorkerIncomingMessage } from './worker-port-types.js'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const pending = new Map<string, { resolve: (value: ToolResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
let sequence = 0
let enabled = false
let toolApi: ExtensionAPI | undefined

export function setTeamToolsEnabled(next: boolean): void {
  enabled = next
  if (!toolApi) return
  try {
    const active = toolApi.getActiveTools()
    if (active.includes('team_board') === enabled) return
    toolApi.setActiveTools(enabled ? [...active, 'team_board'] : active.filter((name) => name !== 'team_board'))
  } catch {
    // session_start reapplies the switch once the extension API is bound.
  }
}

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
    toolApi = api
    api.on('session_start', () => setTeamToolsEnabled(enabled))
    api.registerTool({
      defaultActive: false,
      name: 'team_board',
      label: 'Work team board',
      description:
        'Read and write the project work-team board (.文档/开发规范/看板/当前批次.md). Use action=snapshot to read the board; action=create_task to add cards (with ownedPaths); action=dispatch to run a card in a background session (Builder gets an isolated Git worktree); action=dispatch_review to launch an isolated Verifier session for a 待审查 card; action=review_verdict (Verifier) to pass (moves to 已通过) or reject (wakes original Builder in-place, trips circuit breaker at 3 rounds); action=move_task to update status; action=merge_task to merge an 已通过 card branch and clean its worktree; action=comment to append a note; action=append_memory to record a reusable lesson or taste preference into 错题本.md / 品味账本.md. Never mark a card 已验收.',
      promptSnippet: 'Route S/M/L tasks, dispatch parallel Builders, run isolated Verifier review loops (3-round circuit breaker), and merge passed branches.',
      promptGuidelines: [
        'Apply Gate 0 complexity routing first: for S-tier small fixes/copy/config/single-file edits, implement and verify directly in the main workspace without creating cards or dispatching.',
        'For M/L-tier multi-module work, read the board first (action=snapshot), create cards with role + ownedPaths + verifiable acceptance (action=create_task), then dispatch parallel cards (action=dispatch). Gate 1/2 require PRD 已确认 and 02-方案契约.md 已冻结.',
        'When a card reaches 待审查, use action=dispatch_review to start an isolated Verifier; Verifier must submit action=review_verdict (pass or reject with issues). After 已通过, call action=merge_task.',
        'Acceptance is human-only: never move a card to 已验收, and do not fake reports.',
      ],
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['snapshot', 'create_task', 'move_task', 'dispatch', 'dispatch_review', 'review_verdict', 'merge_task', 'comment', 'append_memory'],
            description: 'snapshot=read board; create_task=add cards; move_task=change status; dispatch=start role session; dispatch_review=launch isolated Verifier; review_verdict=submit pass/reject verdict; merge_task=merge passed branch; comment=append note; append_memory=record lesson/taste.',
          },
          tasks: {
            type: 'array',
            description: 'create_task only: cards to create, in order.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short imperative title.' },
                role: { type: 'string', enum: ['Leader', 'Builder', 'Verifier', 'Designer'] },
                acceptance: { type: 'array', items: { type: 'string' }, description: 'Verifiable acceptance items, one per line; concrete enough for the verifier to check.' },
                input: { type: 'string', description: 'What this card needs (files, doc sections, decisions).' },
                output: { type: 'string', description: 'Expected artifacts/paths.' },
                note: { type: 'string', description: 'Extra constraints or context.' },
                wave: { type: 'string', description: 'Optional wave label, e.g. W1.' },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Card ids that must be 已通过 or 已验收 before this one can start.' },
                ownedPaths: { type: 'array', items: { type: 'string' }, description: 'Allowed directories/files for this card to avoid parallel merge conflicts.' },
              },
              required: ['title', 'role'],
            },
          },
          taskId: { type: 'string', description: 'move_task / dispatch / dispatch_review / review_verdict / merge_task / comment: target card id (e.g. T-003).' },
          status: { type: 'string', enum: ['待办', '进行中', '待审查', '已通过', '阻塞'], description: 'move_task: target status.' },
          blockType: { type: 'string', enum: ['待用户确认', '合并冲突', '缺环境/工具', '外部依赖', '执行失败'], description: 'move_task: required when moving to 阻塞.' },
          reason: { type: 'string', description: 'move_task to 阻塞: what is blocking.' },
          note: { type: 'string', description: 'comment / move_task / append_memory: text written to the card or memory ledger.' },
          memoryKind: { type: 'string', enum: ['lesson', 'taste'], description: 'append_memory: lesson writes to 错题本.md; taste writes to 品味账本.md.' },
          verdict: { type: 'string', enum: ['pass', 'reject'], description: 'review_verdict: pass moves card to 已通过; reject returns to Builder or trips 3-round circuit breaker.' },
          summary: { type: 'string', description: 'review_verdict: concise conclusion.' },
          issues: { type: 'array', items: { type: 'string' }, description: 'review_verdict (when reject): concrete defects to fix.' },
        },
        required: ['action'],
        additionalProperties: false,
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, args, signal) {
        if (!enabled) throw new Error('Work team is switched off for this conversation')
        const result = await callMain(args, signal)
        if (result.isError) throw new Error(result.content.map((item) => item.text).join('\n'))
        return { content: result.content, details: {} }
      },
    })
  },
}
