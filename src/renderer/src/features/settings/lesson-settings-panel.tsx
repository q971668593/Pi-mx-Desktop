import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  addLessonRule,
  deleteLesson,
  deleteLessonRule,
  loadFeedback,
  setLessonsInjectIntoContext,
  summarizeLessons,
  updateLessonRule,
  type FeedbackSnapshot,
  type LessonRule,
} from '@renderer/lib/feedback-lessons'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection, Toggle } from '@renderer/features/settings/settings-page-shared'
import { btnOutline, inputCls, selectCls } from '@renderer/features/settings/settings-controls'

/**
 * 设置 › 常用 › 教训档案。
 *
 * 三块：生效中的规则（删、手动加）、要不要跟着每轮进上下文（开关）、攒下的教训记录。
 * 直接写 feedback-lessons.json不走草稿保存栏：拨完对下一句话就生效。
 */
export function LessonSettingsPanel() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<FeedbackSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newPolarity, setNewPolarity] = useState<'negative' | 'positive'>('negative')

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await loadFeedback())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const rules = snapshot?.rules ?? []
  const lessons = snapshot?.lessons ?? []

  return (
    <div className="space-y-1">
      <SettingsPageHeader
        title={t('settings:nav.lessons')}
        description={t('settings:lessons.description')}
      />
      <SettingsSection title={t('settings:lessons.rulesTitle')} description={t('settings:lessons.rulesDesc')}>
        <SettingRow
          label={t('settings:lessons.injectLabel')}
          description={t('settings:lessons.injectDesc')}
        >
          <Toggle
            on={snapshot?.injectIntoContext !== false}
            disabled={busy || !snapshot}
            onChange={(next) => void run(async () => {
              await setLessonsInjectIntoContext(next)
            })}
          />
        </SettingRow>
        {rules.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-foreground-secondary">{t('settings:lessons.rulesEmpty')}</div>
        ) : (
          rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} busy={busy} onDelete={() => void run(async () => {
              await deleteLessonRule(rule.id)
            })} onSave={(patch) => run(async () => {
              await updateLessonRule(rule.id, patch)
            })} />
          ))
        )}
        <div className="border-t border-border/50 px-4 py-3">
          <div className="text-[12.5px] font-medium text-foreground">{t('settings:lessons.addRuleTitle')}</div>
          <div className="mt-2 flex flex-col gap-2">
            <input
              className={inputCls}
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder={t('settings:lessons.addRuleTitlePh')}
              maxLength={120}
            />
            <textarea
              className={`${inputCls} min-h-16 resize-y`}
              value={newBody}
              onChange={(event) => setNewBody(event.target.value)}
              placeholder={t('settings:lessons.addRuleBodyPh')}
              maxLength={4000}
            />
            <div className="flex items-center gap-2">
              <select
                className={selectCls}
                value={newPolarity}
                onChange={(event) => setNewPolarity(event.target.value === 'positive' ? 'positive' : 'negative')}
                aria-label={t('settings:lessons.polarity')}
              >
                <option value="negative">{t('settings:lessons.negative')}</option>
                <option value="positive">{t('settings:lessons.positive')}</option>
              </select>
              <button
                type="button"
                className={btnOutline}
                disabled={busy || !newBody.trim()}
                onClick={() => void run(async () => {
                  const res = await addLessonRule({ title: newTitle.trim(), body: newBody.trim(), polarity: newPolarity })
                  if (!res.ok) throw new Error(res.error || 'add_failed')
                  setNewTitle('')
                  setNewBody('')
                })}
              >
                {t('settings:lessons.addRule')}
              </button>
            </div>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        title={t('settings:lessons.lessonsTitle')}
        description={t('settings:lessons.lessonsDesc', { count: lessons.length })}
      >
        {lessons.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-foreground-secondary">{t('settings:lessons.lessonsEmpty')}</div>
        ) : (
          lessons.slice(0, 100).map((lesson) => (
            <div key={lesson.id} className="flex items-start gap-2 px-4 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/50">
              <span
                className={
                  lesson.status === 'kept'
                    ? 'mt-0.5 shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400'
                    : lesson.status === 'dropped'
                      ? 'mt-0.5 shrink-0 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[11px] font-medium text-zinc-500'
                      : 'mt-0.5 shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400'
                }
              >
                {t(`settings:lessons.status_${lesson.status}`)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="break-words text-[12.5px] leading-[1.6] text-foreground">{lesson.text}</div>
                {lesson.verdict?.reason ? (
                  <div className="mt-0.5 break-words text-[12px] leading-[1.5] text-foreground-secondary">{lesson.verdict.reason}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="workbench-button shrink-0 text-destructive"
                disabled={busy}
                onClick={() => void run(async () => {
                  await deleteLesson(lesson.id)
                })}
              >
                {t('common:delete')}
              </button>
            </div>
          ))
        )}
      </SettingsSection>
    </div>
  )
}

