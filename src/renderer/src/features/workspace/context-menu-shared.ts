import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

const contextMenuItemBase =
  'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border'

export const contextMenuItemClass = `${contextMenuItemBase} text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/90`

export const contextMenuDangerItemClass = `${contextMenuItemBase} text-destructive hover:bg-destructive/10 active:bg-destructive/15`

export const contextMenuPanelClass =
  'electron-no-drag fixed z-[500] min-w-[160px] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg'

/**
 * Where a context menu should sit so it is never cut off: keep it inside the window, and flip it
 * above the pointer when there is not enough room below (conversations near the bottom).
 * Pure so it can be unit-tested without a DOM.
 */
export function placeContextMenu(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(anchor.x, viewport.width - size.width - margin))
  const fitsBelow = anchor.y + size.height + margin <= viewport.height
  // 靠下就向上弹：菜单底边贴住鼠标，而不是被窗口底边切掉一半。
  const top = Math.max(margin, fitsBelow ? anchor.y : anchor.y - size.height)
  return { left, top }
}

/**
 * Measures the rendered menu and returns its final position; while the measurement is pending the
 * caller keeps the menu hidden (visibility) so nothing flashes at the wrong place.
 */
export function useContextMenuPlacement(
  open: boolean,
  anchor: { x: number; y: number } | null,
  panelRef: RefObject<HTMLElement | null>,
  margin = 8,
): { left: number; top: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const x = anchor?.x ?? 0
  const y = anchor?.y ?? 0
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewport = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    }
    setPos(placeContextMenu({ x, y }, { width: rect.width, height: rect.height }, viewport, margin))
  }, [open, x, y, margin, panelRef])
  return pos
}

export function useDismissContextMenu(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  dismissOnScroll = true,
) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const dismissIfOutside = (target: EventTarget | null) => {
      const el = ref.current
      if (!el) return
      if (target instanceof Node && el.contains(target)) return
      onCloseRef.current()
    }

    const onPointerDown = (e: PointerEvent) => dismissIfOutside(e.target)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    const onScroll = (e: Event) => {
      const el = ref.current
      if (!el) return
      const t = e.target
      if (t instanceof Node && el.contains(t)) return
      onCloseRef.current()
    }
    const onContextMenu = (e: MouseEvent) => dismissIfOutside(e.target)
    const onResize = () => onCloseRef.current()

    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('contextmenu', onContextMenu, true)
    }, 0)

    document.addEventListener('keydown', onKey)
    if (dismissOnScroll) window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)

    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, ref, dismissOnScroll])
}
