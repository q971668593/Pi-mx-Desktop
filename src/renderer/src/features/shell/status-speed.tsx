import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useComposerMetrics } from '@renderer/features/composer/use-composer-metrics'
import { averageTokenSpeed, formatTokenSpeed } from '@renderer/lib/token-speed-stats'
import { useUIStore } from '@renderer/stores/ui-store'

type SpeedSource = 'live' | 'settled' | 'history' | 'none'

/**
 * 状态栏的出字速度。
 * 运行中优先用流式估算；settle 之后用本次 run 的真实值；两者都拿不到时退回最近样本的平均。
 * 标签必须跟着数值来源走：历史平均不能冒充「本次任务平均」，否则 tooltip 和数字互相矛盾。
 */
export function StatusSpeed() {
  const { t } = useTranslation()
  const run = useUIStore((s) => s.runState)
  const { tps } = useComposerMetrics()
  const running = run.status === 'running'
  const settled = useMemo(() => {
    if (running) return null
    if (run.runOutputTokens == null || run.runOutputTokens <= 0) return null
    if (run.lastRunDurationMs == null || run.lastRunDurationMs <= 0) return null
    const value = run.runOutputTokens * 1000 / run.lastRunDurationMs
    return Number.isFinite(value) && value > 0 ? value : null
  }, [running, run.runOutputTokens, run.lastRunDurationMs])
  const history = useMemo(() => averageTokenSpeed(), [run.lastRunDurationMs, run.status])
  const live = running && tps != null && tps > 0 ? tps / 4 : null
  const source: SpeedSource = live != null ? 'live' : settled != null ? 'settled' : history != null ? 'history' : 'none'
  const rate = live ?? settled ?? history?.tps ?? null
  const label = formatTokenSpeed(rate, source === 'live' ? '~' : '')
  const labelKey = source === 'live'
    ? 'common:statusBar.speedLive'
    : source === 'settled'
      ? 'common:statusBar.speedAverage'
      : source === 'history'
        ? 'common:statusBar.speedHistory'
        : 'common:statusBar.speedUnknown'
  const hintKey = source === 'live'
    ? 'common:statusBar.speedLiveHint'
    : source === 'settled'
      ? 'common:statusBar.speedAverageHint'
      : source === 'history'
        ? 'common:statusBar.speedHistoryHint'
        : 'common:statusBar.speedUnknownHint'
  const hint = t(hintKey)
  return <span className="workbench-status-trigger tabular-nums" title={hint} aria-label={`${hint} ${label}`}>
    {t(labelKey)}: {label}
  </span>
}
