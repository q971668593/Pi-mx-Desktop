import { requestOpenInPane, startSessionDrag } from '@renderer/features/split/split-dnd'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, GitFork, Plus } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import { buildSessionTree, filterSessionTree, type SessionNode, type SessionChildGroup } from './project-session-tree'
import { openSubagentSessionPreview } from '@renderer/lib/subagent-session-navigation'
import { selectActiveSubagentSessionChildren } from '@renderer/lib/subagent-session-activity'
import type { SubagentSessionChild } from '@renderer/lib/subagent-session-types'
import { useToolCardCatalogReady } from '@renderer/features/timeline/tool-card-registry'
import { SessionAttentionDot } from './session-attention-dot'
import { selectSessionAttention } from '@renderer/lib/session-attention'
import type { SandboxEntry, SessionItem } from './project-sidebar-types'
import type { SessionMenuFork, SessionMenuTarget } from './session-context-menu-types'

import type { useSidebarReorder } from './sidebar-reorder'

const NO_CHILDREN: SubagentSessionChild[] = []

/**
 * Sidebar order inside a project is always "newest user message first". Manual drag ordering is a
 * *project* feature only — a conversation the user just replied to must jump to the top even when
 * projects are pinned in a hand-picked order.
 */
function sessionActivityAt(session: SessionItem): number {
  return session.lastUserMessageAt ?? session.updatedAt
}

/**
 * Sidebar rows show only "how long ago" (5 天 / 3 小时 / 12 分钟); the exact timestamp
 * lives in the row's tooltip so a long date string never eats the title width.
 */
