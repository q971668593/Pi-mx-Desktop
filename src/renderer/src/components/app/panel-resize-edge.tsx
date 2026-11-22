import { type MouseEvent } from 'react'
import { cn } from '@renderer/lib/utils'

/** 列分界拖拽：无悬停高亮，右栏手柄对齐 grid 接缝（主对话区右缘）；双击恢复默认宽度 */
export function PanelResizeEdge({
  side,
  dragging,
  onMouseDown,
  onDoubleClick,
}: {
  side: 'left' | 'right'
  dragging: boolean
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void
  onDoubleClick?: () => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度 · 双击恢复默认"
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown(e)
      }}
      onDoubleClick={onDoubleClick}
      className={cn(
        'panel-resize-edge electron-no-drag z-[60] cursor-col-resize',
        side === 'left' && 'panel-resize-edge--left shrink-0 self-stretch',
        side === 'right' && 'panel-resize-edge--right',
        dragging && 'panel-resize-edge--dragging',
      )}
    />
  )
}