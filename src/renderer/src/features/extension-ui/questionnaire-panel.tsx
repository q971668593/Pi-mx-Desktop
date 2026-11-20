import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { QuestionnaireOptions } from './questionnaire-options'
import { QuestionnaireFooter } from './questionnaire-footer'
import {
  buildAnswers,
  clearDrafts,
  isAnswered,
  loadDrafts,
  saveDrafts,
  unansweredIndexes,
  type AskQuestionPayload,
  type QuestionDraft,
  type QuestionnaireAnswer,
} from './questionnaire-model'
import './extension-ui.css'

/** 单选点完停一拍再翻页：让人看清自己点了哪一项（多选不翻）。 */
const AUTO_ADVANCE_MS = 220

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === 'text')
}

/**
 * `ask_user_question` 的统一排版：一次只问一题，选项是整行卡片（标题 + 说明各占一行），
 * 上方步骤条看进度，下方固定提交区。坞（输入框上方）和时间线工具行共用它，只改留白。
 */
export function QuestionnairePanel({
  requestId,
  questions,
  variant,
  onSubmit,
  onSuspend,
  onCancel,
  className,
}: {
  requestId: string
  questions: AskQuestionPayload[]
  variant: 'dock' | 'inline'
  onSubmit: (answers: QuestionnaireAnswer[]) => void
  onSuspend?: () => void
  onCancel: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => loadDrafts(requestId, questions.length))
  // 继续作答时从第一道没答的题开始。
  const [tab, setTab] = useState(() => Math.max(0, unansweredIndexes(questions, drafts)[0] ?? 0))
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [notice, setNotice] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const advanceTimer = useRef<number | undefined>(undefined)

  useEffect(() => saveDrafts(requestId, drafts), [requestId, drafts])
  useEffect(() => () => window.clearTimeout(advanceTimer.current), [])
  // 切题会卸载刚才聚焦的选项，把焦点拉回面板，键盘操作不断线。
  useEffect(() => {
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
  }, [tab])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onSuspend) onSuspend()
    }
    if (!onSuspend) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSuspend])

  const q = questions[tab]
  if (!q) return null
  const draft = drafts[tab]
  const isLast = tab >= questions.length - 1
  const multi = !!q.multiSelect
  const many = questions.length > 1
  const answeredCount = drafts.filter((value) => isAnswered(value)).length

  const goTo = (index: number) => {
    window.clearTimeout(advanceTimer.current)
    if (index === tab || index < 0 || index >= questions.length) return
    setDirection(index > tab ? 'forward' : 'back')
    setTab(index)
    setNotice(null)
  }

  const updateDraft = (next: QuestionDraft) => {
    setDrafts((current) => current.map((value, index) => (index === tab ? next : value)))
    setNotice(null)
  }

  const submit = () => {
    window.clearTimeout(advanceTimer.current)
    const open = unansweredIndexes(questions, drafts)
    if (open.length) {
      if (open[0] !== tab) goTo(open[0])
      setNotice(t('extension:qUnanswered', { count: open.length }))
      return
    }
    clearDrafts(requestId)
    onSubmit(buildAnswers(questions, drafts))
  }

  const next = () => (isLast ? submit() : goTo(tab + 1))

  const choose = (label: string) => {
    updateDraft({ ...chooseChecked(draft, label, multi) })
    if (multi) return
    window.clearTimeout(advanceTimer.current)
    if (isLast) {
      primaryRef.current?.focus({ preventScroll: true })
      return
    }
    advanceTimer.current = window.setTimeout(() => goTo(tab + 1), AUTO_ADVANCE_MS)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || isTextField(event.target)) return
    if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey) {
      const option = q.options[Number(event.key) - 1]
      if (option) {
        event.preventDefault()
        choose(option.label)
      }
      return
    }
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      next()
    }
  }

  const dense = variant === 'inline'
  // 带代码/图片预览的选项（老问卷能力）：选中后在下方面板里压一块，不再挤在两列布局里。
  const previewSource = q.options.find((option) => option.label === draft.selected[0]) ?? q.options.find((option) => option.preview)
  const previewText = previewSource?.preview || undefined

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-testid="questionnaire-panel"
      data-variant={variant}
      onKeyDown={onKeyDown}
      className={cn('flex min-h-0 flex-col outline-none', dense ? 'gap-2' : 'gap-3', className)}
    >
      <div className={cn('shrink-0', dense ? 'space-y-1.5' : 'space-y-2.5')}>
        {many && (
          <nav className="flex flex-wrap items-center gap-1.5" aria-label={t('extension:qSteps')}>
            {questions.map((question, index) => {
              const answered = isAnswered(drafts[index])
              return (
                <button
                  key={index}
                  type="button"
                  aria-current={index === tab ? 'step' : undefined}
                  title={question.question}
                  // 焦点留在面板上，点完步骤条数字键照样可用。
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => goTo(index)}
                  className={cn(
                    'flex max-w-[9rem] items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                    index === tab
                      ? 'border-primary/50 bg-primary/10 font-medium text-foreground'
                      : answered
                        ? 'border-border/60 text-foreground/80 hover:bg-[var(--bg-hover)]'
                        : 'border-dashed border-border/70 text-foreground-tertiary hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {answered && <Check className="h-3 w-3 shrink-0 text-primary" />}
                  <span className="truncate">{question.header || `${index + 1}`}</span>
                </button>
              )
            })}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-foreground-tertiary">
              {t('extension:qProgress', { current: tab + 1, total: questions.length })}
            </span>
          </nav>
        )}
        <div className="flex items-start gap-2">
          {q.header && (
            <span className="mt-[3px] shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-primary">
              {q.header}
            </span>
          )}
          <h3 className="min-w-0 flex-1 text-[15px] font-medium leading-[1.5] text-foreground">{q.question}</h3>
        </div>
        {multi && <p className="pl-0.5 text-[12px] leading-4 text-foreground-tertiary">{t('extension:qMultiHint')}</p>}
      </div>

      <div
        key={tab}
        data-direction={direction}
        className={cn(
          'questionnaire-step min-h-0 flex-1 overflow-y-auto pr-0.5',
          dense ? 'max-h-[min(46vh,360px)]' : 'max-h-[min(42vh,400px)]',
        )}
      >
        <QuestionnaireOptions
          question={q}
          draft={draft}
          onChoose={choose}
          onChooseCustom={() => updateDraft({ ...draft, useCustom: true, selected: [] })}
          onCustomChange={(text) => updateDraft({ ...draft, custom: text, useCustom: true })}
          onPreview={() => {}}
          onCommit={next}
        />
        {previewText && (
          <div className="questionnaire-reveal mt-2 rounded-lg border border-border/60 bg-[var(--bg-2)]/40 p-3">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-foreground-tertiary">
              {t('extension:qPreview')}
            </div>
            <pre className="max-h-[32vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-foreground/90">
              {previewText}
            </pre>
          </div>
        )}
      </div>

      <QuestionnaireFooter
        compact={dense}
        tab={tab}
        isLast={isLast}
        notice={notice}
        primaryRef={primaryRef}
        answeredCount={answeredCount}
        total={questions.length}
        onPrevious={() => goTo(tab - 1)}
        onNext={() => goTo(tab + 1)}
        onSubmit={submit}
        onSuspend={onSuspend}
        onCancel={() => {
          clearDrafts(requestId)
          onCancel()
        }}
      />
    </div>
  )
}

/** 单选换成这一项；多选切这一项；两者都会退出「自己写」模式。 */
function chooseChecked(draft: QuestionDraft, label: string, multi: boolean): QuestionDraft {
  if (!multi) return { ...draft, selected: [label], useCustom: false }
  const selected = draft.selected.includes(label)
    ? draft.selected.filter((value) => value !== label)
    : [...draft.selected, label]
  return { ...draft, selected, useCustom: false }
}
