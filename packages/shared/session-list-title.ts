/** 侧栏会话标题：pi JSONL name（/name）> 旧版本地 overlay > 首条消息等 fallback */
export function pickSessionListTitle(
  sdkTitle: string,
  sdkName?: string,
  localOverlay?: string,
): string {
  const fromPi = sdkName?.trim()
  if (fromPi) return fromPi
  const overlay = localOverlay?.trim()
  if (overlay) return overlay
  return sdkTitle
}

/**
 * 侧栏标题跟随最新一条用户消息时的标题文本：取首行、去掉 @路径 引用，按字符截断。
 * 只有「跟随最新消息」打开时才会用到。
 */
export function deriveSessionTitle(text: string, maxChars = 40): string {
  const raw = String(text || '')
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return ''
  const withoutRefs = firstLine
    .replace(/@"[^"]*"/g, ' ')
    .replace(/@\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const title = withoutRefs || firstLine
  return title.length > maxChars ? `${title.slice(0, maxChars).trimEnd()}…` : title
}