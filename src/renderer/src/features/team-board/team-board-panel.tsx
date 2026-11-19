import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  Users,
} from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { loadWorkspaceSessionList } from '@renderer/lib/refresh-workspace-session-lists'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import {
  TEAM_STATUSES,
  deriveTeamStage,
  teamProgress,
  type TeamRoleBinding,
  type TeamRun,
  type TeamSnapshot,
  type TeamStage,
  type TeamStatus,
  type TeamTask,
} from '@shared/team-board'
import './team-board.css'
import {
  CARD_STAGES,
  STAGE_TONES,
  TEAM_BOARD_CHANGED_EVENT,
  isSessionRunning,
  latestRun,
  needsAttention,
  notifyTeamBoardChanged,
  notifyTeamRunsChanged,
  openTeamSession,
  roleAvatar,
  roleColor,
  roleLabel,
  shortModel,
  stageLabel,
  statusLabel,
  STATUS_COLORS,
} from './team-board-lib'
import { TeamTaskSheet } from './team-task-sheet'
import { TeamSettingsSheet } from './team-settings-sheet'
import { TeamInitSheet } from './team-init-sheet'
import { TeamTaskCreateSheet } from './team-task-create-sheet'

const VIEW_STORAGE_KEY = 'pi-desktop:team-view'
const RING_LENGTH = 2 * Math.PI * 9

type PanelView = 'lanes' | 'people'

function projectNameOf(workspaceId: string): string {
  const normalized = String(workspaceId || '').split(String.fromCharCode(92)).join('/')
  return normalized.split('/').filter(Boolean).pop() || normalized
}

