import { useId, useLayoutEffect, useRef, useState, type DragEvent } from 'react'

export function moveSidebarItem(order: string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order
  const next = order.filter((key) => key !== source)
  next.splice(next.indexOf(target) + Number(after), 0, source)
  return next
}

export function readSidebarOrder(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

export function saveSidebarOrder(key: string, paths: string[]) {
  try { localStorage.setItem(key, JSON.stringify(paths)) } catch { /* storage unavailable */ }
}

export function useSidebarReorder(onMove: (source: string, target: string, after: boolean) => void) {
  const id = useId()
  const source = useRef<{ key: string; scope: string; node: Element } | null>(null)
  const before = useRef<Map<string, number> | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [marker, setMarker] = useState<{ key: string; edge: 'before' | 'after' } | null>(null)
  const nodes = () => Array.from(document.querySelectorAll<HTMLElement>(`[data-reorder-list="${id}"]`))
  const end = () => { source.current = null; setMarker(null); setDragging(null) }
  useLayoutEffect(() => {
    const positions = before.current
    if (!positions || dragging) return
    before.current = null
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const node of nodes()) {
      const previous = positions.get(node.dataset.reorderKey!)
      if (previous === undefined) continue
      const offset = previous - node.getBoundingClientRect().top
      if (Math.abs(offset) > 1) node.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.75,.25,1)' })
    }
  })
  const edge = (event: DragEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before'
  }
  return {
    start(event: DragEvent, key: string, scope: string) {
      event.stopPropagation()
      const node = event.currentTarget.closest<HTMLElement>('[data-reorder-key]') || event.currentTarget
      source.current = { key, scope, node }
      event.dataTransfer.setData('application/x-pi-sidebar-order', key)
      event.dataTransfer.effectAllowed = 'move'
      // Capture the native drag preview before dimming the original row.
      requestAnimationFrame(() => { if (source.current?.node === node) setDragging(key) })
    },
    end,
    target(key: string, scope: string) {
      const accepts = () => source.current?.scope === scope && source.current.key !== key
      return {
        'data-reorder-list': id,
        'data-reorder-key': key,
        'data-sorting': dragging === key ? 'true' : undefined,
        'data-drop-edge': marker?.key === key ? marker.edge : undefined,
        onDragOver(event: DragEvent) {
          if (!accepts()) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          const next = edge(event)
          setMarker((old) => old?.key === key && old.edge === next ? old : { key, edge: next })
        },
        onDragLeave(event: DragEvent) {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          setMarker((old) => old?.key === key ? null : old)
        },
        onDrop(event: DragEvent) {
          if (!accepts() || !source.current) return
          event.preventDefault()
          event.stopPropagation()
          before.current = new Map(nodes().map((node) => [node.dataset.reorderKey!, node.getBoundingClientRect().top]))
          onMove(source.current.key, key, edge(event) === 'after')
          end()
        },
      }
    },
  }
}
