/**
 * 模型把工具调用发成正文时的兜底。
 * 正常工具调用走 toolCall 通道；偶发（长上下文/缓存命中后）模型会把
 * `<atem:function_calls>...` 当成普通 text 发出来，页面就会原样显示一堆代码。
 * 这里只做显示层兜底：隐藏原文、留一句人话 + 工具名提示，不改执行链路。
 */

export const LEAKED_TOOL_CALL_MARKERS = ['<atem:function_calls', '<atem:invoke', '<atem:parameter'] as const

export function containsLeakedToolCall(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false
  if (!text.includes('<atem:')) return false
  return LEAKED_TOOL_CALL_MARKERS.some((m) => text.includes(m))
}

export function extractLeakedToolNames(leakedBlock: string): string[] {
  if (!leakedBlock || typeof leakedBlock !== 'string') return []
  const names: string[] = []
  const re = /<atem:invoke[^>]*name="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(leakedBlock)) !== null) {
    if (m[1] && !names.includes(m[1])) names.push(m[1])
  }
  return names
}

function extractToolHint(leakedBlock: string): string {
  const hint = extractLeakedToolNames(leakedBlock).slice(0, 3).join('、')
  return hint ? `（涉及工具：${hint}）` : ''
}

/**
 * 把正文里的泄露块替换成人话。保留泄露块前后的正常说话，只替换泄露段。
 * 纯泄露（整段都是指令）→ 整段换成提示；混合（前面有说话+后面跟指令）→ 说话保留。
 */
export function sanitizeLeakedToolCallText(input: string): { text: string; leaked: boolean } {
  if (!containsLeakedToolCall(input)) return { text: input, leaked: false }
  // 从第一个 <atem: 起到文末都视为泄露段（流式截断时可能没有闭合标签）。
  // 若后面还有正常说话的极小概率场景，也宁可隐藏，不让原始 XML 上屏。
  const firstIdx = input.indexOf('<atem:')
  const head = input.slice(0, firstIdx)
  const leakedBlock = input.slice(firstIdx)
  const hint = extractToolHint(leakedBlock)
  const notice = `⚠️ 模型把工具调用发成了文字（未执行），已自动隐藏原文${hint}，系统将自动重试。`
  const headTrimmed = head.trimEnd()
  if (!headTrimmed) return { text: notice, leaked: true }
  // head 里可能还有残留的半截标签，一并清理
  const cleanHead = headTrimmed.includes('<atem:')
    ? headTrimmed.slice(0, headTrimmed.indexOf('<atem:')).trimEnd()
    : headTrimmed
  if (!cleanHead) return { text: notice, leaked: true }
  return { text: `${cleanHead}\n\n${notice}`, leaked: true }
}
