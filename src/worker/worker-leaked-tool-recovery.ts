import type { ExtensionAPI, InlineExtension } from '@earendil-works/pi-coding-agent'
import { containsLeakedToolCall, extractLeakedToolNames } from '@shared/leaked-tool-call'

export const LEAKED_TOOL_CALL_RECOVERY_CUSTOM_TYPE = 'pi-desktop-leaked-tool-call-recovery'
export const MAX_LEAKED_TOOL_CALL_RETRIES = 2

type AssistantLikeMessage = {
  role?: string
  stopReason?: string
  content?: unknown
}

/**
 * 读取助手消息中的原始文本块（不经过 `extractTextFromPiMessage` 的脱敏替换），
 * 以便准确识别 `<atem:function_calls>` / `<atem:invoke>` 泄露文本。
 */
function extractRawAssistantText(message: AssistantLikeMessage | null | undefined): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type?: string; text?: string } =>
        block != null && typeof block === 'object' && (block as { type?: string }).type === 'text',
    )
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
}

function hasStructuredToolCall(message: AssistantLikeMessage | null | undefined): boolean {
  const content = message?.content
  if (!Array.isArray(content)) return false
  return content.some(
    (block) => block != null && typeof block === 'object' && (block as { type?: string }).type === 'toolCall',
  )
}

/** 生成自动纠偏提示，驱动模型在同一轮内改用结构化 tool call 重新执行。 */
export function buildLeakedToolCallRecoveryPrompt(toolNames: readonly string[]): string {
  const hint = toolNames.length > 0 ? `（涉及工具：${toolNames.slice(0, 3).join('、')}）` : ''
  return (
    `你上一条回复把工具调用输出成了纯文本 XML${hint}，系统未执行任何工具。` +
    '请立即通过结构化工具调用接口（tool call）直接执行所需工具并继续完成当前任务，不要在正文里输出 <atem:...> 或原始调用标签。'
  )
}

/**
 * 兜底恢复扩展：当模型偶发把工具调用发成纯文本且本轮未产生真实 toolCall 时，
 * 在 `turn_end` 自动注入一条隐藏 followUp 消息让模型在同一 run 内继续重试，无需打断用户重发。
 */
export const leakedToolCallRecoveryExtension: InlineExtension = {
  name: 'pi-desktop-leaked-tool-call-recovery',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    let consecutiveRetries = 0

    pi.on('agent_start', () => {
      consecutiveRetries = 0
    })

    pi.on('turn_end', async (event, ctx) => {
      const msg = (event as { message?: AssistantLikeMessage }).message
      if (msg?.role !== 'assistant') return

      if (msg.stopReason === 'aborted' || msg.stopReason === 'error') {
        consecutiveRetries = 0
        return
      }

      if (hasStructuredToolCall(msg)) {
        consecutiveRetries = 0
        return
      }

      const rawText = extractRawAssistantText(msg)
      if (!containsLeakedToolCall(rawText)) {
        consecutiveRetries = 0
        return
      }

      const hasPending = (ctx as { hasPendingMessages?: () => boolean } | undefined)?.hasPendingMessages
      if (typeof hasPending === 'function' && hasPending()) {
        return
      }

      if (consecutiveRetries >= MAX_LEAKED_TOOL_CALL_RETRIES) {
        return
      }

      consecutiveRetries += 1
      const toolNames = extractLeakedToolNames(rawText)

      await pi.sendMessage(
        {
          customType: LEAKED_TOOL_CALL_RECOVERY_CUSTOM_TYPE,
          content: buildLeakedToolCallRecoveryPrompt(toolNames),
          display: false,
        },
        { triggerTurn: true, deliverAs: 'followUp' },
      )
    })
  },
}
