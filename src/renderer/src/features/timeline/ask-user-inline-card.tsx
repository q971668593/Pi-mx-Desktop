import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { respondToExtensionUI } from '@renderer/lib/extension-ui-respond'
import { clearExtensionToolRowFlags, reconcileStaleInteractiveToolRows } from '@renderer/lib/extension-ui-tool-sync'
import type { AskQuestionPayload } from '@renderer/features/extension-ui/questionnaire-dialog'

type Draft = { selected: string[]; custom: string }

function draftKey(index: number): string {
  return `q${index}`
}

/**
 * 时间线里的行内问答小卡：模型问「选哪个」时，直接在对话里点选项，不弹全屏对话框。
 * 数据与弹窗版同源（extension-ui-request），回答走同一个 extension.respondUI。
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const init: Record<string, Draft> = {}
    questions.forEach((_, index) => {
      init[draftKey(index)] = { selected: [], custom: '' }
    })
    return init
  })
  const [submitted, setSubmitted] = useState(false)

  const answers = useMemo(
    () =>
      questions.map((question, index) => {
        const draft = drafts[draftKey(index)] || { selected: [], custom: '' }
        const custom = draft.custom.trim()
        const multi = !!question.multiSelect
        const value = draft.selected.join('、')
        return {
          questionIndex: index,
          question: question.question,
          kind: (custom ? 'custom' : multi ? 'multi' : 'option') as 'custom' | 'multi' | 'option',
          answer: custom || (multi ? value : draft.selected[0] || null),
          ...(multi ? { selected: draft.selected } : {}),
        }
      }),
    [drafts, questions],
  )
  const answered = answers.some((answer) => !!answer.answer)
  const everyQuestionAnswered = answers.every((answer) => !!answer.answer)

  const finish = () => {
    setSubmitted(true)
    clearExtensionToolRowFlags(timelineItemId)
    onDone()
  }

  const submit = () => {
    if (!answered) return
    respondToExtensionUI({ id: requestId, result: { cancelled: false, answers } })
    finish()
  }

  const cancel = () => {
    respondToExtensionUI({ id: requestId, cancelled: true })
    finish()
    reconcileStaleInteractiveToolRows(requestId)
  }

  const pick = (index: number, label: string, multi: boolean) => {
    setDrafts((previous) => {
      const key = draftKey(index)
      const draft = previous[key] || { selected: [], custom: '' }
      const selected = multi
        ? draft.selected.includes(label)
          ? draft.selected.filter((item) => item !== label)
          : [...draft.selected, label]
        : [label]
      return { ...previous, [key]: { ...draft, selected } }
    })
  }

  const setCustom = (index: number, custom: string) => {
    setDrafts((previous) => {
      const key = draftKey(index)
      const draft = previous[key] || { selected: [], custom: '' }
      return { ...previous, [key]: { ...draft, custom } }
    })
  }

  if (submitted) {
    return (
      <div className="mt-1 rounded-lg border border-border/45 bg-[var(--bg-2)]/50 px-3 py-2 text-[11.5px] text-foreground-tertiary">
        {t('askUser.answered')}
      </div>
    )
  }

  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-primary/25 bg-primary/[0.04] p-2.5" data-testid="ask-user-inline">
      {questions.map((question, index) => {
        const draft = drafts[draftKey(index)] || { selected: [], custom: '' }
        const multi = !!question.multiSelect
        return (
          <div key={`${index}:${question.question}`} className="space-y-1.5">
            <div className="flex items-start gap-1.5">
              {question.header ? (
                <span className="mt-px shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                  {question.header}
                </span>
              ) : null}
              <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-[1.55] text-foreground">
                {question.question}
                {multi ? <span className="ml-1 text-[11px] font-normal text-foreground-tertiary">{t('askUser.multi')}</span> : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const active = draft.selected.includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pick(index, option.label, multi)}
                    title={option.description || option.label}
                    className={cn(
                      'inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition-colors',
                      active
                        ? 'border-primary/60 bg-primary/12 text-foreground'
                        : 'border-border/60 bg-background/70 text-foreground-secondary hover:border-border hover:text-foreground',
                    )}
                  >
                    {active ? <Check className="h-3 w-3 shrink-0 text-primary" /> : null}
                    <span className="truncate">{option.label}</span>
                  </button>
                )
              })}
            </div>
            {question.options.some((option) => option.description) ? (
              <ul className="space-y-0.5 pl-0.5 text-[10.5px] leading-[1.5] text-foreground-tertiary">
                {question.options
                  .filter((option) => option.description)
                  .map((option) => (
                    <li key={option.label}>
                      <span className="text-foreground-secondary">{option.label}</span> — {option.description}
                    </li>
                  ))}
              </ul>
            ) : null}
            <input
              value={draft.custom}
              onChange={(event) => setCustom(index, event.target.value)}
              placeholder={t('askUser.customPlaceholder')}
              className="w-full rounded-md border border-border/50 bg-background px-2 py-1 text-[11.5px] text-foreground outline-none focus:border-primary/60"
            />
          </div>
        )
      })}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={submit}
          disabled={!answered}
          title={everyQuestionAnswered ? undefined : t('askUser.partialHint')}
          className="rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-medium text-primary-foreground disabled:opacity-40"
        >
          {t('askUser.submit')}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-2 py-1 text-[11.5px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          {t('askUser.cancel')}
        </button>
        <span className="ml-auto text-[10.5px] text-foreground-tertiary">{t('askUser.hint')}</span>
      </div>
    </div>
  )
}
