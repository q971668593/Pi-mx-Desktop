import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@renderer/components/icons'
import { elapsedTime, useRunActivity, useRunClock } from '@renderer/features/run/use-run-activity'
import { useUIStore } from '@renderer/stores/ui-store'
import { retryReasonLabel } from './composer-retry-banner'

export function ComposerRunStatus({ activity }: { activity: ReturnType<typeof useRunActivity> }) {
  const { t } = useTranslation()
  const runPanelEnabled = useUIStore((s) => s.rightPanelPrefs.run === true)
  const { active, statusKey, startTime, retry, tool } = activity
  const now = useRunClock(active && (startTime != null || retry != null))
  if (!active) return null

  const status = t(statusKey)
  const secondsUntilRetry = retry ? Math.ceil((retry.startedAt + retry.delayMs - now) / 1000) : 0
  const elapsed = startTime == null ? null : elapsedTime(now - startTime)
  const detail = retry
    ? secondsUntilRetry > 0 ? t('run:activity.retryIn', { seconds: secondsUntilRetry }) : status
    : elapsed && t(elapsed.minutes > 0 ? 'run:activity.turnMinutes' : 'run:activity.turnSeconds', elapsed)
  const label = retry ? retryReasonLabel(retry.errorMessage, t) : tool ? t('run:activity.runningTool', { tool }) : status
  const content = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-65" aria-hidden />
      <span className="min-w-0 truncate" aria-live="polite">{label}</span>
      {detail && <span className="shrink-0 tabular-nums opacity-75">· {detail}</span>}
    </>
  )
  const className = 'inline-flex min-h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-foreground-secondary'
  if (!runPanelEnabled) return <span className={className} title={label}>{content}</span>

  return (
    <button
      type="button"
      className={`${className} hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45`}
      title={t('common:commandPalette.openPanel', { panel: t('common:panel.run') })}
      onClick={() => {
        const store = useUIStore.getState()
        store.setActivePanel('run')
        store.revealRightPanel()
      }}
    >
      {content}
      <ChevronRight className="h-3 w-3 shrink-0 opacity-65" aria-hidden />
    </button>
  )
}
