import { useCallback, useEffect, useState } from 'react'
import { wheelToHorizontal } from '@renderer/lib/horizontal-wheel'

type PanOptions = {
  enabled?: boolean
}

/**
 * 泳道横向浏览：鼠标滚轮左右滑 + 按住背景左右拖。
 * 滚轮折算复用 `wheelToHorizontal`（和右侧面板标签栏同一套手感）；
 * 卡片本身是可拖拽元素（dragstart 换泳道），所以点到可交互元素时不接管指针。
 */
export function useLanePan<T extends HTMLElement>(options: PanOptions = {}): {
  /** 回调 ref：列是异步渲染的，用 state 记住元素，元素一挂上就重新绑事件、重算可滚性。 */
  ref: (node: T | null) => void
  dragging: boolean
  canScroll: boolean
  scrollByStep: (direction: -1 | 1) => void
} {
  const { enabled = true } = options
  const [el, setEl] = useState<T | null>(null)
  const [dragging, setDragging] = useState(false)
  const [canScroll, setCanScroll] = useState(false)
  const ref = useCallback((node: T | null) => setEl(node), [])

  const updateCanScroll = useCallback(() => {
    if (!el) return
    const next = el.scrollWidth - el.clientWidth > 1
    setCanScroll((current) => (current === next ? current : next))
  }, [el])

  const scrollByStep = useCallback((direction: -1 | 1) => {
    if (!el) return
    // 一次滑动一列（列宽由 CSS 决定，找不到就退回 168px）。
    const laneWidth = el.querySelector<HTMLElement>('[data-lane]')?.offsetWidth || 168
    el.scrollBy({ left: direction * (laneWidth + 8), behavior: 'smooth' })
  }, [el])

  useEffect(() => {
    if (!el || !enabled) return

    updateCanScroll()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateCanScroll) : null
    observer?.observe(el)
    // 列是异步渲染的：容器本身的宽度不变，只有内容宽度变，ResizeObserver 不会触发。
    const mutation = typeof MutationObserver === 'function'
      ? new MutationObserver(() => requestAnimationFrame(updateCanScroll))
      : null
    mutation?.observe(el, { childList: true, subtree: true })

    const onWheel = (event: WheelEvent) => {
      const delta = wheelToHorizontal(event, el)
      if (delta == null) return
      event.preventDefault()
      el.scrollLeft += delta
    }

    let pointerId: number | null = null
    let startX = 0
    let startScroll = 0
    let moved = false

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerId != null) return
      if (el.scrollWidth - el.clientWidth <= 1) return
      const target = event.target as HTMLElement | null
      // 卡片/按钮/输入框自己要处理点击与拖拽，别抢。
      if (target?.closest('button, a, input, textarea, select, [draggable="true"], [contenteditable="true"], [data-pan="skip"]')) {
        return
      }
      pointerId = event.pointerId
      startX = event.clientX
      startScroll = el.scrollLeft
      moved = false
      el.setPointerCapture?.(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId == null || event.pointerId !== pointerId) return
      const dx = event.clientX - startX
      if (!moved && Math.abs(dx) < 4) return
      if (!moved) {
        moved = true
        setDragging(true)
        el.style.userSelect = 'none'
      }
      event.preventDefault()
      el.scrollLeft = startScroll - dx
    }

    const endPan = (event: PointerEvent) => {
      if (pointerId == null || event.pointerId !== pointerId) return
      pointerId = null
      el.releasePointerCapture?.(event.pointerId)
      el.style.userSelect = ''
      setDragging(false)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endPan)
    el.addEventListener('pointercancel', endPan)
    el.addEventListener('scroll', updateCanScroll, { passive: true })
    window.addEventListener('resize', updateCanScroll)
    return () => {
      observer?.disconnect()
      mutation?.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endPan)
      el.removeEventListener('pointercancel', endPan)
      el.removeEventListener('scroll', updateCanScroll)
      window.removeEventListener('resize', updateCanScroll)
      el.style.userSelect = ''
    }
  }, [el, enabled, updateCanScroll])

  return { ref, dragging, canScroll, scrollByStep }
}
