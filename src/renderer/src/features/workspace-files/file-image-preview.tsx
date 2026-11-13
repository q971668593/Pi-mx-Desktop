import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function FileImagePreview({ src, name }: { src: string; name: string }) {
  const { t } = useTranslation('files')
  const host = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [src])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setScale((current) => Math.min(8, Math.max(0.1, current * (event.deltaY < 0 ? 1.12 : 1 / 1.12))))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  return (
    <div ref={host} className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden bg-[var(--bg-1)]" style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        setOffset({ x: drag.current.left + event.clientX - drag.current.x, y: drag.current.top + event.clientY - drag.current.y })
      }}
      onPointerUp={() => { drag.current = null; setDragging(false) }}
      onPointerCancel={() => { drag.current = null; setDragging(false) }}>
      <img src={src} alt={name} draggable={false} className="pointer-events-none max-h-full max-w-full object-contain" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
      <button type="button" className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}>{Math.round(scale * 100)}% · {t('preview.resetZoom')}</button>
    </div>
  )
}