function RuleRow({ rule, busy, onDelete, onSave }: {
  rule: LessonRule
  busy: boolean
  onDelete: () => void
  onSave: (patch: { title: string; body: string }) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const negative = rule.polarity !== 'positive'
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(rule.title)
  const [editBody, setEditBody] = useState(rule.body)
  const [optimizing, setOptimizing] = useState(false)

  const startEdit = () => {
    setEditTitle(rule.title)
    setEditBody(rule.body)
    setEditing(true)
  }

  const optimize = async () => {
    const material = editBody.trim() || rule.body
    if (!material.trim() || optimizing) return
    setOptimizing(true)
    try {
      const res = await summarizeLessons({
        material: [material],
        instruction: t('settings:lessons.optimizeInstruction'),
        save: false,
      })
      if (!res.ok || !res.draft) throw new Error(res.error || 'optimize_failed')
      setEditTitle(res.draft.title || editTitle)
      setEditBody(res.draft.body || editBody)
      toast.success(t('settings:lessons.optimizeDone'))
    } catch (error) {
      toast.error(`${t('settings:lessons.optimizeFailed')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOptimizing(false)
    }
  }

  if (editing) {
    return (
      <div className="px-4 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/50">
        <input
          className={inputCls}
          value={editTitle}
          onChange={(event) => setEditTitle(event.target.value)}
          placeholder={t('settings:lessons.addRuleTitlePh')}
          maxLength={120}
        />
        <textarea
          className={`${inputCls} mt-2 min-h-16 resize-y`}
          value={editBody}
          onChange={(event) => setEditBody(event.target.value)}
          maxLength={4000}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className={btnOutline}
            disabled={busy || !editBody.trim()}
            onClick={() => { void (async () => { await onSave({ title: editTitle.trim(), body: editBody.trim() }); setEditing(false) })() }}
          >
            {t('settings:lessons.saveRule')}
          </button>
          <button
            type="button"
            className={btnOutline}
            disabled={busy || optimizing}
            onClick={() => void optimize()}
          >
            {optimizing ? t('settings:lessons.optimizing') : t('settings:lessons.optimizeRule')}
          </button>
          <button
            type="button"
            className="workbench-button shrink-0"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            {t('settings:lessons.cancelEdit')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 px-4 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/50">
      <span
        className={
          negative
            ? 'mt-0.5 shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400'
            : 'mt-0.5 shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400'
        }
      >
        {negative ? t('settings:lessons.negative') : t('settings:lessons.positive')}
      </span>
      <div className="min-w-0 flex-1">
        {rule.title ? <div className="text-[12.5px] font-medium text-foreground">{rule.title}</div> : null}
        <div className="break-words text-[12.5px] leading-[1.6] text-foreground-secondary">{rule.body}</div>
        <div className="mt-0.5 text-[11.5px] text-foreground-tertiary">
          {rule.source === 'manual' ? t('settings:lessons.sourceManual') : t('settings:lessons.sourceModel')}
          {' · '}
          {new Date(rule.createdAt).toLocaleString()}
        </div>
      </div>
      <button
        type="button"
        className="workbench-button shrink-0"
        disabled={busy}
        onClick={startEdit}
      >
        {t('settings:lessons.editRule')}
      </button>
      <button
        type="button"
        className="workbench-button shrink-0 text-destructive"
        disabled={busy}
        onClick={onDelete}
      >
        {t('common:delete')}
      </button>
    </div>
  )
}
