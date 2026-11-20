import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QuestionnairePanel } from '@renderer/features/extension-ui/questionnaire-panel'
import {
  answerQuestionnaire,
  cancelQuestionnaire,
} from '@renderer/features/extension-ui/extension-ui-actions'
import { clearExtensionToolRowFlags } from '@renderer/lib/extension-ui-tool-sync'
import type { AskQuestionPayload } from '@renderer/features/extension-ui/questionnaire-model'

/**
 * 时间线里的行内问答卡：模型问「选哪个」时直接在对话里答，不弹窗。
 * 排版与输入框上方的坞同源（QuestionnairePanel），这里只负责把答案写回工具行。
 */
export function AskUserInlineCard({
  requestId,
  questions,
  timelineItemId,
  onDone,
}: {
  requestId: string
  questions: AskQuestionPayload[]
  timelineItemId?: string
  onDone: () => void
}) {
  const { t } = useTranslation('timeline')
  const [submitted, setSubmitted] = useState(false)

  if (submitted) {
    return (
      <div className="mt-2 rounded-xl border border-border/45 bg-[var(--bg-2)]/50 px-3.5 py-2.5 text-[11.5px] text-foreground-tertiary">
        {t('askUser.answered')}
      </div>
    )
  }

  return (
    <div
      className="mt-2 rounded-xl border border-primary/25 bg-primary/[0.035] px-4 py-3"
      data-testid="ask-user-inline"
    >
      <QuestionnairePanel
        requestId={requestId}
        questions={questions}
        variant="inline"
        onSubmit={(answers) => {
          setSubmitted(true)
          answerQuestionnaire(requestId, answers)
          clearExtensionToolRowFlags(timelineItemId)
          onDone()
        }}
        onCancel={() => {
          setSubmitted(true)
          cancelQuestionnaire(requestId)
          onDone()
        }}
      />
    </div>
  )
}
