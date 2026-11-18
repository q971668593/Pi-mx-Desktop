import { sessionPreviewText } from './session-preview-text'

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

/** Extract a title for an unnamed session or the follow-latest setting. */
export function deriveSessionTitle(text: string, maxChars = 40): string {
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .map(sessionPreviewText)
    .find(Boolean)
  if (!firstLine) return ''
  const withoutRefs = firstLine
    .replace(/@"[^"]*"/g, ' ')
    .replace(/@\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const summary = withoutRefs || firstLine
  const title = summary
    .replace(/^(?:(?:好的|好吧|行|嗯|可以)[，,。！!、]\s*)+/, '')
    .replace(/^(?:现在[，,]?\s*)?(?:请你|请|麻烦你?|你帮我|你给我|帮我|给我)\s*/, '')
    .trim() || summary
  return title.length > maxChars ? `${title.slice(0, maxChars).trimEnd()}…` : title
}