export function TeamBoardPanel() {
  const { t } = useTranslation()
  const workspaceId = useUIStore((state) => state.currentWorkspace) || ''
  const sessionRuntimeRunning = useUIStore((state) => state.sessionRuntimeRunning)

  const [snapshot, setSnapshot] = useState<TeamSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<PanelView>(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'people' ? 'people' : 'lanes'
    } catch {
      return 'lanes'
    }
  })
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [pendingStatus, setPendingStatus] = useState<TeamStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [initMode, setInitMode] = useState<'new' | 'legacy' | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [draggingId, setDraggingId] = useState('')
  const [overStatus, setOverStatus] = useState<TeamStatus | null>(null)
  const [busyTaskId, setBusyTaskId] = useState('')
  const [roleBusy, setRoleBusy] = useState('')

  const requestSeq = useRef(0)
  const lanesRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!workspaceId) {
        setSnapshot(null)
        return null
      }
      const token = ++requestSeq.current
      if (!options?.silent) setLoading(true)
      try {
        const response = await ipcClient.invoke('teamBoard.snapshot', { workspaceId })
        if (token !== requestSeq.current) return null
        const next = (response?.snapshot ?? null) as TeamSnapshot | null
        setSnapshot(next)
        setError('')
        setLoadedOnce(true)
        return next
      } catch (caught) {
        if (token === requestSeq.current) {
          setError(String((caught as Error)?.message || caught))
          setLoadedOnce(true)
        }
        return null
      } finally {
        if (token === requestSeq.current) setLoading(false)
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    // 切换项目时先清掉上一个项目的看板，避免旧卡片闪现到新项目。
    setSnapshot(null)
    setLoadedOnce(false)
    setSelectedTaskId(null)
    setPendingStatus(null)
    void refresh({ silent: false })
  }, [refresh])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh({ silent: true })
    }, 8000)
    const onFocus = () => void refresh({ silent: true })
    const onChanged = () => void refresh({ silent: true })
    window.addEventListener('focus', onFocus)
    window.addEventListener(TEAM_BOARD_CHANGED_EVENT, onChanged)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(TEAM_BOARD_CHANGED_EVENT, onChanged)
    }
  }, [refresh])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      /* noop */
    }
  }, [view])

  const tasks = snapshot?.tasks ?? []
  const roles = snapshot?.roles ?? []
  const runs = snapshot?.runs ?? []
  const progress = teamProgress(tasks)
  const runningRoles = roles.filter((binding) =>
    isSessionRunning(sessionRuntimeRunning, snapshot?.sessions[binding.role]?.sessionFile),
  )
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  const selectedBinding = roles.find((binding) => binding.role === selectedTask?.role)
  const specPath = snapshot?.specPath || `${String(workspaceId || '').replace(/\/+$/, '')}/.文档/开发规范`
  const projectName = projectNameOf(workspaceId)
  const approvalCount = tasks.filter((task) => needsAttention(task) && task.status !== '已验收').length

  useEffect(() => {
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null)
      setPendingStatus(null)
    }
  }, [selectedTaskId, tasks])

  const byStatus = useMemo(() => {
    const map = new Map<TeamStatus, TeamTask[]>()
    for (const status of TEAM_STATUSES) map.set(status, [])
    for (const task of tasks) {
      const list = map.get(task.status)
      if (list) list.push(task)
      else map.set(task.status, [task])
    }
    return map
  }, [tasks])

  const applyStatus = useCallback(
    async (
      task: TeamTask,
      to: TeamStatus,
      options: { reason?: string; manualConfirmed?: boolean; blockType?: string } = {},
    ): Promise<boolean> => {
      try {
        const response = await ipcClient.invoke('teamBoard.taskStatus', {
          workspaceId,
          taskId: task.id,
          to,
          from: task.status,
          ...options,
        })
        if (response?.ok === false) {
          if (response.reason === 'status_mismatch') toast.message(t('team:statusConflict'))
          else toast.error(t('team:statusFailed'), { description: String(response.reason || '') })
          await refresh({ silent: true })
          return false
        }
        if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
        notifyTeamBoardChanged()
        toast.success(t('team:statusChanged', { status: statusLabel(to, t) }))
        return true
      } catch (caught) {
        toast.error(t('team:statusFailed'), { description: String((caught as Error)?.message || caught) })
        return false
      }
    },
    [refresh, t, workspaceId],
  )

  const openTask = (task: TeamTask, pending?: TeamStatus) => {
    setSelectedTaskId(task.id)
    setPendingStatus(pending ?? null)
  }

  const requestStatus = async (task: TeamTask, to: TeamStatus) => {
    if (task.status === to) return
    if (to === '已验收' || to === '阻塞') {
      openTask(task, to)
      return
    }
    await applyStatus(task, to)
  }

  const onDropLane = (status: TeamStatus) => {
    const task = tasks.find((item) => item.id === draggingId)
    setDraggingId('')
    setOverStatus(null)
    if (task) void requestStatus(task, status)
  }

  const dispatchTask = async (task: TeamTask) => {
    const binding = roles.find((item) => item.role === task.role)
    if (!binding?.model) {
      toast.message(t('team:pickModelFirst'))
      setSettingsOpen(true)
      return
    }
    setBusyTaskId(task.id)
    try {
      const response = await ipcClient.invoke('teamBoard.dispatch', { workspaceId, taskId: task.id })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamRunsChanged()
      notifyTeamBoardChanged()
      void loadWorkspaceSessionList(workspaceId)
      toast.success(t('team:dispatchStarted', { role: roleLabel(task.role, t) }), {
        description: response?.model ? shortModel(String(response.model)) : undefined,
      })
    } catch (caught) {
      toast.error(t('team:dispatchFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setBusyTaskId('')
    }
  }

  const copyPrompt = async (task: TeamTask) => {
    try {
      const response = await ipcClient.invoke('teamBoard.prompt', { workspaceId, taskId: task.id })
      await navigator.clipboard.writeText(String(response?.prompt || ''))
      notifyTeamBoardChanged()
      toast.success(t('team:copied'))
    } catch (caught) {
      toast.error(t('team:dispatchFailed'), { description: String((caught as Error)?.message || caught) })
    }
  }

  const openRole = async (binding: TeamRoleBinding) => {
    if (!binding.enabled) {
      toast.message(t('team:roleDisabled'))
      setSettingsOpen(true)
      return
    }
    if (!binding.model) {
      toast.message(t('team:pickModelFirst'))
      setSettingsOpen(true)
      return
    }
    if (!binding.directEnabled) {
      toast.message(t('team:directDisabled'))
      setSettingsOpen(true)
      return
    }
    setRoleBusy(binding.role)
    try {
      const response = await ipcClient.invoke('teamBoard.roleSession', { workspaceId, role: binding.role })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      await openTeamSession({
        workspaceId,
        sessionFile: String(response?.sessionFile || ''),
        sessionId: response?.sessionId,
      })
      if (response?.opened) toast.success(t('team:roleSessionCreated', { role: roleLabel(binding.role, t) }))
      notifyTeamRunsChanged()
      void loadWorkspaceSessionList(workspaceId)
    } catch (caught) {
      toast.error(t('team:roleSessionFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setRoleBusy('')
    }
  }

  const openRunSession = async (run: TeamRun) => {
    try {
      await openTeamSession({ workspaceId, sessionFile: run.sessionFile, sessionId: run.sessionId })
    } catch (caught) {
      toast.error(t('team:roleSessionFailed'), { description: String((caught as Error)?.message || caught) })
    }
  }

  const settleRun = async (run: TeamRun) => {
    try {
      const response = await ipcClient.invoke('teamBoard.settleRun', {
        workspaceId,
        sessionFile: run.sessionFile,
        outcome: 'success',
        closedBy: 'human',
        note: '人工确认这轮已结束',
      })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamBoardChanged()
      toast.success(t('team:settled'))
    } catch (caught) {
      toast.error(t('team:statusFailed'), { description: String((caught as Error)?.message || caught) })
    }
  }

  const interveneRun = async (task: TeamTask, text: string): Promise<boolean> => {
    try {
      const response = await ipcClient.invoke('teamBoard.intervene', { workspaceId, taskId: task.id, text })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamBoardChanged()
      toast.success(t('team:intervened'))
      return true
    } catch (caught) {
      toast.error(t('team:interveneFailed'), { description: String((caught as Error)?.message || caught) })
      return false
    }
  }

  const abortRun = async (run: TeamRun) => {
    try {
      const response = await ipcClient.invoke('teamBoard.abortRun', { workspaceId, sessionFile: run.sessionFile })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamBoardChanged()
      toast.success(t('team:aborted'))
    } catch (caught) {
      toast.error(t('team:statusFailed'), { description: String((caught as Error)?.message || caught) })
    }
  }

  const resolveApproval = async (task: TeamTask, decision: 'approve' | 'deny', note: string): Promise<boolean> => {
    try {
      const response = await ipcClient.invoke('teamBoard.approval', {
        workspaceId,
        taskId: task.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        from: task.status,
      })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamBoardChanged()
      toast.success(decision === 'approve' ? t('team:approvalApproved') : t('team:approvalDenied'))
      return true
    } catch (caught) {
      toast.error(t('team:approvalFailed'), { description: String((caught as Error)?.message || caught) })
      await refresh({ silent: true })
      return false
    }
  }

  if (!workspaceId) {
    return (
      <div className="team-board flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Users className="h-6 w-6 text-foreground-tertiary/50" />
        <p className="text-xs text-foreground-secondary">{t('team:noWorkspace')}</p>
      </div>
    )
  }

  return (
    <div className="team-board relative flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/40 px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 shrink-0 text-foreground-secondary" />
          <span className="text-sm font-medium">{t('team:title')}</span>
          <span className="min-w-0 flex-1 truncate text-2xs text-foreground-tertiary" title={workspaceId}>
            {projectName}
          </span>
          <button
            type="button"
            onClick={() => void refresh({ silent: false })}
            aria-label={t('team:refresh')}
            title={t('team:refresh')}
            className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!snapshot?.exists) {
                toast.message(t('team:noBoard.initFirst'))
                return
              }
              setSettingsOpen(true)
            }}
            aria-label={t('team:settings')}
            title={t('team:settings')}
            className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>

        {snapshot?.exists ? (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressRing accepted={progress.accepted} total={progress.total} label={t('team:progressHint')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium" title={snapshot.batch}>
                  {snapshot.batch || t('team:batchFallback')}
                </span>
                <span className="shrink-0 text-2xs tabular-nums text-foreground-tertiary">
                  {t('team:progress', { accepted: progress.accepted, total: progress.total })}
                </span>
              </div>
              <div className="truncate text-2xs text-foreground-tertiary" title={snapshot.goal}>
                {snapshot.goal || t('team:goalFallback')}
              </div>
            </div>
            {progress.blocked > 0 ? (
              <span className="team-chip shrink-0" data-tone="danger">
                <AlertTriangle className="h-2.5 w-2.5" />
                {t('team:blocked', { count: progress.blocked })}
              </span>
            ) : null}
            {approvalCount > 0 ? (
              <span className="team-chip shrink-0" data-tone="danger" title={t('team:approvalHint')}>
                {t('team:approvalCount', { count: approvalCount })}
              </span>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="mt-1 flex items-center gap-1.5 text-2xs text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={error}>{error}</span>
            <button type="button" onClick={() => void refresh({ silent: false })} className="underline">
              {t('team:refresh')}
            </button>
          </div>
        ) : null}
      </header>

      {!loadedOnce ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-foreground-tertiary" />
        </div>
      ) : !snapshot ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <AlertTriangle className="h-6 w-6 text-foreground-tertiary/50" />
          <div className="text-xs font-medium">{t('team:loadFailed')}</div>
          <p className="max-w-[280px] break-all text-2xs text-foreground-tertiary">{error}</p>
          <button
            type="button"
            onClick={() => void refresh({ silent: false })}
            className="mt-1 rounded border border-border/60 px-2.5 py-1.5 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)]"
          >
            {t('team:refresh')}
          </button>
        </div>
      ) : !snapshot.exists ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Users className="h-7 w-7 text-foreground-tertiary/40" />
          <div className="text-sm font-medium">{t('team:noBoard.title')}</div>
          <p className="max-w-[280px] text-xs leading-relaxed text-foreground-secondary">{t('team:noBoard.desc')}</p>
          <p className="max-w-full break-all font-mono text-2xs text-foreground-tertiary">{specPath}</p>
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              onClick={() => setInitMode('new')}
              className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1.5 text-2xs font-medium text-primary-foreground"
            >
              <Plus className="h-3 w-3" />
              {t('team:noBoard.init')}
            </button>
            <button
              type="button"
              onClick={() => setInitMode('legacy')}
              className="rounded border border-border/60 px-2.5 py-1.5 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              {t('team:noBoard.takeover')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 px-3 pb-1.5 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-tertiary">{t('team:team')}</span>
              <span className="text-2xs text-foreground-tertiary">
                {runningRoles.length > 0 ? t('team:running', { count: runningRoles.length }) : t('team:roleSessionHint')}
              </span>
            </div>
            <div className="team-scroll mt-1 flex gap-0.5 overflow-x-auto pb-0.5">
              {roles.map((binding) => (
                <RoleChip
                  key={binding.role}
                  binding={binding}
                  running={isSessionRunning(sessionRuntimeRunning, snapshot?.sessions[binding.role]?.sessionFile)}
                  busy={roleBusy === binding.role}
                  count={tasks.filter((task) => task.role === binding.role && task.status !== '已验收').length}
                  onClick={() => void openRole(binding)}
                />
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
            <span className="text-xs font-medium">{t('team:tasks')}</span>
            <span className="text-2xs tabular-nums text-foreground-tertiary">{tasks.length}</span>
            <div className="ml-auto flex items-center gap-0.5 rounded bg-[var(--bg-hover)] p-0.5">
              <button
                type="button"
                onClick={() => setView('lanes')}
                data-active={view === 'lanes'}
                className={cn(
                  'rounded px-1.5 py-0.5 text-2xs',
                  view === 'lanes' ? 'bg-background text-foreground shadow-sm' : 'text-foreground-secondary',
                )}
              >
                {t('team:lanes')}
              </button>
              <button
                type="button"
                onClick={() => setView('people')}
                data-active={view === 'people'}
                className={cn(
                  'rounded px-1.5 py-0.5 text-2xs',
                  view === 'people' ? 'bg-background text-foreground shadow-sm' : 'text-foreground-secondary',
                )}
              >
                {t('team:people')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              aria-label={t('team:taskCard')}
              title={t('team:taskCard')}
              className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {view === 'lanes' ? (
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => lanesRef.current?.scrollBy({ left: -172, behavior: 'smooth' })}
                  aria-label={t('team:lanes')}
                  className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)]"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => lanesRef.current?.scrollBy({ left: 172, behavior: 'smooth' })}
                  aria-label={t('team:lanes')}
                  className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)]"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            ) : null}
          </div>

          {view === 'lanes' ? (
            <div ref={lanesRef} className="team-scroll flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-3 pb-3">
              {TEAM_STATUSES.map((status) => {
                const items = byStatus.get(status) ?? []
                return (
                  <section
                    key={status}
                    className="team-lane"
                    data-over={overStatus === status}
                    style={{ '--lane-color': STATUS_COLORS[status] } as CSSProperties}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      if (overStatus !== status) setOverStatus(status)
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setOverStatus((current) => (current === status ? null : current))
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      onDropLane(status)
                    }}
                  >
                    <div className="team-lane-head">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[status] }} />
                      <span className="truncate">{statusLabel(status, t)}</span>
                      <span className="team-lane-count">{items.length}</span>
                    </div>
                    <div className="team-lane-cards team-scroll">
                      {items.map((task) => {
                        const run = latestRun(task, runs)
                        return (
                          <TaskCard
                            key={task.id}
                            task={task}
                            run={run}
                            stage={deriveTeamStage({ task, run })}
                            running={isSessionRunning(sessionRuntimeRunning, run?.sessionFile)}
                            dragging={draggingId === task.id}
                            onOpen={() => openTask(task)}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', task.id)
                              setDraggingId(task.id)
                            }}
                            onDragEnd={() => {
                              setDraggingId('')
                              setOverStatus(null)
                            }}
                          />
                        )
                      })}
                      {items.length === 0 ? <div className="team-lane-empty">{t('team:emptyLane')}</div> : null}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <PeopleView
              tasks={tasks}
              roles={roles}
              runs={runs}
              onOpen={openTask}
              runtimeRunning={sessionRuntimeRunning}
            />
          )}

          {tasks.length === 0 ? (
            <div className="shrink-0 px-3 pb-2 text-center text-2xs text-foreground-tertiary">
              {t('team:noTasksHint')}
            </div>
          ) : null}
        </>
      )}

      {selectedTask ? (
        <TeamTaskSheet
          task={selectedTask}
          binding={selectedBinding}
          runs={runs}
          runtimeRunning={sessionRuntimeRunning}
          busy={busyTaskId === selectedTask.id}
          initialPending={pendingStatus}
          onClose={() => {
            setSelectedTaskId(null)
            setPendingStatus(null)
          }}
          onStatus={(to, options) => applyStatus(selectedTask, to, options)}
          onDispatch={() => void dispatchTask(selectedTask)}
          onCopyPrompt={() => void copyPrompt(selectedTask)}
          onOpenRole={() => {
            if (selectedBinding) void openRole(selectedBinding)
          }}
          onOpenSession={(run) => void openRunSession(run)}
          onSettleRun={(run) => void settleRun(run)}
          onApproval={(decision, note) => resolveApproval(selectedTask, decision, note)}
          onIntervene={(text) => interveneRun(selectedTask, text)}
          onAbort={(run) => void abortRun(run)}
        />
      ) : null}

      {settingsOpen ? (
        <TeamSettingsSheet
          workspaceId={workspaceId}
          roles={roles}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => setSnapshot(next)}
        />
      ) : null}

      {initMode ? (
        <TeamInitSheet
          workspaceId={workspaceId}
          defaultMode={initMode}
          projectName={projectName}
          specPath={specPath}
          onClose={() => setInitMode(null)}
          onDone={(next) => {
            setSnapshot(next)
            notifyTeamBoardChanged()
          }}
        />
      ) : null}

      {createOpen ? (
        <TeamTaskCreateSheet
          workspaceId={workspaceId}
          defaultRole={roles[2]?.role || '前端'}
          onClose={() => setCreateOpen(false)}
          onDone={(next) => {
            setSnapshot(next)
            notifyTeamBoardChanged()
          }}
        />
      ) : null}
    </div>
  )
}

