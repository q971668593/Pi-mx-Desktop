import { useEffect, useRef, useState } from 'react'
import { PanelRight } from '@renderer/components/icons'
import { wheelToHorizontal } from '@renderer/lib/horizontal-wheel'
import { cn } from '@renderer/lib/utils'
import type { RightPanelBadge } from './right-panel-badges'

/**
 * Panel tabs in one scrollable row. The mouse wheel scrolls the row sideways (only while the
 * pointer is over it), the active tab is kept in view, and faded edges show there is more.
 */
export function RightPanelTabs({
  panels,
  activePanel,
  setActivePanel,
  badges,
  onCollapse,
  collapseLabel,
}: {
  panels: { key: string; label: string }[]
  activePanel: string
  setActivePanel: (p: string) => void
  badges?: Record<string, RightPanelBadge>
  onCollapse?: () => void
  collapseLabel?: string
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const update = () =>
      setEdges({ start: strip.scrollLeft > 1, end: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1 })
    // Non-passive: the wheel must not also scroll whatever is underneath.
    const onWheel = (e: WheelEvent) => {
      const dx = wheelToHorizontal(e, strip)
      if (dx === null) return
      e.preventDefault()
      strip.scrollLeft += dx
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(strip)
    strip.addEventListener('scroll', update, { passive: true })
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      strip.removeEventListener('scroll', update)
      strip.removeEventListener('wheel', onWheel)
    }
  }, [panels.length])

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(activePanel)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activePanel])

  return (
    <div className="right-panel-tabs-wrap flex h-11 shrink-0 items-center border-b border-border/40 px-2">
      <div
        ref={stripRef}
        className={cn(
          'right-panel-tabs-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto',
          edges.start && 'right-panel-tabs-fade-start',
          edges.end && 'right-panel-tabs-fade-end',
        )}
        role="tablist"
      >
        {panels.map((panel) => {
          const active = activePanel === panel.key
          return (
            <button
              key={panel.key}
              type="button"
              role="tab"
              data-panel-tab={panel.key}
              aria-selected={active}
              data-motion="press"
              tabIndex={active ? 0 : -1}
              onClick={() => setActivePanel(panel.key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                e.preventDefault()
                const i = panels.findIndex((p) => p.key === panel.key)
                const next = panels[(i + (e.key === 'ArrowRight' ? 1 : panels.length - 1)) % panels.length]
                setActivePanel(next.key)
                stripRef.current?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(next.key)}"]`)?.focus()
              }}
              className={cn(
                'motion-press inline-flex h-8 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors',
                active
                  ? 'bg-[var(--bg-active)] text-foreground'
                  : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
              )}
            >
              <span>{panel.label}</span>
              {(() => {
                const badge = badges?.[panel.key]
                if (!badge) return null
                if (typeof badge.count === 'number' && badge.count > 0) {
                  return (
                    <span
                      className={cn(
                        'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none tabular-nums',
                        badge.tone === 'live'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-[var(--bg-hover)] text-foreground-secondary',
                      )}
                    >
                      {badge.count > 99 ? '99+' : badge.count}
                    </span>
                  )
                }
                if (badge.dot) {
                  return (
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        badge.tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500',
                      )}
                      aria-hidden
                    />
                  )
                }
                return null
              })()}
            </button>
          )
        })}
      </div>
      {onCollapse ? (
        <button
          type="button"
          onClick={onCollapse}
          title={collapseLabel}
          aria-label={collapseLabel}
          className="chrome-icon-btn ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary hover:text-foreground"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}
