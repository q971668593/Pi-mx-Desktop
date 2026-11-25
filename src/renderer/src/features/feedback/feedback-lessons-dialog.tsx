import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2, Plus, Sparkles, Trash2, X } from '@renderer/components/icons'
import {
  deleteLesson,
  deleteLessonRule,
  EMPTY_FEEDBACK,
  loadFeedback,
  reportLesson,
  setLessonStatus,
  summarizeLessons,
  type FeedbackSnapshot,
  type Lesson,
  type LessonRule,
} from '@renderer/lib/feedback-lessons'
import { cn } from '@renderer/lib/utils'
import './feedback-lessons.css'

/**
 * 教训档案（负面提示词）的全屏面板。
 *
 * 左边是我平时踩过的雷点（自动抓的 + 手动补的），右边是归纳出来的规则。
 * 底部输入框可以直接写要求，让模型把素材和自己补的话一起总结成一条规则。
 */
export function FeedbackLessonsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<FeedbackSnapshot>(EMPTY_FEEDBACK)
  const [loading, setLoading] = useState(true)
  const [instruction, setInstruction] = useState('')
  const [manualText, setManualText] = useState('')
  const [busy, setBusy] = useState<'summary' | 'manual' | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [polarity, setPolarity] = useState<'auto' | 'negative' | 'positive'>('auto')

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await loadFeedback())
    } catch {
      /* 读不到就是空档案 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const kept = useMemo(() => snapshot.lessons.filter((row) => row.status === 'kept'), [snapshot.lessons])
  const others = useMemo(
    () => snapshot.lessons.filter((row) => row.status !== 'kept'),
    [snapshot.lessons],
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runSummary = async () => {
    setBusy('summary')
    try {
      const res = await summarizeLessons({
        instruction: instruction.trim() || undefined,
        lessonIds: selected.size ? [...selected] : undefined,
        polarity: polarity === 'auto' ? undefined : polarity,
      })
      if (!res.ok) {
        toast.error(t('composer:lessonSummaryFailed'))
        return
      }
      toast.success(t('composer:lessonRuleSaved'))
      setInstruction('')
      setSelected(new Set())
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const addManual = async () => {
    const text = manualText.trim()
    if (!text) return
    setBusy('manual')
    try {
      const res = await reportLesson({ text, source: 'manual' })
      if (!res.ok) {
        toast.error(t('composer:lessonSaveFailed'))
        return
      }
      setManualText('')
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <div className="feedback-backdrop" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="feedback-shell">
        <header className="feedback-header">
          <span className="feedback-tile"><Sparkles size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="feedback-title">
              {t('composer:lessonTitle')}
              <span className="feedback-count">{kept.length}</span>
            </h2>
            <p>{t('composer:lessonHint')}</p>
          </div>
          <button type="button" className="feedback-close" aria-label={t('common:sidebar.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="feedback-body">
          <section className="feedback-column" aria-label={t('composer:lessonKeptTitle')}>
            <div className="feedback-column-head">
              <strong>{t('composer:lessonKeptTitle')}</strong>
              <span>{t('composer:lessonSelected', { count: selected.size })}</span>
            </div>
            <div className="feedback-list">
              {loading && <div className="feedback-empty"><Loader2 className="h-4 w-4 animate-spin" /></div>}
              {!loading && kept.length === 0 && (
                <div className="feedback-empty">
                  <Sparkles size={20} />
                  <strong>{t('composer:lessonEmpty')}</strong>
                  <p>{t('composer:lessonEmptyHint')}</p>
                </div>
              )}
              {kept.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  checked={selected.has(lesson.id)}
                  onToggle={() => toggle(lesson.id)}
                  onDelete={async () => { await deleteLesson(lesson.id); await refresh() }}
                  onDrop={async () => { await setLessonStatus(lesson.id, 'dropped'); await refresh() }}
                />
              ))}
              {others.length > 0 && (
                <>
                  <div className="feedback-split">{t('composer:lessonOthersTitle')}</div>
                  {others.map((lesson) => (
                    <LessonCard
                      key={lesson.id}
                      lesson={lesson}
                      checked={false}
                      onDelete={async () => { await deleteLesson(lesson.id); await refresh() }}
                      onKeep={async () => { await setLessonStatus(lesson.id, 'kept'); await refresh() }}
                    />
                  ))}
                </>
              )}
            </div>
          </section>

          <section className="feedback-column" aria-label={t('composer:lessonRulesTitle')}>
            <div className="feedback-column-head">
              <strong>{t('composer:lessonRulesTitle')}</strong>
              <span>{snapshot.rules.length}</span>
            </div>
            <div className="feedback-list">
              {snapshot.rules.length === 0 && (
                <div className="feedback-empty">
                  <Sparkles size={20} />
                  <strong>{t('composer:lessonNoRules')}</strong>
                  <p>{t('composer:lessonNoRulesHint')}</p>
                </div>
              )}
              {snapshot.rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onDelete={async () => { await deleteLessonRule(rule.id); await refresh() }}
                  onCopy={() => {
                    void navigator.clipboard.writeText(`${rule.title}\n${rule.body}`)
                    toast.success(t('composer:lessonRuleCopied'))
                  }}
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="feedback-footer">
          <div className="feedback-manual">
            <input
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void addManual() }}
              placeholder={t('composer:lessonManualPlaceholder')}
              aria-label={t('composer:lessonManualPlaceholder')}
            />
            <button type="button" className="feedback-button" disabled={busy !== null || !manualText.trim()} onClick={() => void addManual()}>
              <Plus size={14} />
              {t('composer:lessonManualAdd')}
            </button>
          </div>
          <div className="feedback-summary">
            <input
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t('composer:lessonInstructionPlaceholder')}
              aria-label={t('composer:lessonInstructionPlaceholder')}
              onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void runSummary() }}
            />
            <div className="feedback-polarity" role="group" aria-label={t('composer:lessonPolarityLabel')}>
              {(['auto', 'negative', 'positive'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={polarity === value}
                  className={cn('feedback-polarity-option', polarity === value && 'is-active')}
                  onClick={() => setPolarity(value)}
                >
                  {value === 'auto'
                    ? t('composer:lessonPolarityAuto')
                    : value === 'positive'
                      ? t('composer:lessonPolarityPositive')
                      : t('composer:lessonPolarityNegative')}
                </button>
              ))}
            </div>
            <button type="button" className="feedback-button feedback-button-primary" disabled={busy !== null} onClick={() => void runSummary()}>
              {busy === 'summary' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles size={14} />}
              {t('composer:lessonSummarize')}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function LessonCard({ lesson, checked, onToggle, onDelete, onDrop, onKeep }: {
  lesson: Lesson
  checked: boolean
  onToggle?: () => void
  onDelete: () => Promise<void> | void
  onDrop?: () => Promise<void> | void
  onKeep?: () => Promise<void> | void
}) {
  const { t } = useTranslation()
  const verdict = lesson.verdict
  const when = new Date(lesson.createdAt).toLocaleString()
  return (
    <article className={cn('feedback-card', checked && 'is-checked')}>
      <div className="feedback-card-top">
        {onToggle && (
          <button
            type="button"
            className={cn('feedback-check', checked && 'is-on')}
            aria-pressed={checked}
            aria-label={t('composer:lessonSelect')}
            onClick={onToggle}
          >
            {checked && <Check size={11} />}
          </button>
        )}
        <p className="feedback-text">{lesson.text}</p>
      </div>
      <div className="feedback-meta">
        <span className={cn('feedback-badge', lesson.status === 'kept' ? 'is-kept' : lesson.status === 'pending' ? 'is-pending' : 'is-dropped')}>
          {lesson.status === 'kept'
            ? t('composer:lessonStatusKept')
            : lesson.status === 'pending'
              ? t('composer:lessonStatusPending')
              : t('composer:lessonStatusDropped')}
        </span>
        {lesson.verdict?.category && <span>{lesson.verdict.category}</span>}
        {lesson.source === 'manual' && <span>{t('composer:lessonManualTag')}</span>}
        <span className="ml-auto">{when}</span>
        {onKeep && <button type="button" onClick={() => void onKeep()}>{t('composer:lessonKeep')}</button>}
        {onDrop && <button type="button" onClick={() => void onDrop()}>{t('composer:lessonDrop')}</button>}
        <button type="button" onClick={() => void onDelete()} aria-label={t('composer:lessonDelete')}>
          <Trash2 size={12} />
        </button>
      </div>
      {verdict?.reason && <p className="feedback-reason">{verdict.reason}</p>}
      {verdict?.error && <p className="feedback-reason is-error">{t('composer:lessonJudgeFailed')}：{verdict.error}</p>}
    </article>
  )
}

function RuleCard({ rule, onDelete, onCopy }: {
  rule: LessonRule
  onDelete: () => Promise<void> | void
  onCopy: () => void
}) {
  const { t } = useTranslation()
  return (
    <article className="feedback-card">
      <div className="feedback-card-top">
        <strong className="feedback-rule-title">{rule.title}</strong>
        <span className={cn('feedback-badge', rule.polarity === 'positive' ? 'is-kept' : 'is-negative')}>
          {rule.polarity === 'positive' ? t('composer:lessonPolarityPositive') : t('composer:lessonPolarityNegative')}
        </span>
      </div>
      <p className="feedback-rule-body">{rule.body}</p>
      <div className="feedback-meta">
        <span>{new Date(rule.createdAt).toLocaleDateString()}</span>
        <span className="ml-auto" />
        <button type="button" onClick={onCopy}>{t('composer:lessonRuleCopy')}</button>
        <button type="button" onClick={() => void onDelete()} aria-label={t('composer:lessonDelete')}>
          <Trash2 size={12} />
        </button>
      </div>
    </article>
  )
}