function ProgressRing({ accepted, total, label }: { accepted: number; total: number; label: string }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, accepted / total)) : 0
  return (
    <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center" title={label}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="color-mix(in srgb, var(--text-secondary) 16%, transparent)" strokeWidth="2.6" />
        <circle
          className="value"
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - ratio)}
        />
      </svg>
      <span className="absolute text-[8px] font-medium tabular-nums text-foreground-secondary">
        {total > 0 ? Math.round(ratio * 100) : 0}
      </span>
    </span>
  )
}

function RoleChip({
  binding,
  running,
  busy,
  count,
  onClick,
}: {
  binding: TeamRoleBinding
  running: boolean
  busy: boolean
  count: number
  onClick: () => void
}) {
  const { t } = useTranslation()
  const accent = roleColor(binding.role)
  return (
    <button
      type="button"
      onClick={onClick}
      data-role={binding.role}
      data-running={running}
      data-disabled={!binding.enabled}
      className="team-role-chip"
      style={{ '--team-role': accent } as CSSProperties}
      title={`${roleLabel(binding.role, t)} · ${binding.model || t('team:unbound')}${binding.effort ? ` · ${binding.effort}` : ''}`}
    >
      <span className="relative inline-flex">
        <span className="team-avatar">
          <img src={roleAvatar(binding.role)} alt="" />
        </span>
        <span className="team-role-ring" aria-hidden="true" />
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        ) : (
          <span
            className="team-role-dot absolute -bottom-0.5 right-0"
            data-live={running}
            style={{ background: running ? accent : 'color-mix(in srgb, var(--text-secondary) 35%, transparent)' }}
          />
        )}
        {count > 0 ? (
          <span className="absolute -right-1.5 -top-1 min-w-[13px] rounded-full bg-[var(--bg-active)] px-1 text-center text-[9px] leading-[13px] text-foreground-secondary">
            {count}
          </span>
        ) : null}
      </span>
      <span className="w-full truncate text-center text-2xs text-foreground">{roleLabel(binding.role, t)}</span>
      <span className="w-full truncate text-center text-[9px] leading-[11px] text-foreground-tertiary">
        {binding.model ? shortModel(binding.model) : t('team:unbound')}
      </span>
    </button>
  )
}

