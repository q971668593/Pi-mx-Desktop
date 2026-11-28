import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Bot,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  GitBranch,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Square,
  Users,
  X,
} from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { loadWorkspaceSessionList } from '@renderer/lib/refresh-workspace-session-lists'
import { selectDelegateRuns, type DelegateRun } from '@renderer/lib/delegate-runs'
import { openDelegateSessionPreview } from '@renderer/lib/delegate-session-navigation'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { selectActiveSubagentSessionChildren } from '@renderer/lib/subagent-session-activity'
import { openSubagentSessionPreview } from '@renderer/lib/subagent-session-navigation'
import type { SubagentSessionChild } from '@renderer/lib/subagent-session-types'
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
  TEAM_BOARD_RUNS_CHANGED_EVENT,
  formatRunElapsed,
  isSessionRunning,
  latestRun,
  needsAttention,
  notifyTeamBoardChanged,
  notifyTeamRunsChanged,
  openTeamSession,
  openTeamSessionInSplit,
  roleAvatar,
  roleColor,
  roleLabel,
  shortModel,
  stageLabel,
  statusLabel,
  STATUS_COLORS,
} from './team-board-lib'
import {
  assignRunSlots,
  extractSubagentTelemetry,
  findSessionStateForRun,
  formatWorkerBadge,
  type SubagentTelemetry,
} from './subagent-telemetry'
import { TeamTaskSheet } from './team-task-sheet'
import { TeamSettingsSheet } from './team-settings-sheet'
import { TeamInitSheet } from './team-init-sheet'
import { TeamTaskCreateSheet } from './team-task-create-sheet'
import { useLanePan } from './use-lane-pan'

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
  const sessionStates = useUIStore((state) => state.sessionStates)
  const historySessionFile = useUIStore((state) => state.historySessionFile || '')
  const delegateRuns = useUIStore((state) => selectDelegateRuns(state.timelineItems ?? []))
  const treeSubagents = useUIStore((state) => selectActiveSubagentSessionChildren(state.timelineItems ?? []))

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
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [nextBatchName, setNextBatchName] = useState('')
  const [nextBatchGoal, setNextBatchGoal] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [draggingId, setDraggingId] = useState('')
  const [overStatus, setOverStatus] = useState<TeamStatus | null>(null)
  const [busyTaskId, setBusyTaskId] = useState('')
  const [mergingTaskId, setMergingTaskId] = useState('')
  const [reviewingTaskId, setReviewingTaskId] = useState('')
  const [roleBusy, setRoleBusy] = useState('')
  const [roleMenuRole, setRoleMenuRole] = useState<string | null>(null)
  const [resumingRunId, setResumingRunId] = useState('')
  const [openingSubagentKey, setOpeningSubagentKey] = useState('')
  const [showRecentSubagents, setShowRecentSubagents] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const requestSeq = useRef(0)
  const prevWorkspaceRef = useRef(workspaceId)
  const hydratedOnceRef = useRef(false)
  const lanes = useLanePan<HTMLDivElement>({ enabled: view === 'lanes' })

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!workspaceId) {
        setSnapshot(null)
        return null
      }
      const token = ++requestSeq.current
      if (!options?.silent) setLoading(true)
      try {
        const response = await ipcClient.invoke('teamBoard.snapshot', {
          workspaceId,
          ...(historySessionFile ? { sessionFile: historySessionFile } : {}),
        })
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
    [historySessionFile, workspaceId],
  )

  useEffect(() => {
    const workspaceChanged = prevWorkspaceRef.current !== workspaceId
    prevWorkspaceRef.current = workspaceId
    if (workspaceChanged || !hydratedOnceRef.current) {
      hydratedOnceRef.current = true
      // 切换项目时先清掉上一个项目的看板，避免旧卡片闪现到新项目。
      setSnapshot(null)
      setLoadedOnce(false)
      setSelectedTaskId(null)
      setPendingStatus(null)
      setRoleMenuRole(null)
      void refresh({ silent: false })
    } else {
      setRoleMenuRole(null)
      void refresh({ silent: true })
    }
  }, [refresh, workspaceId])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh({ silent: true })
    }, 8000)
    const onFocus = () => void refresh({ silent: true })
    const onChanged = () => void refresh({ silent: true })
    window.addEventListener('focus', onFocus)
    window.addEventListener(TEAM_BOARD_CHANGED_EVENT, onChanged)
    window.addEventListener(TEAM_BOARD_RUNS_CHANGED_EVENT, onChanged)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(TEAM_BOARD_CHANGED_EVENT, onChanged)
      window.removeEventListener(TEAM_BOARD_RUNS_CHANGED_EVENT, onChanged)
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
  const roles = snapshot?.roles.map((role) => ({ ...role, model: role.model || snapshot.defaultModel || '' })) ?? []
  const runs = snapshot?.runs ?? []
  const roleModelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const binding of roles) {
      if (binding.model) map.set(binding.role, binding.model)
    }
    return map
  }, [roles])
  const slotByRunId = useMemo(() => assignRunSlots(runs), [runs])
  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) map.set(task.id, task.title)
    return map
  }, [tasks])
  const activeTeamRuns = useMemo(
    () => [...runs].reverse().filter((run) => run.status === 'starting' || run.status === 'running'),
    [runs],
  )
  const activeRunsForRole = useCallback(
    (role: string): TeamRun[] => activeTeamRuns.filter((run) => run.role === role),
    [activeTeamRuns],
  )
  const activeRunForRole = useCallback(
    (role: string): TeamRun | undefined => {
      const matching = activeRunsForRole(role)
      return matching.find((run) => isSessionRunning(sessionRuntimeRunning, run.sessionFile)) ?? matching[0]
    },
    [activeRunsForRole, sessionRuntimeRunning],
  )
  const telemetryByRunId = useMemo(() => {
    const map = new Map<string, SubagentTelemetry>()
    for (const run of runs) {
      map.set(
        run.id,
        extractSubagentTelemetry({
          run,
          sessionState: findSessionStateForRun(sessionStates, run.sessionFile),
          fallbackModel: roleModelMap.get(run.role) || snapshot?.defaultModel || '',
          slot: slotByRunId.get(run.id),
          nowMs,
        }),
      )
    }
    return map
  }, [nowMs, roleModelMap, runs, sessionStates, slotByRunId, snapshot?.defaultModel])
  const hasLiveSubagent = useMemo(
    () =>
      activeTeamRuns.length > 0
      || delegateRuns.some((run) => run.state === 'running')
      || treeSubagents.some((child) => child.state === 'running' || child.state === 'pending'),
    [activeTeamRuns, delegateRuns, treeSubagents],
  )
  useEffect(() => {
    if (!hasLiveSubagent) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasLiveSubagent])
  const progress = teamProgress(tasks)
  const runningRoles = roles.filter(
    (binding) =>
      isSessionRunning(sessionRuntimeRunning, snapshot?.sessions[binding.role]?.sessionFile)
      || Boolean(activeRunForRole(binding.role)),
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
      const response = await ipcClient.invoke('teamBoard.dispatch', {
        workspaceId,
        taskId: task.id,
        ...(historySessionFile ? { sessionFile: historySessionFile } : {}),
      })
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

  const mergeTask = async (task: TeamTask) => {
    setMergingTaskId(task.id)
    try {
      const response = await ipcClient.invoke('teamBoard.merge', { workspaceId, taskId: task.id })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamBoardChanged()
      toast.success(t('team:merged', { branch: task.branch }))
    } catch (caught) {
      await refresh({ silent: true })
      toast.error(t('team:mergeFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setMergingTaskId('')
    }
  }

  const dispatchReviewTask = async (task: TeamTask) => {
    setReviewingTaskId(task.id)
    try {
      const response = await ipcClient.invoke('teamBoard.dispatchReview', {
        workspaceId,
        taskId: task.id,
        ...(historySessionFile ? { sessionFile: historySessionFile } : {}),
      })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamRunsChanged()
      notifyTeamBoardChanged()
      void loadWorkspaceSessionList(workspaceId)
      toast.success(t('team:reviewStarted'), {
        description: response?.model ? shortModel(String(response.model)) : undefined,
      })
    } catch (caught) {
      toast.error(t('team:reviewFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setReviewingTaskId('')
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
      const response = await ipcClient.invoke('teamBoard.roleSession', {
        workspaceId,
        role: binding.role,
        ...(historySessionFile ? { sessionFile: historySessionFile } : {}),
      })
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
    setOpeningSubagentKey(run.id)
    setRoleMenuRole(null)
    try {
      await openTeamSession({
        workspaceId,
        worktreePath: run.worktreePath,
        sessionFile: run.sessionFile,
        sessionId: run.sessionId,
        rememberReturn: true,
        subagentLabel: `${formatWorkerBadge(roleLabel(run.role, t), slotByRunId.get(run.id))} · ${run.taskId}`,
      })
    } catch (caught) {
      toast.error(t('team:roleSessionFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setOpeningSubagentKey('')
    }
  }

  const splitRunSession = async (run: TeamRun) => {
    setOpeningSubagentKey(`split:${run.id}`)
    setRoleMenuRole(null)
    try {
      const taskTitle = taskTitleById.get(run.taskId)
      const label = formatWorkerBadge(roleLabel(run.role, t), slotByRunId.get(run.id))
      await openTeamSessionInSplit({
        workspaceId,
        worktreePath: run.worktreePath,
        sessionFile: run.sessionFile,
        sessionId: run.sessionId,
        title: `${label} · ${run.taskId}${taskTitle ? ` ${taskTitle}` : ''}`,
      })
    } catch (caught) {
      toast.error(t('team:roleSessionFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setOpeningSubagentKey('')
    }
  }

  const resumeRun = async (run: TeamRun) => {
    if (resumingRunId) return
    setResumingRunId(run.id)
    try {
      const response = await ipcClient.invoke('teamBoard.resumeRun', {
        workspaceId,
        sessionFile: run.sessionFile,
        taskId: run.taskId,
        ...(historySessionFile ? { contextSessionFile: historySessionFile } : {}),
      })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamRunsChanged()
      notifyTeamBoardChanged()
      void loadWorkspaceSessionList(workspaceId)
      toast.success(t('team:subagentSection.resumed', { role: roleLabel(run.role, t), taskId: run.taskId }))
    } catch (caught) {
      toast.error(t('team:subagentSection.resumeFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setResumingRunId('')
    }
  }

  const openDelegateRun = async (run: DelegateRun) => {
    setOpeningSubagentKey(`delegate:${run.runId}`)
    try {
      await openDelegateSessionPreview(run)
    } catch (caught) {
      toast.error(t('team:roleSessionFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setOpeningSubagentKey('')
    }
  }

  const openTreeChild = async (child: SubagentSessionChild) => {
    if (!child.sessionFile) return
    setOpeningSubagentKey(`tree:${child.key}`)
    try {
      await openSubagentSessionPreview(child.sessionFile)
    } catch (caught) {
      toast.error(t('team:roleSessionFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setOpeningSubagentKey('')
    }
  }

  const handleRoleChipClick = (binding: TeamRoleBinding) => {
    const activeList = activeRunsForRole(binding.role)
    if (activeList.length === 1) {
      void openRunSession(activeList[0])
      return
    }
    if (activeList.length >= 2) {
      setRoleMenuRole((current) => (current === binding.role ? null : binding.role))
      return
    }
    setRoleMenuRole(null)
    void openRole(binding)
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

  const appendMemory = async (task: TeamTask, kind: 'lesson' | 'taste', text: string): Promise<boolean> => {
    try {
      const response = await ipcClient.invoke('teamBoard.appendMemory', {
        workspaceId,
        kind,
        text,
        taskId: task.id,
      })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      toast.success(t('team:memorySaved'))
      return true
    } catch (caught) {
      toast.error(t('team:memoryFailed'), { description: String((caught as Error)?.message || caught) })
      return false
    }
  }

  const archiveBatch = async () => {
    setArchiving(true)
    try {
      const response = await ipcClient.invoke('teamBoard.archiveBatch', {
        workspaceId,
        ...(nextBatchName.trim() ? { nextBatch: nextBatchName.trim() } : {}),
        ...(nextBatchGoal.trim() ? { nextGoal: nextBatchGoal.trim() } : {}),
      })
      if (response?.snapshot) setSnapshot(response.snapshot as TeamSnapshot)
      notifyTeamBoardChanged()
      setArchiveOpen(false)
      setNextBatchName('')
      setNextBatchGoal('')
      toast.success(t('team:archived'))
    } catch (caught) {
      toast.error(t('team:archiveFailed'), { description: String((caught as Error)?.message || caught) })
    } finally {
      setArchiving(false)
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
      <header className="team-head shrink-0">
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
          <Users className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
          <span className="shrink-0 text-[12.5px] font-semibold leading-4">{t('team:title')}</span>
          <span className="team-project min-w-0 truncate" title={workspaceId}>{projectName}</span>
          <div className="team-head-actions ml-auto flex shrink-0 items-center gap-0.5">
            {snapshot?.exists ? (
              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                aria-label={t('team:archiveBatch')}
                title={t('team:archiveBatch')}
                className="team-icon-btn"
              >
                <CheckCheck className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refresh({ silent: false })}
              aria-label={t('team:refresh')}
              title={t('team:refresh')}
              className="team-icon-btn"
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
              className="team-icon-btn"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {snapshot?.exists ? (
          <div className="team-batch">
            <ProgressRing accepted={progress.accepted} total={progress.total} label={t('team:progressHint')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-xs font-semibold" title={snapshot.batch}>
                  {snapshot.batch || t('team:batchFallback')}
                </span>
                <span className="team-chip shrink-0 tabular-nums" data-tone="info">
                  {t('team:progress', { accepted: progress.accepted, total: progress.total })}
                </span>
                {progress.blocked > 0 ? (
                  <span className="team-chip shrink-0" data-tone="danger">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {t('team:blocked', { count: progress.blocked })}
                  </span>
                ) : null}
                {approvalCount > 0 ? (
                  <span className="team-chip shrink-0" data-tone="warning" title={t('team:approvalHint')}>
                    {t('team:approvalCount', { count: approvalCount })}
                  </span>
                ) : null}
              </div>
              <div className="truncate text-2xs leading-4 text-foreground-tertiary" title={snapshot.goal}>
                {snapshot.goal || t('team:goalFallback')}
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mx-3 mb-1.5 flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--danger-semantic,#dc2626)_8%,transparent)] px-2 py-1 text-2xs text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={error}>{error}</span>
            <button type="button" onClick={() => void refresh({ silent: false })} className="shrink-0 underline">
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
          <div className="shrink-0 px-3 pb-1 pt-1.5">
            <div className="flex items-center gap-1.5 pb-1">
              <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-tertiary">{t('team:team')}</span>
              {snapshot?.roleScope === 'session' ? (
                <span className="team-chip shrink-0" data-tone="info" title={t('team:subagentSection.scopeSessionHint')}>
                  {t('team:subagentSection.sessionScopedBadge')}
                </span>
              ) : null}
              <span className="truncate text-2xs text-foreground-tertiary">
                {runningRoles.length > 0 ? t('team:running', { count: runningRoles.length }) : t('team:roleSessionHint')}
              </span>
            </div>
            {/* 五个角色平均分一整行：不再挤成一排定宽 chip */}
            <div className="team-roles">
              {roles.map((binding) => {
                const roleActiveRuns = activeRunsForRole(binding.role)
                const roleRun =
                  roleActiveRuns.find((run) => isSessionRunning(sessionRuntimeRunning, run.sessionFile))
                  ?? roleActiveRuns[0]
                const roleLive =
                  isSessionRunning(sessionRuntimeRunning, snapshot?.sessions[binding.role]?.sessionFile)
                  || roleActiveRuns.length > 0
                return (
                  <RoleChip
                    key={binding.role}
                    binding={binding}
                    running={roleLive}
                    busy={roleBusy === binding.role}
                    activeTaskId={roleRun?.taskId}
                    activeRunsCount={roleActiveRuns.length}
                    count={tasks.filter((task) => task.role === binding.role && task.status !== '已验收').length}
                    onClick={() => handleRoleChipClick(binding)}
                  />
                )
              })}
            </div>
            {roleMenuRole ? (() => {
              const roleBindingObj = roles.find((b) => b.role === roleMenuRole)
              const list = activeRunsForRole(roleMenuRole)
              if (list.length < 2) return null
              return (
                <div className="team-role-picker">
                  <div className="flex items-center gap-1.5 pb-1 text-[10px] font-medium text-foreground-secondary">
                    <span>{t('team:subagentSection.rolePickerTitle', { role: roleLabel(roleMenuRole, t) })}</span>
                    {roleBindingObj?.directEnabled ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRoleMenuRole(null)
                          void openRole(roleBindingObj)
                        }}
                        className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                      >
                        {t('team:subagentSection.openDirectChat')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRoleMenuRole(null)}
                      aria-label={t('team:close')}
                      className="rounded p-0.5 text-foreground-tertiary hover:bg-[var(--bg-hover)] hover:text-foreground"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {list.map((run) => {
                      const tel = telemetryByRunId.get(run.id)
                      const workerBadge = formatWorkerBadge(roleLabel(run.role, t), tel?.slot)
                      const title = taskTitleById.get(run.taskId)
                      return (
                        <div key={run.id} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10.5px] hover:bg-[var(--bg-hover)]">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse" />
                          <span className="shrink-0 font-medium text-foreground">{workerBadge}</span>
                          <span className="shrink-0 font-mono text-[9.5px] text-foreground-tertiary">{run.taskId}</span>
                          <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                            {tel?.currentAction || title || ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => void splitRunSession(run)}
                            title={t('team:subagentSection.splitWatch')}
                            className="team-subagent-icon-btn shrink-0"
                          >
                            <Columns2 className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openRunSession(run)}
                            className="team-subagent-enter shrink-0"
                          >
                            {t('team:subagentSection.enter')}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })() : null}
          </div>

          <SubagentSection
            runs={runs}
            tasks={tasks}
            taskTitleById={taskTitleById}
            telemetryByRunId={telemetryByRunId}
            delegateRuns={delegateRuns}
            treeSubagents={treeSubagents}
            runtimeRunning={sessionRuntimeRunning}
            historySessionFile={historySessionFile}
            openingKey={openingSubagentKey}
            resumingRunId={resumingRunId}
            nowMs={nowMs}
            showRecent={showRecentSubagents}
            onToggleRecent={() => setShowRecentSubagents((prev) => !prev)}
            onOpenTeamRun={(run) => void openRunSession(run)}
            onSplitTeamRun={(run) => void splitRunSession(run)}
            onResumeTeamRun={(run) => void resumeRun(run)}
            onInterveneTeamRun={(task, text) => interveneRun(task, text)}
            onAbortTeamRun={(run) => void abortRun(run)}
            onOpenDelegate={(run) => void openDelegateRun(run)}
            onOpenTree={(child) => void openTreeChild(child)}
          />

          <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5">
            <span className="text-xs font-semibold">{t('team:tasks')}</span>
            <span className="team-count">{tasks.length}</span>
            <div className="ml-auto flex items-center gap-1">
              {view === 'lanes' && lanes.canScroll ? (
                <div className="team-seg">
                  <button
                    type="button"
                    onClick={() => lanes.scrollByStep(-1)}
                    aria-label={t('team:prevLane')}
                    title={t('team:prevLane')}
                    className="team-seg-btn px-1"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => lanes.scrollByStep(1)}
                    aria-label={t('team:nextLane')}
                    title={t('team:nextLane')}
                    className="team-seg-btn px-1"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
              <div className="team-seg">
                <button
                  type="button"
                  onClick={() => setView('lanes')}
                  data-active={view === 'lanes'}
                  className="team-seg-btn"
                >
                  {t('team:lanes')}
                </button>
                <button
                  type="button"
                  onClick={() => setView('people')}
                  data-active={view === 'people'}
                  className="team-seg-btn"
                >
                  {t('team:people')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                aria-label={t('team:taskCard')}
                title={t('team:taskCard')}
                className="team-icon-btn"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {view === 'lanes' ? (
            <div className="team-lanes-wrap">
              <div
                ref={lanes.ref}
                className="team-lanes team-scroll"
                data-dragging={lanes.dragging}
                data-scrollable={lanes.canScroll}
              >
                {TEAM_STATUSES.map((status) => {
                  const items = byStatus.get(status) ?? []
                  return (
                    <section
                      key={status}
                      data-lane
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
                        <span className="team-lane-dot" style={{ background: STATUS_COLORS[status] }} />
                        <span className="truncate">{statusLabel(status, t)}</span>
                        <span className="team-lane-count">{items.length}</span>
                      </div>
                      <div className="team-lane-cards team-scroll">
                        {items.map((task) => {
                          const run = latestRun(task, runs)
                          const viewingRun = Boolean(run && historySessionFile && sessionFilesEqual(run.sessionFile, historySessionFile))
                          const telemetry = run ? telemetryByRunId.get(run.id) : undefined
                          return (
                            <TaskCard
                              key={task.id}
                              task={task}
                              run={run}
                              telemetry={telemetry}
                              nowMs={nowMs}
                              stage={deriveTeamStage({ task, run })}
                              running={isSessionRunning(sessionRuntimeRunning, run?.sessionFile)}
                              viewingRun={viewingRun}
                              resuming={Boolean(run && resumingRunId === run.id)}
                              dragging={draggingId === task.id}
                              onOpen={() => openTask(task)}
                              onOpenRun={run ? () => void openRunSession(run) : undefined}
                              onSplitRun={run ? () => void splitRunSession(run) : undefined}
                              onResumeRun={run ? () => void resumeRun(run) : undefined}
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
            </div>
          ) : (
            <PeopleView
              tasks={tasks}
              roles={roles}
              runs={runs}
              telemetryByRunId={telemetryByRunId}
              historySessionFile={historySessionFile}
              onOpen={openTask}
              onOpenRun={(run) => void openRunSession(run)}
              onSplitRun={(run) => void splitRunSession(run)}
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
          merging={mergingTaskId === selectedTask.id}
          reviewing={reviewingTaskId === selectedTask.id}
          initialPending={pendingStatus}
          onClose={() => {
            setSelectedTaskId(null)
            setPendingStatus(null)
          }}
          onStatus={(to, options) => applyStatus(selectedTask, to, options)}
          onDispatch={() => void dispatchTask(selectedTask)}
          onDispatchReview={() => void dispatchReviewTask(selectedTask)}
          onMerge={() => void mergeTask(selectedTask)}
          onCopyPrompt={() => void copyPrompt(selectedTask)}
          onOpenRole={() => {
            if (selectedBinding) void openRole(selectedBinding)
          }}
          onOpenSession={(run) => void openRunSession(run)}
          onSettleRun={(run) => void settleRun(run)}
          onApproval={(decision, note) => resolveApproval(selectedTask, decision, note)}
          onIntervene={(text) => interveneRun(selectedTask, text)}
          onAbort={(run) => void abortRun(run)}
          onAppendMemory={(kind, text) => appendMemory(selectedTask, kind, text)}
        />
      ) : null}

      {archiveOpen ? (
        <div className="team-overlay" role="dialog" aria-modal="true" aria-label={t('team:archiveTitle')}>
          <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2.5 py-2">
            <span className="text-xs font-medium">{t('team:archiveTitle')}</span>
          </div>
          <div className="team-sheet-scroll team-scroll">
            <p className="text-2xs leading-relaxed text-foreground-secondary">{t('team:archiveDesc')}</p>
            <label className="mt-2 block text-2xs text-foreground-secondary">
              {t('team:nextBatchLabel')}
              <input
                value={nextBatchName}
                onChange={(event) => setNextBatchName(event.target.value)}
                maxLength={80}
                placeholder="下一批次"
                className="team-sheet-input mt-1"
              />
            </label>
            <label className="mt-2 block text-2xs text-foreground-secondary">
              {t('team:nextGoalLabel')}
              <textarea
                value={nextBatchGoal}
                onChange={(event) => setNextBatchGoal(event.target.value)}
                rows={2}
                maxLength={300}
                className="team-sheet-input mt-1 resize-y"
              />
            </label>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/40 px-2.5 py-2">
            <button
              type="button"
              onClick={() => setArchiveOpen(false)}
              className="rounded px-2 py-1 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)]"
            >
              {t('team:cancel')}
            </button>
            <button
              type="button"
              disabled={archiving}
              onClick={() => void archiveBatch()}
              className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground disabled:opacity-40"
            >
              {archiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              {t('team:archiveConfirm')}
            </button>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <TeamSettingsSheet
          workspaceId={workspaceId}
          sessionFile={snapshot?.sessionFile || historySessionFile || undefined}
          roles={snapshot?.roles ?? []}
          projectRoles={snapshot?.projectRoles}
          roleScope={snapshot?.roleScope}
          defaultModel={snapshot?.globalDefaultModel || ''}
          defaultModelOverride={snapshot?.defaultModelOverride || ''}
          maxConcurrency={snapshot?.maxConcurrency ?? 3}
          autoReview={snapshot?.autoReview === true}
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
          defaultRole={roles[1]?.role || 'Builder'}
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
  activeTaskId,
  activeRunsCount,
  count,
  onClick,
}: {
  binding: TeamRoleBinding
  running: boolean
  busy: boolean
  activeTaskId?: string
  activeRunsCount: number
  count: number
  onClick: () => void
}) {
  const { t } = useTranslation()
  const accent = roleColor(binding.role)
  const title = activeTaskId
    ? t('team:subagentSection.roleRunningHint', { role: roleLabel(binding.role, t), taskId: activeTaskId })
    : `${roleLabel(binding.role, t)} · ${binding.model || t('team:unbound')}${binding.effort ? ` · ${binding.effort}` : ''}`
  const badgeCount = activeRunsCount > 0 ? activeRunsCount : count
  return (
    <button
      type="button"
      onClick={onClick}
      data-role={binding.role}
      data-running={running}
      data-disabled={!binding.enabled}
      className="team-role-chip"
      style={{ '--team-role': accent } as CSSProperties}
      title={title}
    >
      <span className="team-role-face">
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
            className="team-role-dot absolute -bottom-0.5 right-0.5"
            data-live={running}
            style={{ background: running ? accent : 'color-mix(in srgb, var(--text-secondary) 35%, transparent)' }}
          />
        )}
        {badgeCount > 0 ? (
          <span
            className="team-role-count"
            data-active={activeRunsCount > 0 ? 'true' : undefined}
            title={activeRunsCount > 0 ? t('team:subagentSection.runningCount', { count: activeRunsCount }) : t('team:tasks')}
          >
            {badgeCount}
          </span>
        ) : null}
      </span>
      <span className="block w-full min-w-0 truncate text-center text-[11px] font-medium leading-[15px] text-foreground">
        {roleLabel(binding.role, t)}
      </span>
      <span className="block w-full min-w-0 truncate text-center text-[9.5px] leading-[12px] text-foreground-tertiary">
        {binding.model ? shortModel(binding.model) : t('team:unbound')}
      </span>
    </button>
  )
}

function SubagentSection({
  runs,
  tasks,
  taskTitleById,
  telemetryByRunId,
  delegateRuns,
  treeSubagents,
  runtimeRunning,
  historySessionFile,
  openingKey,
  resumingRunId,
  nowMs,
  showRecent,
  onToggleRecent,
  onOpenTeamRun,
  onSplitTeamRun,
  onResumeTeamRun,
  onInterveneTeamRun,
  onAbortTeamRun,
  onOpenDelegate,
  onOpenTree,
}: {
  runs: TeamRun[]
  tasks: TeamTask[]
  taskTitleById: Map<string, string>
  telemetryByRunId: Map<string, SubagentTelemetry>
  delegateRuns: DelegateRun[]
  treeSubagents: SubagentSessionChild[]
  runtimeRunning: Record<string, boolean> | null | undefined
  historySessionFile: string
  openingKey: string
  resumingRunId: string
  nowMs: number
  showRecent: boolean
  onToggleRecent: () => void
  onOpenTeamRun: (run: TeamRun) => void
  onSplitTeamRun: (run: TeamRun) => void
  onResumeTeamRun: (run: TeamRun) => void
  onInterveneTeamRun: (task: TeamTask, text: string) => Promise<boolean>
  onAbortTeamRun: (run: TeamRun) => void
  onOpenDelegate: (run: DelegateRun) => void
  onOpenTree: (child: SubagentSessionChild) => void
}) {
  const { t } = useTranslation()
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [interveneRunId, setInterveneRunId] = useState<string | null>(null)
  const [interveneText, setInterveneText] = useState('')
  const [interveneBusy, setInterveneBusy] = useState(false)

  const taskById = new Map<string, TeamTask>()
  for (const task of tasks) taskById.set(task.id, task)

  const activeTeamRuns = [...runs]
    .reverse()
    .filter((run) => run.status === 'starting' || run.status === 'running')
  const recentTeamRuns = [...runs]
    .reverse()
    .filter((run) => run.status !== 'starting' && run.status !== 'running')
    .slice(0, 6)

  const activeDelegates = delegateRuns.filter((run) => run.state === 'running')
  const recentDelegates = delegateRuns.filter((run) => run.state !== 'running').slice(0, 4)

  const activeTrees = treeSubagents.filter(
    (child) => (child.state === 'running' || child.state === 'pending') && !!child.sessionFile,
  )

  const activeCount = activeTeamRuns.length + activeDelegates.length + activeTrees.length
  const recentCount = recentTeamRuns.length + recentDelegates.length
  if (activeCount === 0 && recentCount === 0) return null

  const visibleRecentTeam = showRecent
    ? recentTeamRuns
    : activeCount === 0
      ? recentTeamRuns.slice(0, 2)
      : []
  const visibleRecentDelegates = showRecent
    ? recentDelegates
    : activeCount === 0 && visibleRecentTeam.length < 2
      ? recentDelegates.slice(0, 2 - visibleRecentTeam.length)
      : []
  const hiddenRecentCount = recentCount - visibleRecentTeam.length - visibleRecentDelegates.length

  const teamStatusLabel = (run: TeamRun, live: boolean) => {
    if (run.staleAt) return t('team:stages.stale')
    if (live) return t('team:runRunning')
    switch (run.status) {
      case 'starting':
        return t('team:runStarting')
      case 'running':
        return t('team:runRunning')
      case 'done':
        return t('team:runDone')
      case 'failed':
        return t('team:runFailed')
      case 'cancelled':
        return t('team:runCancelled')
    }
  }

  return (
    <section className="team-subagents shrink-0 px-3 pb-1.5 pt-1" aria-label={t('team:subagentSection.title')}>
      <div className="flex items-center gap-1.5 pb-1">
        <Bot className="h-3 w-3 shrink-0 text-foreground-tertiary" />
        <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-tertiary">
          {t('team:subagentSection.title')}
        </span>
        {activeCount > 0 ? (
          <span className="team-chip" data-tone="info">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            {t('team:subagentSection.runningCount', { count: activeCount })}
          </span>
        ) : null}
        {recentCount > 0 && (hiddenRecentCount > 0 || showRecent) ? (
          <button
            type="button"
            onClick={onToggleRecent}
            className="ml-auto inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-foreground-tertiary hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <span>
              {showRecent
                ? t('team:subagentSection.hideRecent')
                : t('team:subagentSection.recentToggle', { count: recentCount })}
            </span>
            <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', !showRecent && '-rotate-90')} />
          </button>
        ) : null}
      </div>

      <div className="team-subagent-list team-scroll">
        {activeTeamRuns.map((run) => renderTeamRow(run, true))}
        {activeDelegates.map((run) => renderDelegateRow(run))}
        {activeTrees.map((child) => renderTreeRow(child))}
        {visibleRecentTeam.map((run) => renderTeamRow(run, false))}
        {visibleRecentDelegates.map((run) => renderDelegateRow(run))}
      </div>
    </section>
  )

  function renderTeamRow(run: TeamRun, isActive: boolean) {
    const live = isActive && isSessionRunning(runtimeRunning, run.sessionFile)
    const viewing = Boolean(historySessionFile && sessionFilesEqual(run.sessionFile, historySessionFile))
    const opening = openingKey === run.id || openingKey === `split:${run.id}`
    const resuming = resumingRunId === run.id
    const expanded = Boolean(expandedIds[run.id])
    const taskTitle = taskTitleById.get(run.taskId)
    const taskObj = taskById.get(run.taskId)
    const telemetry = telemetryByRunId.get(run.id)
    const workerBadge = formatWorkerBadge(roleLabel(run.role, t), telemetry?.slot)
    const elapsed = formatRunElapsed(run.startedAt, run.endedAt, nowMs)
    const modelShort = telemetry?.model ? shortModel(telemetry.model) : ''
    const canResume =
      run.status === 'failed'
      || run.status === 'cancelled'
      || Boolean(run.staleAt)
      || Boolean(telemetry?.isSilentWarning)
    const silentText = telemetry?.isSilentWarning
      ? t('team:subagentSection.silentWarning', {
          elapsed: formatRunElapsed(telemetry.lastActivityAt, undefined, nowMs) || '90s+',
        })
      : ''
    const summaryParts = [
      teamStatusLabel(run, live),
      modelShort,
      elapsed,
      telemetry && telemetry.toolCount > 0 ? t('team:subagentSection.stepsCount', { count: telemetry.toolCount }) : '',
      telemetry && telemetry.fileCount > 0 ? t('team:subagentSection.filesCount', { count: telemetry.fileCount }) : '',
      run.branch || '',
    ].filter(Boolean)

    return (
      <div
        key={run.id}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!opening) onOpenTeamRun(run)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (!opening) onOpenTeamRun(run)
        }}
        data-active={isActive}
        data-viewing={viewing}
        className="team-subagent-card cursor-pointer text-left"
        title={`${workerBadge} · ${run.taskId}${taskTitle ? ` · ${taskTitle}` : ''}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="team-avatar !h-6 !w-6" style={{ '--team-role': roleColor(run.role) } as CSSProperties}>
            <img src={roleAvatar(run.role)} alt="" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  telemetry?.isSilentWarning
                    ? 'bg-amber-500'
                    : live
                      ? 'animate-pulse bg-primary'
                      : run.staleAt
                        ? 'bg-amber-500'
                        : isActive
                          ? 'bg-amber-500'
                          : run.status === 'failed' || run.status === 'cancelled'
                            ? 'bg-destructive'
                            : 'bg-emerald-500',
                )}
              />
              <span className="shrink-0 text-[11px] font-semibold" style={{ color: roleColor(run.role) }}>
                {workerBadge}
              </span>
              {run.taskId ? (
                <span className="shrink-0 font-mono text-[9.5px] text-foreground-tertiary">{run.taskId}</span>
              ) : null}
              {taskTitle ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground">{taskTitle}</span>
              ) : null}
            </div>
            {(telemetry?.currentAction || silentText) ? (
              <div className="flex items-center gap-1 truncate text-[10px] leading-[14px]">
                {silentText ? (
                  <span className="shrink-0 font-medium text-amber-600 dark:text-amber-400">{silentText}</span>
                ) : null}
                {telemetry?.currentAction ? (
                  <span className="min-w-0 truncate text-foreground-secondary">{telemetry.currentAction}</span>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 truncate text-[9.5px] leading-[13px] text-foreground-tertiary">
              <span className="truncate">{summaryParts.join(' · ')}</span>
              {telemetry && telemetry.errorCount > 0 ? (
                <span className="shrink-0 font-medium text-destructive">
                  {t('team:subagentSection.errorsCount', { count: telemetry.errorCount })}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setExpandedIds((prev) => ({ ...prev, [run.id]: !prev[run.id] }))
              }}
              data-active={expanded ? 'true' : undefined}
              title={expanded ? t('team:subagentSection.collapseSteps') : t('team:subagentSection.expandSteps')}
              className="team-subagent-icon-btn"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                if (!opening) onSplitTeamRun(run)
              }}
              title={t('team:subagentSection.splitWatch')}
              aria-label={t('team:subagentSection.splitWatch')}
              className="team-subagent-icon-btn"
            >
              <Columns2 className="h-3 w-3" />
            </button>
            {isActive && taskObj ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setInterveneRunId((cur) => (cur === run.id ? null : run.id))
                  setInterveneText('')
                }}
                data-active={interveneRunId === run.id ? 'true' : undefined}
                title={t('team:subagentSection.steer')}
                aria-label={t('team:subagentSection.steer')}
                className="team-subagent-icon-btn"
              >
                <MessageSquare className="h-3 w-3" />
              </button>
            ) : null}
            {canResume ? (
              <button
                type="button"
                disabled={resuming}
                onClick={(event) => {
                  event.stopPropagation()
                  onResumeTeamRun(run)
                }}
                title={t('team:subagentSection.resume')}
                aria-label={t('team:subagentSection.resume')}
                className="team-subagent-icon-btn text-amber-600 dark:text-amber-400"
              >
                {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              </button>
            ) : null}
            <span className="team-subagent-enter">
              {opening ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : viewing ? (
                t('team:subagentSection.viewing')
              ) : (
                <>
                  {t('team:subagentSection.enter')}
                  <ChevronRight className="h-2.5 w-2.5" />
                </>
              )}
            </span>
            {isActive ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onAbortTeamRun(run)
                }}
                title={t('team:abortRun')}
                aria-label={t('team:abortRun')}
                className="team-subagent-icon-btn hover:text-destructive"
              >
                <Square className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </div>
        </div>

        {expanded ? (
          <div className="team-subagent-steps" onClick={(event) => event.stopPropagation()}>
            {telemetry && telemetry.recentSteps.length > 0 ? (
              telemetry.recentSteps.map((step) => (
                <div key={step.id} className="team-subagent-step">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      step.isError ? 'bg-destructive' : step.isRunning ? 'animate-pulse bg-primary' : 'bg-emerald-500/80',
                    )}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', step.isError && 'text-destructive')}>
                    {step.text}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-[10px] text-foreground-tertiary">{t('team:subagentSection.noLiveSteps')}</div>
            )}
          </div>
        ) : null}

        {interveneRunId === run.id && taskObj ? (
          <div className="flex items-center gap-1 pl-7" onClick={(event) => event.stopPropagation()}>
            <input
              value={interveneText}
              onChange={(event) => setInterveneText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && interveneText.trim() && !interveneBusy) {
                  event.preventDefault()
                  setInterveneBusy(true)
                  void onInterveneTeamRun(taskObj, interveneText.trim()).then((ok) => {
                    if (ok) {
                      setInterveneText('')
                      setInterveneRunId(null)
                    }
                  }).finally(() => setInterveneBusy(false))
                }
              }}
              maxLength={1500}
              placeholder={t('team:subagentSection.steerPlaceholder')}
              className="team-sheet-input min-w-0 flex-1 !py-0.5 text-[11px]"
            />
            <button
              type="button"
              disabled={!interveneText.trim() || interveneBusy}
              onClick={() => {
                if (!interveneText.trim() || interveneBusy) return
                setInterveneBusy(true)
                void onInterveneTeamRun(taskObj, interveneText.trim()).then((ok) => {
                  if (ok) {
                    setInterveneText('')
                    setInterveneRunId(null)
                  }
                }).finally(() => setInterveneBusy(false))
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground disabled:opacity-40"
            >
              {interveneBusy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Send className="h-2.5 w-2.5" />}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  function renderDelegateRow(run: DelegateRun) {
    const isActive = run.state === 'running'
    const opening = openingKey === `delegate:${run.runId}`
    const elapsed = formatRunElapsed(run.startedAt, run.durationMs ? run.startedAt + run.durationMs : undefined, nowMs)
    const statusText =
      run.state === 'running'
        ? t('team:delegate.stateRunning')
        : run.state === 'failed'
          ? t('team:delegate.stateFailed')
          : t('team:delegate.stateDone')
    const metaParts = [statusText, elapsed, run.preview || ''].filter(Boolean)

    return (
      <div
        key={`del:${run.runId}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!opening) onOpenDelegate(run)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (!opening) onOpenDelegate(run)
        }}
        data-active={isActive}
        className="team-subagent-card cursor-pointer text-left"
        title={run.task || run.runId}
      >
        <div className="flex items-center gap-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-[var(--bg-hover)] text-foreground-secondary">
            {isActive ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : <Bot className="h-3 w-3" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-[11px] font-medium text-foreground">{run.agent}</span>
              <span className="shrink-0 font-mono text-[9.5px] text-foreground-tertiary">
                {run.runId.replace(/^del_/, '')}
              </span>
              {run.task ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground-secondary">{run.task}</span>
              ) : null}
            </div>
            {metaParts.length > 0 ? (
              <div className="truncate text-[9.5px] leading-[13px] text-foreground-tertiary">
                {metaParts.join(' · ')}
              </div>
            ) : null}
          </div>
          <span className="team-subagent-enter">
            {opening ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <>
                {t('team:subagentSection.enter')}
                <ChevronRight className="h-2.5 w-2.5" />
              </>
            )}
          </span>
        </div>
      </div>
    )
  }

  function renderTreeRow(child: SubagentSessionChild) {
    const opening = openingKey === `tree:${child.key}`
    const viewing = Boolean(historySessionFile && child.sessionFile && sessionFilesEqual(child.sessionFile, historySessionFile))
    return (
      <div
        key={`tree:${child.key}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!opening) onOpenTree(child)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (!opening) onOpenTree(child)
        }}
        data-active
        data-viewing={viewing}
        className="team-subagent-card cursor-pointer text-left"
        title={child.task || child.agent}
      >
        <div className="flex items-center gap-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-[var(--bg-hover)] text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-[11px] font-medium text-foreground">{child.agent}</span>
              {child.task ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground-secondary">{child.task}</span>
              ) : null}
            </div>
            <div className="truncate text-[9.5px] leading-[13px] text-foreground-tertiary">
              {t('team:runRunning')}
            </div>
          </div>
          <span className="team-subagent-enter">
            {opening ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : viewing ? (
              t('team:subagentSection.viewing')
            ) : (
              <>
                {t('team:subagentSection.enter')}
                <ChevronRight className="h-2.5 w-2.5" />
              </>
            )}
          </span>
        </div>
      </div>
    )
  }
}

function TaskCard({
  task,
  run,
  telemetry,
  nowMs,
  stage,
  running,
  viewingRun,
  resuming,
  dragging,
  onOpen,
  onOpenRun,
  onSplitRun,
  onResumeRun,
  onDragStart,
  onDragEnd,
}: {
  task: TeamTask
  run: TeamRun | undefined
  telemetry?: SubagentTelemetry
  nowMs: number
  stage: TeamStage
  running: boolean
  viewingRun?: boolean
  resuming?: boolean
  dragging: boolean
  onOpen: () => void
  onOpenRun?: () => void
  onSplitRun?: () => void
  onResumeRun?: () => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}) {
  const { t } = useTranslation()
  const accepted = task.acceptance.filter((item) => item.done).length
  const runActive = run?.status === 'starting' || run?.status === 'running'
  const showStage = CARD_STAGES.has(stage)
  const workerBadge = run ? formatWorkerBadge(roleLabel(run.role, t), telemetry?.slot) : ''
  const modelShort = telemetry?.model ? shortModel(telemetry.model) : ''
  const elapsed = run ? formatRunElapsed(run.startedAt, run.endedAt, nowMs) : ''
  const canResume = Boolean(
    run && onResumeRun && (run.status === 'failed' || run.status === 'cancelled' || run.staleAt || telemetry?.isSilentWarning),
  )
  const silentText = telemetry?.isSilentWarning
    ? t('team:subagentSection.silentWarning', {
        elapsed: formatRunElapsed(telemetry.lastActivityAt, undefined, nowMs) || '90s+',
      })
    : ''

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="team-card cursor-pointer"
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
            data-live={running && !telemetry?.isSilentWarning}
            style={{ background: telemetry?.isSilentWarning || !running ? 'var(--warning-semantic)' : 'var(--primary)' }}
            title={silentText || (running ? t('team:runRunning') : t('team:staleRun'))}
          />
        ) : null}
      </div>
      <div className="team-card-title mt-0.5">{task.title}</div>
      <div className="team-card-meta">
        <span className="truncate" style={{ color: roleColor(task.role) }}>{roleLabel(task.role, t)}</span>
        {task.branch ? (
          <span className="inline-flex items-center gap-0.5 truncate font-mono text-[9.5px] text-foreground-tertiary" title={task.branch}>
            <GitBranch className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{task.branch}</span>
          </span>
        ) : null}
        {task.reworkCount > 0 ? (
          <span className="team-chip" data-tone="warning">
            {t('team:reworkBadge', { count: task.reworkCount })}
          </span>
        ) : null}
        {task.blockType ? (
          <span className="team-chip" data-tone="danger">{task.blockType}</span>
        ) : null}
        {task.acceptance.length ? (
          <span
            className="ml-auto shrink-0 tabular-nums"
            title={t('team:acceptanceCountHint', { done: accepted, total: task.acceptance.length })}
          >
            {t('team:acceptanceCount', { done: accepted, total: task.acceptance.length })}
          </span>
        ) : null}
      </div>
      {run && onOpenRun ? (
        <div className="team-card-worker" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <span className="team-avatar !h-4 !w-4" style={{ '--team-role': roleColor(run.role) } as CSSProperties}>
              <img src={roleAvatar(run.role)} alt="" />
            </span>
            <span className="shrink-0 text-[10px] font-semibold" style={{ color: roleColor(run.role) }}>
              {workerBadge}
            </span>
            {modelShort ? (
              <span className="min-w-0 flex-1 truncate text-[9.5px] text-foreground-tertiary">{modelShort}</span>
            ) : (
              <span className="flex-1" />
            )}
            {elapsed ? (
              <span className="shrink-0 font-mono text-[9.5px] text-foreground-tertiary">{elapsed}</span>
            ) : null}
          </div>
          {(silentText || telemetry?.currentAction) ? (
            <div className="mt-0.5 flex items-center gap-1 truncate text-[9.5px] leading-[13px]">
              {silentText ? (
                <span className="shrink-0 font-medium text-amber-600 dark:text-amber-400">{silentText}</span>
              ) : null}
              {telemetry?.currentAction ? (
                <span className="min-w-0 truncate text-foreground-secondary">{telemetry.currentAction}</span>
              ) : null}
            </div>
          ) : null}
          {telemetry && (telemetry.toolCount > 0 || telemetry.fileCount > 0 || telemetry.errorCount > 0) ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] leading-[12px] text-foreground-tertiary">
              {telemetry.toolCount > 0 ? <span>{t('team:subagentSection.stepsCount', { count: telemetry.toolCount })}</span> : null}
              {telemetry.fileCount > 0 ? <span>{t('team:subagentSection.filesCount', { count: telemetry.fileCount })}</span> : null}
              {telemetry.errorCount > 0 ? (
                <span className="font-medium text-destructive">{t('team:subagentSection.errorsCount', { count: telemetry.errorCount })}</span>
              ) : null}
            </div>
          ) : null}
          <div className="team-card-actions">
            <button
              type="button"
              onClick={onOpenRun}
              data-viewing={viewingRun ? 'true' : undefined}
              className="team-card-run-btn !mt-0 flex-1"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  telemetry?.isSilentWarning
                    ? 'bg-amber-500'
                    : runActive && running
                      ? 'animate-pulse bg-primary'
                      : runActive
                        ? 'bg-amber-500'
                        : run.status === 'failed' || run.status === 'cancelled'
                          ? 'bg-destructive'
                          : 'bg-emerald-500',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {viewingRun
                  ? t('team:subagentSection.viewing')
                  : runActive
                    ? t('team:subagentSection.cardOpenLive')
                    : t('team:subagentSection.cardOpenRecent')}
              </span>
              <ChevronRight className="h-2.5 w-2.5 shrink-0 opacity-75" />
            </button>
            {onSplitRun ? (
              <button
                type="button"
                onClick={onSplitRun}
                title={t('team:subagentSection.splitWatch')}
                aria-label={t('team:subagentSection.splitWatch')}
                className="team-subagent-icon-btn shrink-0 border border-border/50"
              >
                <Columns2 className="h-3 w-3" />
              </button>
            ) : null}
            {canResume && onResumeRun ? (
              <button
                type="button"
                disabled={resuming}
                onClick={onResumeRun}
                title={t('team:subagentSection.resume')}
                aria-label={t('team:subagentSection.resume')}
                className="team-subagent-icon-btn shrink-0 border border-amber-500/40 text-amber-600 dark:text-amber-400"
              >
                {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PeopleView({
  tasks,
  roles,
  runs,
  telemetryByRunId,
  historySessionFile,
  runtimeRunning,
  onOpen,
  onOpenRun,
  onSplitRun,
}: {
  tasks: TeamTask[]
  roles: TeamRoleBinding[]
  runs: TeamRun[]
  telemetryByRunId: Map<string, SubagentTelemetry>
  historySessionFile: string
  runtimeRunning: Record<string, boolean> | null | undefined
  onOpen: (task: TeamTask) => void
  onOpenRun: (run: TeamRun) => void
  onSplitRun: (run: TeamRun) => void
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
          <div className="flex items-center gap-1.5 px-1 pb-1 pt-0.5">
            <span className="team-avatar !h-5 !w-5" style={{ '--team-role': roleColor(group.role) } as CSSProperties}>
              <img src={roleAvatar(group.role)} alt="" />
            </span>
            <span className="text-xs font-semibold">{roleLabel(group.role, t)}</span>
            <span className="team-count">{group.items.length}</span>
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
            group.items.map((task) => {
              const run = latestRun(task, runs)
              const telemetry = run ? telemetryByRunId.get(run.id) : undefined
              const viewingRun = Boolean(run && historySessionFile && sessionFilesEqual(run.sessionFile, historySessionFile))
              const workerBadge = run ? formatWorkerBadge(roleLabel(run.role, t), telemetry?.slot) : ''
              return (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(task)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onOpen(task)
                  }}
                  className="team-person-card cursor-pointer"
                  style={{ '--card-accent': STATUS_COLORS[task.status] } as CSSProperties}
                  title={task.note || task.title}
                >
                  <span className="team-person-dot" style={{ background: STATUS_COLORS[task.status] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xs font-medium text-foreground">{task.title}</span>
                    <span className="block truncate font-mono text-[9.5px] leading-[12px]" style={{ color: STATUS_COLORS[task.status] }}>
                      {task.id} · {statusLabel(task.status, t)}{workerBadge ? ` · ${workerBadge}` : ''}
                    </span>
                    {telemetry?.currentAction ? (
                      <span className="block truncate text-[9.5px] leading-[12px] text-foreground-tertiary">
                        {telemetry.currentAction}
                      </span>
                    ) : null}
                  </span>
                  {run ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onSplitRun(run)
                        }}
                        title={t('team:subagentSection.splitWatch')}
                        className="team-subagent-icon-btn"
                      >
                        <Columns2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenRun(run)
                        }}
                        className="team-subagent-enter shrink-0"
                      >
                        {viewingRun ? t('team:subagentSection.viewing') : t('team:subagentSection.enter')}
                      </button>
                    </div>
                  ) : null}
                  {task.acceptance.length ? (
                    <span
                      className="shrink-0 text-[9.5px] tabular-nums text-foreground-tertiary"
                      title={t('team:acceptanceCountHint', { done: task.acceptance.filter((item) => item.done).length, total: task.acceptance.length })}
                    >
                      {t('team:acceptanceCount', { done: task.acceptance.filter((item) => item.done).length, total: task.acceptance.length })}
                    </span>
                  ) : null}
                </div>
              )
            })
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