function relativeSessionTime(
  sentAt: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const minutes = Math.max(0, Math.round((Date.now() - sentAt) / 60_000))
  if (minutes < 1) return t('common:sidebar.timeNow')
  if (minutes < 60) return t('common:sidebar.timeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('common:sidebar.timeHours', { count: hours })
  return t('common:sidebar.timeDays', { count: Math.floor(hours / 24) })
}

export function ProjectSessionTree({
  workspacePath,
  projectSessions,
  searchQuery = '',
  loading,
  error,
  onRetry,
  currentWorkspace,
  currentSessionId,
  onSessionContextMenu,
}: {
  workspacePath: string
  projectSessions: SessionItem[]
  searchQuery?: string
  loading: boolean
  error?: string
  onRetry?: () => void
  currentWorkspace: string | null
  currentSessionId: string | null
  onSessionContextMenu: (e: React.MouseEvent, payload: SessionMenuTarget) => void
}) {
  const { t } = useTranslation()
  const sessionAttention = useUIStore((st) => st.sessionAttention)
  const historySessionFile = useUIStore((st) => st.historySessionFile)
  const subagentSessionGroup = useUIStore((st) => st.subagentSessionGroup)
  const catalogReady = useToolCardCatalogReady()
  const [expandedSessionFiles, setExpandedSessionFiles] = useState<Set<string>>(() => new Set())
  const isCurrentProject = workspacePathsEqual(currentWorkspace, workspacePath)
  // Only the viewed project has live subagents; the memoized selector keeps the same array
  // across streaming tokens so this tree does not re-render on every delta.
  const liveChildren = useUIStore((st) =>
    isCurrentProject ? selectActiveSubagentSessionChildren(st.timelineItems, catalogReady ? 1 : 0) : NO_CHILDREN,
  )
  // "+" on this project (or its home view): show the new conversation where it will live.
  const pendingNew = useUIStore(
    (st) =>
      isCurrentProject &&
      !st.ephemeralSandboxDraft &&
      (st.pendingNewSessionPlaceholder ||
        (!st.currentSessionId && !st.historySessionFile && !st.historyLoading && st.timelineItems.length === 0)),
  )

  const tree = useMemo(() => {
    const groups: SessionChildGroup[] = []
    if (workspacePathsEqual(currentWorkspace, workspacePath) && historySessionFile) {
      groups.push({ parentSessionFile: historySessionFile, children: liveChildren })
    }
    if (subagentSessionGroup && workspacePathsEqual(subagentSessionGroup.workspacePath, workspacePath)
      && workspacePathKey(subagentSessionGroup.parentSessionFile) !== workspacePathKey(historySessionFile)) {
      groups.push(subagentSessionGroup)
    }
    return buildSessionTree(projectSessions, groups)
  }, [currentWorkspace, historySessionFile, liveChildren, projectSessions, subagentSessionGroup, workspacePath])
  const sortNodes = (nodes: SessionNode[]) => [...nodes].sort((a, b) => sessionActivityAt(b.session) - sessionActivityAt(a.session) || a.key.localeCompare(b.key))
  const visibleRoots = useMemo(() => filterSessionTree(tree.roots, searchQuery), [tree, searchQuery])
  const { sessionsByFile, forksBySource } = useMemo(() => {
    const byFile = new Map<string, SessionItem>()
    const forks = new Map<string, SessionMenuFork[]>()
    for (const session of projectSessions) {
      const key = workspacePathKey(session.sessionFile)
      if (key) byFile.set(key, session)
      const sourceKey = workspacePathKey(session.forkedFromSessionFile)
      if (!sourceKey || !session.sessionFile) continue
      const list = forks.get(sourceKey) ?? []
      list.push({ sessionId: session.sessionId, sessionFile: session.sessionFile, title: session.title || session.sessionId.slice(0, 8) })
      forks.set(sourceKey, list)
    }
    return { sessionsByFile: byFile, forksBySource: forks }
  }, [projectSessions])
  const revealedSelection = useRef('')
  const selectedKey = workspacePathsEqual(currentWorkspace, workspacePath) ? workspacePathKey(historySessionFile) : ''

  useEffect(() => {
    if (revealedSelection.current === selectedKey) return
    revealedSelection.current = ''
    if (!selectedKey) return
    const selected = tree.byKey.get(selectedKey)
    let parentKey = selected?.parentKey
    if (!selected) {
      parentKey = [...tree.byKey.values()].find((node) => node.liveChildren.some(
        (child) => workspacePathKey(child.sessionFile) === selectedKey,
      ))?.key
      if (!parentKey) return
    }
    revealedSelection.current = selectedKey
    const ancestors: string[] = []
    while (parentKey) {
      ancestors.push(parentKey)
      parentKey = tree.byKey.get(parentKey)?.parentKey
    }
    if (ancestors.length) setExpandedSessionFiles((previous) => new Set([...previous, ...ancestors]))
  }, [selectedKey, tree])

  useEffect(() => {
    setExpandedSessionFiles((previous) => {
      const next = new Set([...previous].filter((key) => {
        const node = tree.byKey.get(key)
        return node && (node.children.length > 0 || node.liveChildren.length > 0)
      }))
      return next.size === previous.size ? previous : next
    })
  }, [tree])

  const openParentSession = (session: SessionItem) => {
    guardSessionSwitch(() => {
      if (workspacePathsEqual(workspacePath, currentWorkspace)) {
        void switchSessionInPlace(session.sessionId, session.sessionFile)
      } else {
        void activateWorkspace(workspacePath, {
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
        })
      }
    })
  }

  const renderSession = (node: SessionNode, depth = 0): ReactNode => {
    const s = node.session
    // Child sessions (subagents) render one step down: compact single line, quieter text.
    const isChild = depth > 0
    const sessionFile = s.sessionFile
    const { children, liveChildren: transientChildren } = node
    const childCount = children.length + transientChildren.length
    const childrenId = `session-children-${encodeURIComponent(node.key)}`
    const expanded = !!searchQuery.trim() || expandedSessionFiles.has(node.key)
    const ownAttention = selectSessionAttention(sessionFile, sessionAttention)
    const attention = node.liveChild?.state === 'running' && ownAttention === 'idle' ? 'working' : ownAttention
    const forkSource = s.forkedFromSessionFile ? sessionsByFile.get(workspacePathKey(s.forkedFromSessionFile)) : undefined
    const forkSourceTitle = s.forkedFromSessionFile
      ? forkSource?.title || forkSource?.sessionId.slice(0, 8) || t('common:sidebar.forkSourceMissing')
      : ''
    const parentActive = currentSessionId === s.sessionId
      && workspacePathsEqual(workspacePath, currentWorkspace)
      && workspacePathKey(historySessionFile) === node.key
    return (
      <div
        key={node.key}
        className="sidebar-session-entry"
        data-session-file={sessionFile}
        draggable={!!sessionFile && !node.liveChild}
        onDragStart={(e) => {
          if (!sessionFile) return
          e.stopPropagation()
          startSessionDrag(e, { sessionId: s.sessionId, sessionFile, workspace: workspacePath, title: s.title || s.firstMessage || '' })
        }}
      >
        <div
          onContextMenu={(event) =>
            onSessionContextMenu(event, {
              sessionId: s.sessionId,
              sessionFile,
              title: s.title || s.sessionId.slice(0, 8),
              workspacePath,
              forks: forksBySource.get(node.key),
            })
          }
          className={cn(
            'nav-row sidebar-session-row sidebar-drop-target flex items-center gap-0.5',
            isChild ? 'sidebar-child-row min-h-[30px] rounded-md px-0.5' : 'sidebar-session-root rounded-md',
            parentActive
              ? 'nav-row-active'
              : 'text-foreground-secondary hover:text-foreground',
          )}
        >
          <button
            type="button"
            onClick={(e) => {
              if (node.liveChild && sessionFile) guardSessionSwitch(() => { void openSubagentSessionPreview(sessionFile) })
              // Ctrl/⌘+click opens beside the current conversation in a new pane.
              else if ((e.ctrlKey || e.metaKey) && sessionFile) requestOpenInPane({ sessionId: s.sessionId, sessionFile, workspace: workspacePath, title: s.title || s.firstMessage || '' })
              else openParentSession(s)
            }}
            aria-current={parentActive ? 'page' : undefined}
            className={cn(
              'sidebar-session-hit flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45',
              isChild ? 'min-h-[30px] py-1' : 'min-h-9 py-1.5',
            )}
          >
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'flex min-w-0 items-center gap-1',
                  isChild
                    ? cn('text-[12px] leading-4', parentActive ? 'text-foreground' : 'text-foreground-secondary')
                    : 'text-[13px] leading-[18px] text-foreground',
                  attention === 'done' && 'font-semibold',
                )}
              >
                {s.forkedFromSessionFile ? (
                  <GitFork
                    className="h-3 w-3 shrink-0 text-foreground-secondary"
                    strokeWidth={2}
                    aria-label={t('common:sidebar.forkedSession')}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate" title={s.title || s.sessionId.slice(0, 8)}>{s.title || s.sessionId.slice(0, 8)}</span>
                {s.interruptedAt && attention !== 'working' ? (
                  <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-300"
                    title={new Date(s.interruptedAt).toLocaleString()}>
                    {t('common:interrupted.badge')}
                  </span>
                ) : null}
                {isChild ? null : (
                  <span
                    className="sidebar-session-time shrink-0 pl-0.5 text-[10px] leading-4 tabular-nums"
                    title={new Date(sessionActivityAt(s)).toLocaleString()}
                  >
                    {relativeSessionTime(sessionActivityAt(s), t)}
                  </span>
                )}
              </div>
              {isChild || !s.forkedFromSessionFile ? null : (
                <div
                  className="mt-0.5 truncate text-[12px] leading-[18px] text-foreground-secondary"
                  title={`${t('common:sidebar.forkedFrom', { title: forkSourceTitle })}\n${s.forkedFromSessionFile}`}
                >
                  {t('common:sidebar.forkedFrom', { title: forkSourceTitle })}
                </div>
              )}
            </div>
            <SessionAttentionDot
              attention={attention}
              className="ml-0.5"
              title={
                attention === 'needs-you'
                  ? t('common:attention.needsYou')
                  : attention === 'done'
                    ? t('common:attention.done')
                    : attention === 'working'
                      ? t('common:app.status.running')
                      : undefined
              }
            />
          </button>
          {childCount > 0 && sessionFile && (
            <button
              type="button"
              aria-label={t('common:sidebar.toggleSubagents', {
                title: s.title || s.sessionId.slice(0, 8),
              })}
              aria-expanded={expanded}
              aria-controls={childrenId}
              title={t('common:sidebar.childSessionCount', { count: childCount })}
              onClick={() => {
                setExpandedSessionFiles((previous) => {
                  const next = new Set(previous)
                  if (next.has(node.key)) next.delete(node.key)
                  else next.add(node.key)
                  return next
                })
              }}
              className={cn(
                'chrome-icon-btn flex shrink-0 items-center justify-center gap-1 rounded-md px-1.5',
                isChild ? 'h-[30px] min-w-[30px]' : 'h-9 min-w-8',
              )}
            >
              <span className="sidebar-child-count">{childCount}</span>
              <ChevronRight
                className="chevron-expand h-3 w-3 text-foreground-secondary/75"
                data-open={expanded ? 'true' : 'false'}
              />
            </button>
          )}
        </div>
        {childCount > 0 && (
          <div
            id={childrenId}
            className="sidebar-children-collapse"
            data-open={expanded ? 'true' : 'false'}
            aria-hidden={!expanded}
            ref={(element) => {
              // Collapsed children stay mounted for the height transition but must not take focus.
              if (!element) return
              if (expanded) element.removeAttribute('inert')
              else element.setAttribute('inert', '')
            }}
          >
          <div className="sidebar-children-collapse-inner">
          <div className="sidebar-children-guide">
            {sortNodes(children).map((child) => renderSession(child, depth + 1))}
            {transientChildren.map((child) => {
              const childActive = !!child.sessionFile
                        && workspacePathsEqual(workspacePath, currentWorkspace)
                        && sessionFilesEqual(child.sessionFile, historySessionFile)
              const canOpen = !!child.sessionFile
              return (
                <button
                  key={child.key}
                  type="button"
                  disabled={!canOpen}
                  aria-label={canOpen
                    ? t('common:sidebar.openSubagentSession', { agent: child.agent })
                    : t('common:sidebar.subagentSessionUnavailable', { agent: child.agent })}
                  onClick={() => {
                    const file = child.sessionFile
                    if (file) guardSessionSwitch(() => { void openSubagentSessionPreview(file) })
                  }}
                  className={cn(
                    'nav-row sidebar-subagent-row sidebar-child-row flex min-h-[30px] w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left',
                    childActive
                      ? 'nav-row-active'
                      : 'text-foreground-secondary hover:text-foreground',
                    !canOpen && 'cursor-default opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium leading-4 text-foreground">
                      {child.agent}
                    </div>
                    {child.task ? (
                      <div className="truncate text-[11px] leading-4 text-foreground-secondary">{child.task}</div>
                    ) : null}
                  </div>
                  <span
                    className="sidebar-child-state"
                    data-state={child.state}
                    title={t(`timeline:tree.state.${child.state}`)}
                    aria-label={t(`timeline:tree.state.${child.state}`)}
                  />
                </button>
              )
            })}
          </div>
          </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="sidebar-session-tree px-1.5 pt-0.5">
      {error && <div role="status" className="px-2 py-2 text-xs text-foreground-secondary" title={error}>
        <p>{t('common:sidebar.sessionReadFailed')}</p>
        <button type="button" className="workbench-button mt-1" disabled={loading} onClick={onRetry}>{t('common:retry')}</button>
      </div>}
      {pendingNew && !searchQuery.trim() ? (
        <div className="mb-0.5">
          <div className="nav-row nav-row-active sidebar-session-row sidebar-pending-row flex min-h-[38px] items-center gap-0.5 rounded-lg px-1 py-0.5" aria-current="page">
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] leading-[18px] text-foreground">{t('common:sidebar.newSessionDraft')}</div>
                <div className="truncate text-[11px] leading-[16px] text-foreground-secondary/85">{t('common:sidebar.firstMsgIsTitle')}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {loading ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:loading')}</p>
      ) : visibleRoots.length === 0 ? (
        !error && !pendingNew && <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:sidebar.noSessions')}</p>
      ) : sortNodes(visibleRoots).map((node) => renderSession(node))}
    </div>
  )
}

export function ProjectDiskRow({
  path,
  name,
  branch,
  worktree = false,
  active,
  open,
  onToggleOpen,
  onOpenProject,
  onNewSession,
  onProjectContextMenu,
  dragSource,
  dropTarget,
  sessionTree,
}: {
  path: string
  name: string
  branch?: string
  worktree?: boolean
  active: boolean
  open: boolean
  onToggleOpen: () => void
  onOpenProject?: () => void
  onNewSession: () => void
  onProjectContextMenu: (e: React.MouseEvent) => void
  dragSource?: Pick<React.HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart' | 'onDragEnd'>
  dropTarget?: ReturnType<ReturnType<typeof useSidebarReorder>['target']>
  sessionTree: React.ReactNode
}) {
  const { t } = useTranslation()
  const branchName = branch?.replace(/^refs\/heads\//, '')
  return (
    <div key={path} className={cn('sidebar-project-row sidebar-drop-target', worktree ? 'sidebar-worktree-row' : 'sidebar-project-card')} data-active={active} data-workspace={path} onContextMenu={onProjectContextMenu} {...dropTarget}>
      <div
        className="sidebar-project-header"
        {...dragSource}
      >
        <button
          type="button"
          onClick={onToggleOpen}
          className="workbench-icon sidebar-project-toggle shrink-0"
          aria-label={t('common:sidebar.toggleProject', { name })}
          aria-expanded={open}
        >
          <ChevronRight
            className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary/80"
            data-open={open ? 'true' : 'false'}
          />
        </button>
        <button
          type="button"
          onClick={() => guardSessionSwitch(onOpenProject || onToggleOpen)}
          className="sidebar-project-hit flex min-w-0 flex-1 items-center gap-2 px-1 text-left"
          title={`${name}\n${path}`}
          aria-current={active ? 'location' : undefined}
        >
          <span className="sidebar-project-name truncate">{name}</span>
          {branchName && branchName !== name ? <span className="sidebar-project-branch truncate" title={branchName}>{branchName}</span> : null}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onNewSession()
          }}
          aria-label={t('common:newSession')}
          title={t('common:newSession')}
          className="sidebar-section-action sidebar-project-add"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <SidebarAnimatedCollapse open={open}>{sessionTree}</SidebarAnimatedCollapse>
    </div>
  )
}

export function SandboxDialogRow({
  box,
  active,
  onOpen,
  onContextMenu,
}: {
  box: SandboxEntry
  active: boolean
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  const attention = useUIStore((state) => selectSessionAttention(box.sessionFile, state.sessionAttention))
  const displayLabel =
    box.label?.trim() || t('common:sidebar.tempChat')
  return (
    <div
      key={box.path}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onContextMenu={onContextMenu}
      className={cn(
        'nav-row sidebar-session-row mb-0.5 flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 py-2',
        active ? 'nav-row-active' : 'text-foreground-secondary hover:text-foreground',
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-[13px] leading-[18px] text-foreground',
            attention === 'done' && 'font-semibold',
          )}
        >
          {displayLabel}
        </div>
        <div className="text-[11px] leading-[16px] tabular-nums text-foreground-secondary/85">
          {new Date(box.createdAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
      <SessionAttentionDot
        attention={attention}
        className="ml-0.5"
        title={
          attention === 'needs-you'
            ? t('common:attention.needsYou')
            : attention === 'done'
              ? t('common:attention.done')
              : attention === 'working'
                ? t('common:app.status.running')
                : undefined
        }
      />
    </div>
  )
}
