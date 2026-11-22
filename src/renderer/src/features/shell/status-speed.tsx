import { useTranslation } from 'react-i18next'
import { useComposerMetrics } from '@renderer/features/composer/use-composer-metrics'
import { useUIStore } from '@renderer/stores/ui-store'

/** Live output is estimated from streamed characters; the settled rate uses provider usage. */
export function StatusSpeed() {
  const { t } = useTranslation()
  const run = useUIStore((s) => s.runState)
  const { tps } = useComposerMetrics()
  const running = run.status === 'running'
  const rate = running
    ? (tps != null && tps > 0 ? tps / 4 : null)
    : (run.runOutputTokens != null && run.runOutputTokens > 0 && run.lastRunDurationMs != null && run.lastRunDurationMs > 0
      ? run.runOutputTokens * 1000 / run.lastRunDurationMs : null)
  const hint = t(running ? 'common:statusBar.speedLiveHint' : 'common:statusBar.speedAverageHint')
  return <span className="workbench-status-trigger tabular-nums" title={hint} aria-label={hint}>
    {t(running ? 'common:statusBar.speedLive' : 'common:statusBar.speedAverage')}: {rate == null ? '—' : `${running ? '~' : ''}${rate.toFixed(1)} tok/s`}
  </span>
}
