import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { MainColRightPanelToggle } from '@renderer/components/app/main-col-right-panel-toggle'
import { MainColumnWithTimelineScroll } from '@renderer/components/app/main-column-with-timeline-scroll'
import { ComposerDock } from '@renderer/components/app/composer-dock'
import { GoalBar } from '@renderer/features/goal/goal-bar'
import { SubAgentStrip } from '@renderer/features/team-board/sub-agent-strip'
import { DelegateAgentStrip } from '@renderer/features/team-board/delegate-agent-strip'
import { InterruptedRunBanner } from '@renderer/features/run/interrupted-run-banner'
import { TimelineScrubber } from '@renderer/features/timeline/timeline-scrubber'
import { Timeline } from '@renderer/features/timeline/timeline'
import { Composer } from '@renderer/features/composer/composer'
import { QuestionnaireDock } from '@renderer/features/extension-ui/questionnaire-dock'
import { HelpBar } from '@renderer/features/browser/help-bar'
import type { Pane, PaneSession } from '@renderer/features/split/split-layout'
import { useUIStore } from '@renderer/stores/ui-store'
import { PaneSessionProvider, type PaneSessionBinding } from '@renderer/stores/pane-session-context'
import { getSessionState } from '@renderer/stores/use-view-session'
import { getSessionView, hydrateSessionView, sessionKeyFromFile } from '@renderer/lib/session-shell'
import { isSessionDiskAuthoritative } from '@renderer/lib/session-disk-authority'
import { hydrateInactiveSessionDisplayMeta } from '@renderer/lib/session-display-meta'

const ProjectHomeView = lazy(() =>
  import('@renderer/components/app/project-home-view').then((m) => ({ default: m.ProjectHomeView })),
)

function useHydrateInactivePane(session: PaneSession | null, active: boolean): boolean {
  const sessionFile = session?.sessionFile ?? null
  const sessionId = session?.sessionId ?? null
  const [hydrating, setHydrating] = useState(false)

  useEffect(() => {
    if (active || !sessionFile) {
      setHydrating(false)
      return
    }
    let cancelled = false
    const key = sessionKeyFromFile(sessionFile)
    const entry = getSessionState(sessionFile)
    const hasRows = (entry?.timelineItems.length ?? 0) > 0
    const needsHydrate = !hasRows || isSessionDiskAuthoritative(key)
    if (needsHydrate) {
      if (!hasRows) setHydrating(true)
      void hydrateSessionView(sessionFile, sessionId, undefined, { bindWorker: false }).finally(() => {
        if (!cancelled) setHydrating(false)
      })
    } else {
      setHydrating(false)
      if (!entry?.runState.model || !entry?.runState.thinkingLevel) {
        void hydrateInactiveSessionDisplayMeta(
          sessionFile,
          getSessionView(sessionFile)?.sessionMeta,
          sessionId,
        )
      }
    }
    return () => {
      cancelled = true
    }
  }, [active, sessionFile, sessionId])

  return hydrating
}

export function SessionPaneView({
  pane,
  active,
  projectName,
  recentProjects,
  currentWorkspace,
  ephemeralSandboxDraft,
  onSelectProject,
  onOpenProject,
}: {
  pane: Pane | null
  active: boolean
  projectName?: string
  recentProjects: string[]
  currentWorkspace: string | null
  ephemeralSandboxDraft: boolean
  onSelectProject: (path: string) => void
  onOpenProject: () => void
}) {
  const { t } = useTranslation()
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const timelineItemCount = useUIStore((s) => s.timelineItems.length)
  const historyLoading = useUIStore((s) => s.historyLoading)

  const session = pane?.session ?? null
  const hydrating = useHydrateInactivePane(session, active)

  if (!active && !session) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center">
        <EmptyState title={t('common:split.emptyPane')} />
      </div>
    )
  }

  const isHomeMode =
    !currentSessionId && timelineItemCount === 0 && !ephemeralSandboxDraft && !historyLoading
  const showHome = active ? isHomeMode || ephemeralSandboxDraft : false

  const binding: PaneSessionBinding = useMemo(
    () => ({
      isActive: active,
      paneId: pane?.id ?? 'main',
      sessionFile: session?.sessionFile ?? null,
      sessionId: session?.sessionId ?? null,
      workspace: session?.workspace ?? null,
    }),
    [active, pane?.id, session?.sessionFile, session?.sessionId, session?.workspace],
  )

  return (
    <PaneSessionProvider value={binding}>
      <MainColumnWithTimelineScroll className="h-full">
        {!showHome ? <InterruptedRunBanner /> : null}
        {showHome ? (
          <Suspense fallback={<EmptyState compact title={t('common:loading')} className="min-h-[12rem]" />}>
            <ProjectHomeView
              projectName={ephemeralSandboxDraft ? t('common:home.newChat') : projectName}
              recentProjects={recentProjects}
              currentWorkspace={currentWorkspace}
              ephemeralSandboxDraft={ephemeralSandboxDraft}
              onSelectProject={onSelectProject}
              onOpenProject={onOpenProject}
            />
          </Suspense>
        ) : (
          <Timeline inactiveHydrating={!active && hydrating} />
        )}
        <MainColRightPanelToggle />
        {/* acp_delegate 子 Agent：右上角悬浮，只在有在跑时出现。 */}
        {!showHome ? <DelegateAgentStrip /> : null}
        <ComposerDock heroMode={showHome}>
          {/* 派出去的子 Agent：有在跑的才显示点开跳到它的会话看细节。 */}
          {!showHome ? <SubAgentStrip /> : null}
          {/* 会话目标：贴着输入框的一条窄条，进行中可终止、可再次启动、可删除。 */}
          {!showHome && active ? <GoalBar /> : null}
          {/* 确认问题不再整屏弹窗：贴在输入框上方，可折叠，答完自动收起。 */}
          <QuestionnaireDock />
          {/* The agent waiting on the user in their Chrome: answerable right above the composer. */}
          {active ? <HelpBar activeTabId={null} where="chrome" className="mb-2 rounded-lg border" /> : null}
          <Composer />
        </ComposerDock>
        {!showHome && active ? <TimelineScrubber /> : null}
      </MainColumnWithTimelineScroll>
    </PaneSessionProvider>
  )
}
