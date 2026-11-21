import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertCircle, ChevronDown, Copy } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'

/**
 * 一轮失败时的收口：先说「为什么」（分类），再给原始错误（可折叠、可复制）。
 * 以前只有一行红字，用户不知道是网络、额度还是工具挂了。
 */
export function FailedLine({ error, className }: { error?: string | null; className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const raw = (error ?? '').trim()

  const reason = (() => {
    if (!raw) return t('timeline:failed.reasonUnknown')
    if (/timed? ?out/i.test(raw)) return t('timeline:failed.reasonTimeout')
    if (/connection error|ECONNRESET|socket hang up|ENOTFOUND|EAI_AGAIN/i.test(raw)) return t('timeline:failed.reasonConnection')
    if (/rate.?limit|quota|429/i.test(raw)) return t('timeline:failed.reasonQuota')
    if (/unauthorized|401|invalid api key|authentication/i.test(raw)) return t('timeline:failed.reasonAuth')
    if (/context|token|too long/i.test(raw)) return t('timeline:failed.reasonContext')
    const status = /^(\d{3})\b/.exec(raw)?.[1]
    if (status) return t('timeline:failed.reasonStatus', { status })
    return t('timeline:failed.reasonOther')
  })()

  return (
    <div className={cn('timeline-status-line timeline-status-line--warn text-[12px]', className)}>
      <div className="flex items-start gap-1.5">
        <AlertCircle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-amber-700 dark:text-amber-300">{reason}</span>
            {raw ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
              >
                {t(open ? 'timeline:failed.hideDetail' : 'timeline:failed.showDetail')}
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
              </button>
            ) : null}
            {raw ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(raw).then(
                    () => toast.success(t('timeline:failed.copied')),
                    () => toast.error(t('timeline:failed.copyFailed')),
                  )
                }}
                aria-label={t('timeline:failed.copy')}
                title={t('timeline:failed.copy')}
                className="rounded p-0.5 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
              >
                <Copy className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </div>
          {open && raw ? (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-relaxed text-foreground/85">
              {raw}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  )
}
