import { useTranslation } from 'react-i18next'
import { formatTokens } from '@renderer/lib/format-tokens'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
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
  const openContextPanel = () => {
    const st = useUIStore.getState()
    st.setActivePanel('context')
    st.revealRightPanel()
  }

  return (
    <div className="composer-metrics-inline flex shrink-0 items-center gap-1.5 text-[10.5px] tabular-nums leading-none text-foreground-secondary/60">
      {tpsLabel && isRunning ? <span title={t('composer:tpsHint')}>{tpsLabel}</span> : null}
      {showCtx && (
        <button
          type="button"
          onClick={openContextPanel}
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
      )}
    </div>
  )
}
