export const NOTIFICATION_HOST_WIDTH = 380
export const NOTIFICATION_CARD_HEIGHT = 168
/** 展开后的卡片上限：正文多长都先完整展示，超过这个高度才截断。 */
export const NOTIFICATION_CARD_MAX_HEIGHT = 340
/** 整个悬浮窗的高度上限（多卡叠加后也不能超出工作区）。 */
export const NOTIFICATION_HOST_MAX_HEIGHT = 720
export const NOTIFICATION_STACK_GAP = 8
export const NOTIFICATION_HOST_PAD = 16
export const NOTIFICATION_MAX_VISIBLE = 3

export function notificationHostSize(cardCount: number, measuredHeight?: number | null): { width: number; height: number } {
  const n = Math.max(0, Math.min(NOTIFICATION_MAX_VISIBLE, cardCount))
  if (n === 0) return { width: NOTIFICATION_HOST_WIDTH, height: 1 }
  const measured = typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) && measuredHeight > 0
    ? Math.round(measuredHeight)
    : null
  if (measured !== null) {
    return { width: NOTIFICATION_HOST_WIDTH, height: Math.min(NOTIFICATION_HOST_MAX_HEIGHT, measured) }
  }
  return {
    width: NOTIFICATION_HOST_WIDTH,
    height: n * NOTIFICATION_CARD_HEIGHT + Math.max(0, n - 1) * NOTIFICATION_STACK_GAP + 8,
  }
}

export function notificationHostBounds(
  workArea: { x: number; y: number; width: number; height: number },
  cardCount: number,
  measuredHeight?: number | null,
): { x: number; y: number; width: number; height: number } {
  const size = notificationHostSize(cardCount, measuredHeight)
  // 窗口永远往上长：底部贴着工作区，不会把卡片顶出屏幕外。
  const height = Math.min(size.height, Math.max(40, workArea.height - NOTIFICATION_HOST_PAD * 2))
  return {
    x: workArea.x + workArea.width - size.width - NOTIFICATION_HOST_PAD,
    y: workArea.y + workArea.height - height - NOTIFICATION_HOST_PAD,
    width: size.width,
    height,
  }
}

export function notificationBoundsLookLegal(
  bounds: { x: number; y: number; width: number; height: number },
  workArea: { x: number; y: number; width: number; height: number },
): boolean {
  if (bounds.width < 100 || bounds.height < 40) return false
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false
  const withinX = bounds.x + bounds.width <= workArea.x + workArea.width + 8
  const withinY = bounds.y + bounds.height <= workArea.y + workArea.height + 8
  return bounds.x >= workArea.x - 8 && bounds.y >= workArea.y - 8 && withinX && withinY
}