function TaskCard({
  task,
  run,
  stage,
  running,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  task: TeamTask
  run: TeamRun | undefined
  stage: TeamStage
  running: boolean
  dragging: boolean
  onOpen: () => void
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
}) {
  const { t } = useTranslation()
  const accepted = task.acceptance.filter((item) => item.done).length
  const runActive = run?.status === 'starting' || run?.status === 'running'
  const showStage = CARD_STAGES.has(stage)
  return (
    <button
      type="button"
      draggable
      onClick={onOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="team-card"
      data-dragging={dragging}
      data-running={runActive}
      data-stage={stage}
      style={{ '--card-accent': STATUS_COLORS[task.status] } as CSSProperties}
      title={task.note || task.title}
    >
      <div className="flex items-center gap-1">
        <span className="team-card-id">{task.id}</span>
        <span className="h-1 w-1 rounded-full" style={{ background: roleColor(task.role) }} />
        {showStage ? (
          <span className="team-chip ml-auto shrink-0" data-tone={STAGE_TONES[stage]}>
            {stageLabel(stage, t)}
          </span>
        ) : runActive ? (
          <span
            className="team-role-dot ml-auto"
            data-live={running}
            style={{ background: running ? 'var(--primary)' : 'var(--warning-semantic)' }}
            title={running ? t('team:runRunning') : t('team:staleRun')}
          />
        ) : null}
      </div>
      <div className="team-card-title mt-0.5">{task.title}</div>
      <div className="team-card-meta">
        <span className="truncate" style={{ color: roleColor(task.role) }}>{roleLabel(task.role, t)}</span>
        {task.blockType ? (
          <span className="team-chip" data-tone="danger">{task.blockType}</span>
        ) : null}
        {task.acceptance.length ? (
          <span className="ml-auto shrink-0 tabular-nums">{accepted}/{task.acceptance.length}</span>
        ) : null}
      </div>
    </button>
  )
}

function PeopleView({
  tasks,
  roles,
  runs,
  runtimeRunning,
  onOpen,
}: {
  tasks: TeamTask[]
  roles: TeamRoleBinding[]
  runs: TeamRun[]
  runtimeRunning: Record<string, boolean> | null | undefined
  onOpen: (task: TeamTask) => void
}) {
  const { t } = useTranslation()
  const known = new Set<string>(roles.map((binding) => binding.role))
  const extra = [...new Set(tasks.map((task) => task.role).filter((role) => role && !known.has(role)))]
  const groups = [
    ...roles.map((binding) => ({ role: binding.role, binding, items: tasks.filter((task) => task.role === binding.role) })),
    ...extra.map((role) => ({ role, binding: undefined, items: tasks.filter((task) => task.role === role) })),
  ]
  return (
    <div className="team-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {groups.map((group) => (
        <div key={group.role} className="team-people-group">
          <div className="flex items-center gap-1.5 px-0.5 pb-1">
            <span className="team-avatar !h-5 !w-5" style={{ '--team-role': roleColor(group.role) } as CSSProperties}>
              <img src={roleAvatar(group.role)} alt="" />
            </span>
            <span className="text-xs font-medium">{roleLabel(group.role, t)}</span>
            <span className="text-2xs text-foreground-tertiary">{group.items.length}</span>
            {group.items.some((task) => {
              const run = latestRun(task, runs)
              return (run?.status === 'starting' || run?.status === 'running') && isSessionRunning(runtimeRunning, run.sessionFile)
            }) ? (
              <span className="team-role-dot" data-live="true" style={{ background: roleColor(group.role) }} />
            ) : null}
          </div>
          {group.items.length === 0 ? (
            <div className="px-1 py-1 text-2xs text-foreground-tertiary">{t('team:noTasks')}</div>
          ) : (
            group.items.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpen(task)}
                className="mb-1 flex w-full items-start gap-1.5 rounded-md border border-border/40 bg-background/60 px-1.5 py-1 text-left hover:border-border hover:bg-[var(--bg-hover)]"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[task.status], marginTop: 4 }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-2xs text-foreground">{task.title}</span>
                  <span className="block truncate text-[9px] text-foreground-tertiary">
                    {task.id} · {statusLabel(task.status, t)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ))}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <MessageSquare className="h-5 w-5 text-foreground-tertiary/40" />
          <span className="text-xs text-foreground-secondary">{t('team:noTasks')}</span>
          <span className="text-2xs text-foreground-tertiary">{t('team:noTasksHint')}</span>
        </div>
      ) : null}
    </div>
  )
}
