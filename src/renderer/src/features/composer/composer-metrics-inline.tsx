import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTokens } from '@renderer/lib/format-tokens'
import { cn } from '@renderer/lib/utils'
import type { useComposerMetrics } from './use-composer-metrics'

type Metrics = ReturnType<typeof useComposerMetrics>

const R = 6.5
const C = 2 * Math.PI * R

/** Context usage as a small ring (exact numbers in the tooltip) plus live tokens/s while running. */
export function ComposerMetricsInline({ metrics, isRunning }: { metrics: Metrics; isRunning?: boolean }) {
  const { t } = useTranslation()
  const showCtx = metrics.contextWindow != null || metrics.estContextTokens != null
  const pct = Math.max(0, Math.min(100, metrics.ctxPct ?? 0))
  const tpsLabel = metrics.tps != null && metrics.tps > 0 ? `${Math.round(metrics.tps)} tps` : null
  // 钩子必须在提前返回之前：上下文指标时有时无，写在后面会触发 React #310 直接白屏。
  const [showPop, setShowPop] = useState(false)

  if (!showCtx && !tpsLabel) return null

  const contextTitle = t('composer:contextRing', {
    used: metrics.estContextTokens == null ? '?' : formatTokens(metrics.estContextTokens),
    total: metrics.contextWindow != null ? formatTokens(metrics.contextWindow) : '?',
    pct: metrics.ctxPct == null ? '?' : pct.toFixed(1),
  })
  const cacheTitle =
    metrics.cacheHitPct != null
      ? `${t('composer:cacheStats', {
          pct: metrics.cacheHitPct.toFixed(0),
          read: formatTokens(metrics.cacheRead ?? 0),
        })}${metrics.cacheWrite > 0 ? t('composer:cacheWrite', { write: formatTokens(metrics.cacheWrite) }) : ''}`
      : null
  const baseTitle = cacheTitle ? `${contextTitle} · ${cacheTitle}` : contextTitle
  const title = `${baseTitle} · ${t('composer:contextRingClickHint')}`

  return (
    <div className="composer-metrics-inline flex shrink-0 items-center gap-1.5 text-[10.5px] tabular-nums leading-none text-foreground-secondary/60">
      {tpsLabel && isRunning ? <span title={t('composer:tpsHint')}>{tpsLabel}</span> : null}
      {showCtx && (
        <span
          className="relative flex"
          onMouseEnter={() => setShowPop(true)}
          onMouseLeave={() => setShowPop(false)}
        >
          <button
            type="button"
            onClick={() => setShowPop((value) => !value)}
            aria-expanded={showPop}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45"
            title={title}
            aria-label={title}
          >
            <span role="img" title={title} aria-label={title} className="flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 16 16" className={cn('composer-context-ring', pct >= 80 && 'is-high')} aria-hidden>
                <circle cx="8" cy="8" r={R} className="track" />
                <circle
                  cx="8"
                  cy="8"
                  r={R}
                  className="value"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - Math.max(pct, 2) / 100)}
                  transform="rotate(-90 8 8)"
                />
              </svg>
            </span>
          </button>
          {showPop ? (
            <span
              role="status"
              className="absolute bottom-8 right-0 z-30 w-max max-w-[280px] rounded-lg border border-border/60 bg-popover px-2.5 py-1.5 text-[11px] leading-relaxed text-popover-foreground shadow-lg"
            >
              {baseTitle}
            </span>
          ) : null}
        </span>
      )}
    </div>
  )
}
