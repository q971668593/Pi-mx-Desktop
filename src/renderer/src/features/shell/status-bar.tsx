import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Cpu, RefreshCw } from '@renderer/components/icons'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useVisibleInterval } from '@renderer/hooks/use-visible-interval'
import { countAttention, listAttentionSessions, type SessionAttention } from '@renderer/lib/session-attention'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { loadWorkspaceSessionList } from '@renderer/lib/refresh-workspace-session-lists'
import { workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import { useUIStore } from '@renderer/stores/ui-store'
import { SessionAttentionDot } from '@renderer/features/workspace/session-attention-dot'
import { BranchStatusTrigger } from '@renderer/features/git/branch-status'
import { ShellPopover } from './shell-popover'
import { ComposerToolsMenu } from '@renderer/features/composer/composer-tools-menu'
import { FeedbackInboxButton } from '@renderer/features/feedback/feedback-inbox-button'
import { useMagpieQuotas } from '@renderer/features/quota/use-magpie-quotas'
import { MagpieQuotaDetails, StatusQuotaButton, buildQuotaTitle, formatQuotaSummary } from '@renderer/features/quota/status-quota'

type WorkerRow = { sessionFile: string; running: boolean; cwd: string }
type TerminalRow = { id: string; cwd: string; workspace: string; profileName: string; command?: string; owner: string; state: string }
type CpuInfo = { percent: number; processes: number }
type MemoryKind = 'main' | 'ui' | 'sessions' | 'browser' | 'gpu' | 'other'
type AppMemory = { total: number; byKind: Record<MemoryKind, number>; processes: number }
type DesktopStatus = { rss: number; total: number; app?: AppMemory; workers: WorkerRow[]; cpu?: CpuInfo; terminals?: TerminalRow[] }
const MEMORY_KINDS: MemoryKind[] = ['sessions', 'ui', 'main', 'browser', 'gpu', 'other']

/** Equal at display granularity (memory is shown in MB), so steady polls do not re-render. */
function sameDesktopStatus(previous: DesktopStatus | null, next: DesktopStatus): boolean {
  if (!previous) return false
  const mb = (bytes: number) => Math.round(bytes / 1024 ** 2)
  const cpuSame = Math.abs((previous.cpu?.percent ?? 0) - (next.cpu?.percent ?? 0)) < 0.5
  const prevTerms = previous.terminals ?? []
  const nextTerms = next.terminals ?? []
  const termsSame = prevTerms.length === nextTerms.length && prevTerms.every((row, index) => {
    const other = nextTerms[index]
    return row.id === other.id && row.state === other.state && row.cwd === other.cwd
  })
  return (
    mb(previous.app?.total ?? previous.rss) === mb(next.app?.total ?? next.rss) &&
    previous.total === next.total &&
    previous.workers.length === next.workers.length &&
    previous.workers.every((row, index) => {
      const other = next.workers[index]
      return row.sessionFile === other.sessionFile && row.running === other.running && row.cwd === other.cwd
    }) && cpuSame && termsSame
  )
}
type Popover = 'workers' | 'board' | 'quota' | null
const GROUPS: SessionAttention[] = ['needs-you', 'working', 'done']

export function StatusBar() {
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const { t, i18n } = useTranslation()
  const attention = useUIStore((s) => s.sessionAttention)
  const sessions = useUIStore((s) => s.sessions)
  const counts = countAttention(attention)
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const [sessionsByWorkspace, setSessionsByWorkspace] = useState<Record<string, SessionItem[]>>({})
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [popover, setPopover] = useState<Popover>(null)
  const [confirmStop, setConfirmStop] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const boardAnchor = useRef<HTMLButtonElement>(null)
  const workersAnchor = useRef<HTMLButtonElement>(null)
  const quotaAnchor = useRef<HTMLButtonElement>(null)
  const quota = useMagpieQuotas(popover === 'quota')
  const quotaSummary = formatQuotaSummary(quota.codex, quota.opencode)
  const quotaTitle = buildQuotaTitle(quota.codex, quota.opencode)
  const close = useCallback(() => {
    setPopover(null)
    setConfirmStop(null)
    setActionError(null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await ipcClient.invoke('desktop.status', {})
      const next = { rss: res.rss, total: res.total, app: res.app, workers: res.workers ?? [], cpu: res.cpu, terminals: res.terminals ?? [] }
      setStatus((previous) => (sameDesktopStatus(previous, next) ? previous : next))
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  useVisibleInterval(() => void refresh(), popover ? 4000 : 12_000)
  useEffect(() => {
    if (!popover) return
    let cancelled = false
    const workers = status?.workers ?? []
    const requestedWorkspaces = new Set<string>()
    const loadWorkspace = (workspace: string | null | undefined) => {
      if (cancelled || !workspace || workspacePathsEqual(workspace, currentWorkspace)) return
      const key = workspacePathKey(workspace)
      if (requestedWorkspaces.has(key)) return
      requestedWorkspaces.add(key)
      void loadWorkspaceSessionList(workspace).then((list) => {
        if (!cancelled && list) setSessionsByWorkspace((previous) => ({ ...previous, [key]: list }))
      })
    }
    for (const worker of workers) loadWorkspace(worker.cwd)
    for (const sessionFile of Object.keys(attention)) {
      if (sessions.some((session) => sessionFilesEqual(session.sessionFile, sessionFile))
        || workers.some((worker) => sessionFilesEqual(worker.sessionFile, sessionFile))) continue
      void ipcClient.invoke('session.prepare', { sessionFile, bind: false })
        .then((prepared) => loadWorkspace(prepared?.workspaceId))
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [popover, status?.workers, currentWorkspace, sessions, attention])

  useEffect(() => {
    const busy = counts.working + counts.needsYou > 0
    void ipcClient.invoke('desktop.setSleepBlock', { on: busy }).catch(() => {})
  }, [counts.working, counts.needsYou])

  const findSession = (file: string) => sessions.find((s) => sessionFilesEqual(s.sessionFile, file))
    ?? Object.values(sessionsByWorkspace).flat().find((s) => sessionFilesEqual(s.sessionFile, file))

  const openSession = async (file: string) => {
    setActionError(null)
    try {
      const match = findSession(file)
      const worker = status?.workers.find((row) => sessionFilesEqual(row.sessionFile, file))
      // Disk identity is authoritative; a missing/stale project list does not mean deletion.
      const prepared = await ipcClient.invoke('session.prepare', { sessionFile: file, bind: false })
      if (!prepared?.sessionId) {
        setActionError(t('common:notification.sessionGone'))
        return
      }
      const workspace = prepared.workspaceId || match?.workspaceId || worker?.cwd || (match ? currentWorkspace : null)
      if (!workspace) {
        setActionError(t('common:notification.openFailed'))
        return
      }
      const sessionFile = prepared.sessionFile || file
      if (workspacePathsEqual(workspace, currentWorkspace)) await switchSessionInPlace(prepared.sessionId, sessionFile)
      else await activateWorkspace(workspace, { sessionId: prepared.sessionId, sessionFile })
      close()
    } catch {
      setActionError(t('common:notification.openFailed'))
    }
  }

  const stopWorker = async (file: string) => {
    setStopping(true)
    setActionError(null)
    try {
      const result = await ipcClient.invoke('desktop.killWorker', { sessionFile: file })
      if (!result.ok) throw new Error('stop failed')
      setConfirmStop(null)
      await refresh()
    } catch {
      setActionError(t('common:operationFailed'))
    } finally {
      setStopping(false)
    }
  }

  const label = (kind: SessionAttention) => kind === 'needs-you'
    ? t('common:attention.needsYou')
    : kind === 'working' ? t('common:app.status.running') : t('common:attention.done')
  // Whole app (every Electron process); falls back to the main process if metrics are missing.
  const rss = status?.app?.total || status?.rss || 0
  const fmt = (bytes: number) => {
    const gib = bytes >= 1024 ** 3
    return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: gib ? 1 : 0 }).format(bytes / 1024 ** (gib ? 3 : 2))} ${gib ? 'GB' : 'MB'}`
  }
  const memory = rss ? fmt(rss) : '—'
  const cpuText = status?.cpu ? `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(status.cpu.percent)}%` : '—'
  const stopTerminal = async (id: string) => {
    setStopping(true)
    setActionError(null)
    try {
      await ipcClient.invoke('desktop.killTerminal', { id })
      await refresh()
    } catch {
      setActionError(t('common:operationFailed'))
    } finally {
      setStopping(false)
    }
  }
  const cleanIdleResources = async () => {
    setStopping(true)
    setActionError(null)
    try {
      const res = (await ipcClient.invoke('desktop.cleanupIdleResources', {})) as {
        workers?: number
        terminals?: number
      } | null
      const workers = res?.workers ?? 0
      const terminals = res?.terminals ?? 0
      if (workers + terminals > 0) {
        toast.message(t('common:statusBar.cleanIdleDone', { workers, terminals }))
      } else {
        toast.message(t('common:statusBar.cleanIdleNone'))
      }
      await refresh()
    } catch {
      setActionError(t('common:operationFailed'))
    } finally {
      setStopping(false)
    }
  }
  const runFailed = useUIStore((s) => s.runState.status === 'failed')
  const runRunning = useUIStore((s) => s.runState.status === 'running')
  const ratio = status?.total ? rss / status.total : 0
  const level = ratio >= 0.8 ? 'critical' : ratio >= 0.6 ? 'warning' : 'normal'
  const live = counts.working + counts.needsYou + counts.done

  return (
    <footer className="workbench-statusbar electron-no-drag" aria-label={t('common:statusBar.title')}>
      <button ref={boardAnchor} type="button" className="workbench-status-trigger" aria-haspopup="dialog" aria-expanded={popover === 'board'} aria-label={t('common:board.title')} onClick={() => setPopover((v) => v === 'board' ? null : 'board')}>
        {live === 0 ? (runFailed
          ? <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-destructive" />{t('common:statusBar.failed')}</span>
          : <span className="flex items-center gap-2"><span className="status-ready-dot" />{t('common:app.status.ready')}</span>) : (
          <>
            {counts.needsYou > 0 && <span className="flex items-center gap-1.5"><SessionAttentionDot attention="needs-you" />{t('common:statusBar.needsYou', { count: counts.needsYou })}</span>}
            {counts.working > 0 && <span className="flex items-center gap-1.5"><SessionAttentionDot attention="working" />{t('common:statusBar.running', { count: counts.working })}</span>}
            {counts.done > 0 && <span className="flex items-center gap-1.5"><SessionAttentionDot attention="done" />{t('common:statusBar.done', { count: counts.done })}</span>}
          </>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 rotate-180 opacity-60" />
      </button>
      {/* 当前项目与分支：曾经在侧栏改版时丢了入口（命令面板的「切换分支」因此变成空操作），挂回状态栏左侧 */}
      <BranchStatusTrigger />
      <div className="hidden min-w-0 items-center overflow-hidden md:flex">
        <ComposerToolsMenu location="status" running={runRunning} />
        {/* 教训档案入口：我批评过的点、让模型判断该不该沉淀成规则，都在这里攒着 */}
        <FeedbackInboxButton />
      </div>
      <div className="ml-auto flex shrink-0 items-center">
        {quotaSummary ? <StatusQuotaButton anchorRef={quotaAnchor} open={popover === 'quota'} label={quotaSummary} title={quota.error ?? quotaTitle} onClick={() => { setPopover((v) => v === 'quota' ? null : 'quota'); void quota.refresh(true) }} /> : null}
        <button ref={workersAnchor} type="button" className="workbench-status-trigger tabular-nums" data-level={level} aria-haspopup="dialog" aria-expanded={popover === 'workers'} aria-label={t('common:statusBar.resources')} title={t('common:statusBar.memoryHint')} onClick={() => { setPopover((v) => v === 'workers' ? null : 'workers'); void refresh() }}>
          <Cpu className="h-3 w-3" /><span>{memory} · {cpuText}</span>
        </button>
      </div>

      {popover && (
        <ShellPopover title={popover === 'board' ? t('common:board.title') : popover === 'quota' ? '剩余额度' : t('common:statusBar.resources')} anchorRef={popover === 'board' ? boardAnchor : popover === 'quota' ? quotaAnchor : workersAnchor} onClose={close}>
          {actionError && <p role="alert" className="workbench-error">{actionError}</p>}
          {popover === 'board' ? (
            live === 0 ? <div className="workbench-empty"><SessionAttentionDot attention="done" /><p>{t('common:board.empty')}</p><span>{t('common:board.emptyHint')}</span></div> : (
              GROUPS.map((kind) => {
                const files = listAttentionSessions(attention, kind)
                if (!files.length) return null
                return <section key={kind} className="workbench-group" aria-label={label(kind)}>
                  <h3 className="workbench-group-heading"><SessionAttentionDot attention={kind} />{label(kind)}<span>{files.length}</span></h3>
                  {files.map((file) => {
                    const match = findSession(file)
                    const worker = status?.workers.find((row) => sessionFilesEqual(row.sessionFile, file))
                    const workspace = match?.workspaceId || worker?.cwd || (match ? currentWorkspace : null)
                    return <button key={file} type="button" className="workbench-list-row" onClick={() => void openSession(file)}>
                      <span className="workbench-row-title">{match?.title || t('common:split.untitled')}</span>
                      <span className="workbench-row-detail">{workspace?.split(/[\\/]/).pop()}{match?.firstMessage ? ` · ${match.firstMessage}` : ''}</span>
                    </button>
                  })}
                </section>
              })
            )
          ) : popover === 'quota' ? (
            <MagpieQuotaDetails codex={quota.codex} opencode={quota.opencode} error={quota.error} />
          ) : (
            <>
              <div className="workbench-resource-summary"><div><span className="workbench-row-detail">{t('common:statusBar.memory')}</span><strong className="block text-xl font-medium tabular-nums">{memory}</strong></div><div><span className="workbench-row-detail">{t('common:statusBar.cpu')}</span><strong className="block text-xl font-medium tabular-nums">{cpuText}</strong></div><button type="button" className="workbench-button ml-auto" disabled={stopping} onClick={() => void cleanIdleResources()}>{t('common:statusBar.cleanIdle')}</button><button type="button" className="workbench-icon" aria-label={t('common:refresh')} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></button></div>
              {status?.app ? (
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 pb-2 text-xs">
                  {MEMORY_KINDS.filter((k) => (status.app?.byKind[k] ?? 0) > 0).map((k) => (
                    <div key={k} className="contents">
                      <dt className="text-foreground-secondary">{t(`common:statusBar.memoryKinds.${k}`)}</dt>
                      <dd className="text-right tabular-nums">{fmt(status.app!.byKind[k])}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="px-4 pb-3 text-xs leading-relaxed text-foreground-secondary">{t('common:statusBar.memoryHint', { count: status?.app?.processes ?? 0 })}</p>
              <p className="px-4 pb-3 text-xs leading-relaxed text-foreground-secondary">{t('common:statusBar.cpuHint')}</p>
              {loadError && <p role="alert" className="workbench-error">{t('common:statusBar.loadFailed')}</p>}
              {!status && !loadError ? <p role="status" className="workbench-empty">{t('common:loading')}</p> : (
                <>
                  {status?.workers.length === 0 ? <p className="workbench-empty">{t('common:statusBar.noWorkers')}</p> : (
                    <section className="workbench-group" aria-label={t('common:statusBar.workers')}>
                      <h3 className="workbench-group-heading">{t('common:statusBar.workers')}<span>{status?.workers.length}</span></h3>
                      {status?.workers.map((row) => {
                        const match = findSession(row.sessionFile)
                        return <div key={row.sessionFile} className="workbench-resource-row">
                          <div className="flex min-w-0 flex-1 items-start gap-2.5"><SessionAttentionDot attention={row.running ? 'working' : 'idle'} className="mt-1" /><div className="min-w-0"><div className="workbench-row-title">{match?.title || t('common:split.untitled')}</div><div className="workbench-row-detail">{row.cwd.split(/[\\/]/).pop()} · {row.running ? t('common:app.status.running') : t('common:app.status.idle')}</div></div></div>
                          {confirmStop === row.sessionFile ? <div className="basis-full rounded-md border border-border p-3"><p className="mb-2 text-xs leading-relaxed">{t('common:statusBar.stopConfirm')}</p><div className="flex justify-end gap-2"><button type="button" className="workbench-button" disabled={stopping} onClick={() => setConfirmStop(null)}>{t('common:cancel')}</button><button type="button" className="workbench-button text-destructive" disabled={stopping} onClick={() => void stopWorker(row.sessionFile)}>{stopping ? t('common:loading') : t('common:statusBar.kill')}</button></div></div> : <button type="button" className="workbench-button" disabled={!row.running} onClick={() => setConfirmStop(row.sessionFile)}>{t('common:statusBar.kill')}</button>}
                        </div>
                      })}
                    </section>
                  )}
                  {!(status?.terminals?.length) ? <p className="workbench-empty">{t('common:statusBar.noTerminals')}</p> : (
                    <section className="workbench-group" aria-label={t('common:statusBar.terminals')}>
                      <h3 className="workbench-group-heading">{t('common:statusBar.terminals')}<span>{status?.terminals?.length}</span></h3>
                      {status?.terminals?.map((term) => (
                        <div key={term.id} className="workbench-resource-row">
                          <div className="flex min-w-0 flex-1 items-start gap-2.5"><SessionAttentionDot attention={term.state === 'busy' ? 'working' : 'idle'} className="mt-1" /><div className="min-w-0"><div className="workbench-row-title flex items-center gap-1.5"><span className="truncate">{term.workspace.split(/[\\/]/).pop() || term.cwd.split(/[\\/]/).pop()}{term.profileName ? ` · ${term.profileName}` : ''}</span>{term.owner === 'ai' ? <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary">{t('common:statusBar.ownerAi')}</span> : null}</div><div className="workbench-row-detail">{term.cwd}{term.command ? ` · ${term.command.slice(0, 60)}` : ''}</div></div></div>
                          <button type="button" className="workbench-button text-destructive" disabled={stopping} onClick={() => void stopTerminal(term.id)}>{t('common:statusBar.closeTerminal')}</button>
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </ShellPopover>
      )}
    </footer>
  )
}
