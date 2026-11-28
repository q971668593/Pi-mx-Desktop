import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { findSuspendedForSession, pendingMatchesCurrentSession, useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { usePaneSessionIdentity } from '@renderer/stores/pane-session-context'
import { QuestionnairePanel } from './questionnaire-panel'
import { answerQuestionnaire, cancelQuestionnaire } from './extension-ui-actions'

/**
 * 「确认问题」坞：停在输入框正上方的一条可折叠卡，不再整屏弹窗 ——
 * 提问时照样能翻右侧文件、切换会话，答完自动收掉；收起后只剩一行标题。
 */
export function QuestionnaireDock() {
  const pending = useExtensionUIStore((s) => s.activePending)
  const suspendedList = useExtensionUIStore((s) => s.suspendedList)
  const suspendedFallback = useExtensionUIStore((s) => s.suspended)
  const resumeSuspended = useExtensionUIStore((s) => s.resumeSuspended)
  const { sessionFile } = usePaneSessionIdentity()
  const suspended = findSuspendedForSession(suspendedList, suspendedFallback, sessionFile)
  if (pending && pending.method === 'ask_user_question' && pendingMatchesCurrentSession(pending, sessionFile)) {
    // key = 请求 id：下一个提问不会继承上一次的收起状态。
    return <DockCard key={pending.id} id={pending.id} questions={pending.questions} sessionFile={sessionFile} />
  }
  if (
    suspended &&
    suspended.pending.method === 'ask_user_question' &&
    pendingMatchesCurrentSession(suspended.pending, sessionFile)
  ) {
    if (suspended.background === true) {
      return (
        <DockCard
          key={suspended.pending.id}
          id={suspended.pending.id}
          questions={suspended.pending.questions}
          sessionFile={sessionFile}
        />
      )
    }
    if (!pending) {
      return (
        <SuspendedDockBar
          summary={suspended.pending.questions[0]?.question ?? ''}
          count={suspended.pending.questions.length}
          onResume={resumeSuspended}
        />
      )
    }
  }
  return null
}

function SuspendedDockBar({
  summary,
  count,
  onResume,
}: {
  summary: string
  count: number
  onResume: () => void
}) {
  const { t } = useTranslation()
  return (
    <section
      className="questionnaire-dock mb-2 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.05] px-3 py-2 shadow-sm"
      data-testid="questionnaire-dock-suspended"
      aria-label={t('extension:qDockTitle')}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <span className="shrink-0 text-[12px] font-medium text-primary">{t('extension:qDockTitle')}</span>
      {count > 1 && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10.5px] tabular-nums text-primary">
          {t('extension:qDockCount', { count })}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground-secondary">{summary}</span>
      <button
        type="button"
        onClick={onResume}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('timeline:continueAnswering')}
      </button>
    </section>
  )
}

function DockCard({
  id,
  questions,
  sessionFile,
}: {
  id: string
  questions: Parameters<typeof QuestionnairePanel>[0]['questions']
  sessionFile: string | null
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const pendingCount = questions.length
  const summary = questions[0]?.question ?? ''

  return (
    <section
      className="questionnaire-dock mb-2 overflow-hidden rounded-xl border border-primary/30 bg-background shadow-sm"
      data-testid="questionnaire-dock"
      aria-label={t('extension:qDockTitle')}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 transition-colors',
          collapsed ? 'bg-primary/[0.05]' : 'bg-primary/[0.07]',
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="shrink-0 text-[12px] font-medium text-primary">{t('extension:qDockTitle')}</span>
          {pendingCount > 1 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10.5px] tabular-nums text-primary">
              {t('extension:qDockCount', { count: pendingCount })}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground-secondary">{summary}</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 text-foreground-tertiary transition-transform', collapsed && '-rotate-90')}
            aria-hidden
          />
        </button>
      </div>

      {!collapsed && (
        <div className="border-t border-border/60 px-4 pb-3 pt-3">
          <QuestionnairePanel
            requestId={id}
            questions={questions}
            variant="dock"
            onSubmit={(answers) => answerQuestionnaire(id, answers, sessionFile)}
            onCancel={() => cancelQuestionnaire(id, sessionFile)}
          />
        </div>
      )}
    </section>
  )
}
