import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from '@renderer/components/icons'
import { loadFeedback } from '@renderer/lib/feedback-lessons'
import { useVisibleInterval } from '@renderer/hooks/use-visible-interval'
import { FeedbackLessonsDialog } from './feedback-lessons-dialog'

/**
 * 状态栏上的「教训档案」入口：显示已经攒下的条数，点开是全屏面板。
 * 窗口可见时才轮询（30 秒），不打扰主进程。
 */
export function FeedbackInboxButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)

  useVisibleInterval(() => {
    void loadFeedback()
      .then((snapshot) => setCount(snapshot.counts.kept + snapshot.counts.pending))
      .catch(() => {})
  }, 30_000)

  return (
    <>
      <button
        type="button"
        className="workbench-status-trigger"
        title={t('composer:lessonTitle')}
        aria-label={t('composer:lessonTitle')}
        aria-haspopup="dialog"
        data-lesson-count={count}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-3 w-3" />
        <span>{t('composer:lessonTitle')}</span>
        {count > 0 ? <span className="tabular-nums">{count}</span> : null}
      </button>
      {open && (
        <FeedbackLessonsDialog
          onClose={() => {
            setOpen(false)
            void loadFeedback()
              .then((snapshot) => setCount(snapshot.counts.kept + snapshot.counts.pending))
              .catch(() => {})
          }}
        />
      )}
    </>
  )
}
