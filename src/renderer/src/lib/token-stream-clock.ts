/**
 * 写字时钟：只累计“正文真的在往外冒”的时间，工具调用、等待、卡住都不算。
 *
 * 用法：流式输出时每一拍调 `noteStreamProgress(streamingId, textLen)`；
 * run 结算时调 `takeStreamActiveMs()` 拿走本轮累计并清零。
 * 单次停顿超过 STALL_CAP_MS 的部分不计，避免一次长等待污染一次真实手速。
 */
const STALL_CAP_MS = 1500

let anchorId: string | null = null
let anchorLen = 0
let anchorAt = 0
let activeMs = 0

export function noteStreamProgress(streamingId: string | null, textLen: number): void {
  const now = Date.now()
  if (streamingId == null || streamingId !== anchorId) {
    anchorId = streamingId
    anchorLen = textLen
    anchorAt = now
    return
  }
  if (textLen > anchorLen) {
    activeMs += Math.min(Math.max(0, now - anchorAt), STALL_CAP_MS)
  }
  anchorLen = textLen
  anchorAt = now
}

/** 取走本轮累计的写字毫秒并清零；结算时调用，一轮只拿一次。 */
export function takeStreamActiveMs(): number {
  const value = activeMs
  activeMs = 0
  anchorId = null
  anchorLen = 0
  anchorAt = 0
  return value
}

/** 仅供测试：把时钟回到初始状态。 */
export function resetStreamClockForTest(): void {
  takeStreamActiveMs()
}
