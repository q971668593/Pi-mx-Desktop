import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'

export type ImageLightboxActions = {
  onCopy?: () => void
  onSaveAs?: () => void
  onAddToChat?: () => void
  onAnnotate?: () => void
}

const MIN_SCALE = 0.2
const MAX_SCALE = 8
const ZOOM_STEP = 1.12

/**
 * Full-window image preview for staged composer images. Lives outside the editor, so it
 * never touches the contenteditable DOM or its native undo stack.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
  actions,
}: {
  src: string | null
  alt?: string
  onClose: () => void
  actions?: ImageLightboxActions
}) {
  const { t } = useTranslation()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const suppressBackdropClickRef = useRef(false)

  const closeMenu = useCallback(() => setMenu(null), [])
  useDismissContextMenu(!!menu, menuRef, closeMenu, false)

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setMenu(null)
    setDragging(false)
    dragRef.current = null
  }, [src])

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase + stopPropagation: keep Escape away from composer/dialog handlers.
      e.stopPropagation()
      if (menu) {
        setMenu(null)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [src, menu, onClose])

  if (!src) return null

  const hasActions = Boolean(actions?.onCopy || actions?.onSaveAs || actions?.onAddToChat || actions?.onAnnotate)
  const isTransformed = Math.abs(scale - 1) > 0.01 || offset.x !== 0 || offset.y !== 0

  const resetView = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (menu) setMenu(null)
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((prev * factor).toFixed(4))))
      const ratio = next / prev
      setOffset((o) => ({ x: o.x * ratio, y: o.y * ratio }))
      return next
    })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!hasActions) return
    e.preventDefault()
    e.stopPropagation()
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 180))
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 180))
    setMenu({ x, y })
  }

  return createPortal(
    <div
      className="overlay-backdrop electron-no-drag fixed inset-0 z-[600] flex items-center justify-center overflow-hidden bg-black/65 p-6 select-none"
      onMouseDown={(e) => {
        if (suppressBackdropClickRef.current) {
          suppressBackdropClickRef.current = false
          return
        }
        if (e.target === e.currentTarget && !menu) onClose()
      }}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? t('composer:previewImage')}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: dragging ? 'none' : 'transform 120ms ease-out',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          if (menu) setMenu(null)
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            originX: offset.x,
            originY: offset.y,
            moved: false,
          }
          setDragging(true)
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return
          const dx = e.clientX - dragRef.current.startX
          const dy = e.clientY - dragRef.current.startY
          if (Math.hypot(dx, dy) > 3) dragRef.current.moved = true
          setOffset({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy })
        }}
        onPointerUp={(e) => {
          if (dragRef.current?.moved) {
            suppressBackdropClickRef.current = true
            window.setTimeout(() => {
              suppressBackdropClickRef.current = false
            }, 0)
          }
          dragRef.current = null
          setDragging(false)
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null
          setDragging(false)
        }}
        onDoubleClick={() => {
          if (isTransformed) resetView()
          else setScale(2)
        }}
      >
        <img
          src={src}
          alt={alt ?? ''}
          className="block max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          draggable={false}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label={t('composer:closePreview')}
        className="fixed right-5 top-5 z-[610] grid h-9 w-9 place-items-center rounded-full border border-border bg-background/95 text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-4 w-4" />
      </button>

      {isTransformed ? (
        <button
          type="button"
          onClick={resetView}
          className="fixed bottom-5 left-1/2 z-[610] -translate-x-1/2 rounded-full border border-border bg-background/90 px-3.5 py-1 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted"
        >
          {Math.round(scale * 100)}% · {t('timeline:image.resetZoom')}
        </button>
      ) : null}

      {menu && hasActions
        ? createPortal(
            <div
              ref={menuRef}
              className={`${contextMenuPanelClass} z-[650]`}
              style={{ left: menu.x, top: menu.y }}
              role="menu"
            >
              {actions?.onCopy ? (
                <button
                  type="button"
                  className={contextMenuItemClass}
                  onClick={() => {
                    setMenu(null)
                    actions.onCopy?.()
                  }}
                >
                  {t('timeline:image.copy')}
                </button>
              ) : null}
              {actions?.onSaveAs ? (
                <button
                  type="button"
                  className={contextMenuItemClass}
                  onClick={() => {
                    setMenu(null)
                    actions.onSaveAs?.()
                  }}
                >
                  {t('timeline:image.saveAs')}
                </button>
              ) : null}
              {actions?.onAddToChat ? (
                <button
                  type="button"
                  className={contextMenuItemClass}
                  onClick={() => {
                    setMenu(null)
                    actions.onAddToChat?.()
                  }}
                >
                  {t('timeline:image.addToChat')}
                </button>
              ) : null}
              {actions?.onAnnotate ? (
                <button
                  type="button"
                  className={contextMenuItemClass}
                  onClick={() => {
                    setMenu(null)
                    actions.onAnnotate?.()
                  }}
                >
                  {t('timeline:image.annotate')}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>,
    document.body,
  )
}
