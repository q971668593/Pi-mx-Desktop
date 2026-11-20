import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

type QuestionnaireFooterProps = {
  tab: number
  isLast: boolean
  notice: string | null
  primaryRef?: Ref<HTMLButtonElement>
  /** 已作答题数 / 总题数，给按钮一个「还差几题」的参照。 */
  answeredCount?: number
  total?: number
  /** 时间线行内卡：去掉分隔线和多余留白。 */
  compact?: boolean
  onPrevious: () => void
  onNext: () => void
  onSubmit: () => void
  /** 不传就没有「稍后作答」（行内卡由工具行自己收起）。 */
  onSuspend?: () => void
  onCancel: () => void
}

/** 问答卡底部固定区：左边是「稍后 / 取消」，右边是主行动（下一题 / 提交）。 */
export function QuestionnaireFooter({
  tab,
  isLast,
  notice,
  primaryRef,
  answeredCount,
  total,
  compact,
  onPrevious,
  onNext,
  onSubmit,
  onSuspend,
  onCancel,
}: QuestionnaireFooterProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('shrink-0', compact ? 'pt-2' : 'border-t border-border/60 pt-3')}>
      {notice && (
        <p className="questionnaire-reveal mb-2 text-[12px] leading-4 text-amber-600 dark:text-amber-400" role="status">
          {notice}
        </p>
      )}
      <div className="flex items-center gap-2 whitespace-nowrap">
        {onSuspend && (
          <button
            type="button"
            className="rounded-md px-1.5 py-1 text-[12px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            onClick={onSuspend}
          >
            {t('extension:answerLater')}
          </button>
        )}
        <button
          type="button"
          className="rounded-md px-1.5 py-1 text-[12px] text-foreground-tertiary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          onClick={onCancel}
        >
          {t('extension:cancelNotifyExt')}
        </button>
        <span className="ml-auto flex items-center gap-2">
          {typeof answeredCount === 'number' && typeof total === 'number' && total > 1 && (
            <span className="text-[11px] tabular-nums text-foreground-tertiary">
              {t('extension:qAnsweredCount', { done: answeredCount, total })}
            </span>
          )}
          {tab > 0 && (
            <button
              type="button"
              className="rounded-md border border-border/70 px-2.5 py-1 text-[12.5px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
              onClick={onPrevious}
            >
              {t('extension:qPrevious')}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className="rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
            onClick={isLast ? onSubmit : onNext}
          >
            {isLast ? t('extension:qSubmit') : t('extension:qNext')}
          </button>
        </span>
      </div>
    </div>
  )
}
