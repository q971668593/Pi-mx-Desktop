import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListOrdered, Send } from '@renderer/components/icons'
import { usePaneSessionState } from '@renderer/stores/pane-session-context'
import { flushQueuedMessages } from '@renderer/lib/composer-queue-flush'

function truncateLine(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}…`
}

/** Pending steer / follow-up queue shown above input */
export function ComposerPendingQueue({ onRestore }: { onRestore: () => Promise<void> }) {
  const { t } = useTranslation()
  const steering = usePaneSessionState((s) => s.pendingSteering)
  const followUp = usePaneSessionState((s) => s.pendingFollowUp)
  const [flushing, setFlushing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  if (steering.length === 0 && followUp.length === 0) return null

  const total = steering.length + followUp.length

  const flushNow = async () => {
    if (flushing) return
    setFlushing(true)
    try {
      await flushQueuedMessages()
    } finally {
      setFlushing(false)
    }
  }

  return (
    <div
      className="composer-pending-queue mb-1.5 rounded-md border border-border/35 bg-[var(--bg-2)]/40 px-2 py-1.5 text-[12px] leading-snug text-foreground-secondary/70"
      aria-live="polite"
      aria-label={t('composer:queueAria', { count: total })}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-foreground-secondary/60">
        <ListOrdered className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('composer:queueTitle', { count: total })}</span>
        <button
          type="button"
          className="inline-flex shrink-0 items-center rounded border border-border/50 px-1.5 py-[1px] text-[10px] font-medium text-foreground-secondary/80 hover:border-border hover:text-foreground disabled:opacity-50"
          title={t('composer:queueRestoreHint')}
          disabled={flushing || restoring}
          onClick={() => {
            setRestoring(true)
            void onRestore().finally(() => setRestoring(false))
          }}
        >
          {restoring ? t('composer:queueRestoring') : t('composer:queueRestore')}
        </button>
        {/* 默认保持“挂起来，到点自动送”；这个按钮只是把送出的时机提前到用户想要的时候 */}
        <button
          type="button"
          className="composer-queue-flush inline-flex shrink-0 items-center gap-1 rounded border border-border/50 px-1.5 py-[1px] text-[10px] font-medium text-foreground-secondary/80 hover:border-border hover:text-foreground disabled:opacity-50"
          title={t('composer:queueFlushHint')}
          aria-label={t('composer:queueFlush')}
          disabled={flushing || restoring}
          onClick={() => void flushNow()}
        >
          <Send className="h-2.5 w-2.5" aria-hidden />
          {flushing ? t('composer:queueFlushing') : t('composer:queueFlush')}
        </button>
      </div>
      <ul className="space-y-0.5">
        {steering.map((msg, index) => (
          <li key={`steer-${index}`} className="flex gap-1.5 truncate font-mono text-[11px]">
            <span
              className="shrink-0 text-[color:var(--status-live)]/80"
              title={t('composer:steeringHint')}
            >
              {t('composer:steering')}
            </span>
            <span className="min-w-0 truncate text-foreground-secondary/75">{truncateLine(msg)}</span>
          </li>
        ))}
        {followUp.map((msg, index) => (
          <li key={`fu-${index}`} className="flex gap-1.5 truncate font-mono text-[11px]">
            <span
              className="shrink-0 text-foreground-secondary/50"
              title={t('composer:queuedHint')}
            >
              {t('composer:queued')}
            </span>
            <span className="min-w-0 truncate text-foreground-secondary/75">{truncateLine(msg)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 border-t border-border/25 pt-1 text-[10px] text-foreground-secondary/45">
        {t('composer:queueHint')}
      </div>
    </div>
  )
}
