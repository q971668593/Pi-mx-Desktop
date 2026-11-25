import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Archive, Check, ChevronDown, CloudDownload, FileText, FolderTree, GitBranch, GitBranchPlus, GitCommitHorizontal, Loader2, MoreHorizontal, RefreshCw, Rows2, Settings, Sparkles, X, Minus, Plus, Trash2 } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import { applyConflictChoices, parseConflicts, type ConflictChoice } from './conflict-editor'
import { GitLane } from './git-lane'
import { formatCommitDate, layoutCommitGraph } from './git-graph'
import { workspacePathKey } from '@shared/workspace-path'
import { fileTreeIcon } from '@renderer/features/workspace-files/file-tree-icons'
import './git-board.css'
import { GitCommandHistory } from './git-command-history'
import { GitChangesTree } from './git-changes-tree'
import { BranchPickerPopover, type BranchStatus } from '@renderer/features/git/branch-picker'

function CommitDate({ time }: { time: number }) {
  if (!time) return null
  const date = new Date(time * 1000)
  if (Number.isNaN(date.getTime())) return null
  return <time dateTime={date.toISOString()} title={date.toLocaleString()} className="min-w-[112px] shrink-0 whitespace-nowrap text-right font-mono text-[10px] tabular-nums text-foreground-tertiary">{formatCommitDate(time)}</time>
}

function GitFileIcon({ path }: { path: string }) {
  const { Icon, className } = fileTreeIcon(path, false)
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', className)} aria-hidden />
}

type Change = { staged: string; unstaged: string; path: string; group: 'conflict' | 'staged' | 'unstaged' | 'untracked' }
type Commit = { hash: string; short: string; parents: string[]; author: string; time: number; subject: string; decorations: string }
type Branch = { name: string; kind: 'local' | 'remote'; current: boolean; hash: string; upstream: string | null; ahead: number; behind: number; subject: string }
type FileRow = { status: string; path: string }
type Detail = { hash: string; subject: string; body: string; author: string; time: number; parents: string[]; files: FileRow[] }
type ChangeView = 'list' | 'tree'
type Overview = {
  ok?: boolean
  status: { branch: string; upstream: string | null; ahead: number; behind: number }; files: Change[]
  branches: Branch[]
  commits: Commit[]
  hasMore: boolean
  stashes: Array<{ ref: string; message: string }>
  tags: string[]
  remotes: Array<{ name: string; fetch: string; push: string }>
  worktrees: Array<{ path: string; head: string; branch: string | null }>
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
}
type QuickChanges = {
  ok?: boolean; error?: string
  status: Overview['status']; files: Change[]; operation: Overview['operation']
}
const TABS = ['changes', 'graph', 'branches', 'log', 'advanced'] as const
type Tab = (typeof TABS)[number]
const REPOSITORY_TABS = ['stash', 'tags', 'remotes', 'worktrees'] as const
type RepositoryTab = (typeof REPOSITORY_TABS)[number]
const DEFAULT_COMMIT_PROMPT = '根据 git diff 写一条简短提交说明。只输出说明正文，不要代码块或解释。第一行不超过 72 个字符，需要时再用短正文说明原因。不要编造未出现的改动。'

async function git<T>(method: string, request: Record<string, unknown>) {
  return ipcClient.invoke(method, request) as Promise<T & { ok?: boolean; error?: string; text?: string; stdout?: string }>
}

function joinChildPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child}`
}

type CommitDraft = { message: string; suggesting: boolean }
const EMPTY_COMMIT_DRAFT: CommitDraft = { message: '', suggesting: false }
const useCommitDrafts = create<{ entries: Record<string, CommitDraft> }>(() => ({ entries: {} }))
function updateCommitDraft(key: string, update: (draft: CommitDraft) => CommitDraft) {
  useCommitDrafts.setState(({ entries }) => ({ entries: { ...entries, [key]: update(entries[key] || EMPTY_COMMIT_DRAFT) } }))
}

export function GitBoardPanel() {
  const { t } = useTranslation()
  const cwd = useUIStore((s) => s.currentWorkspace)
  const [data, setData] = useState<Overview | null>(null)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<Tab>('changes')
  const [changeViewByWorkspace, setChangeViewByWorkspace] = useState<Record<string, ChangeView>>({})
  const [repositoryTab, setRepositoryTab] = useState<RepositoryTab>('stash')
  const draftKey = workspacePathKey(cwd || '')
  const commitDraft = useCommitDrafts((s) => s.entries[draftKey] || EMPTY_COMMIT_DRAFT)
  const { message, suggesting } = commitDraft
  const setMessage = (value: string | ((current: string) => string)) => updateCommitDraft(draftKey, (draft) => ({ ...draft, message: typeof value === 'function' ? value(draft.message) : value }))
  const [selectedPushRemote, setSelectedPushRemote] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [commitPrompt, setCommitPrompt] = useState(() => { try { return localStorage.getItem('pi-desktop:git-commit-prompt') || DEFAULT_COMMIT_PROMPT } catch { return DEFAULT_COMMIT_PROMPT } })
  const [promptDraft, setPromptDraft] = useState(commitPrompt)
  const [commitAction, setCommitAction] = useState<'stage-and-commit' | 'commit-and-push' | null>(null)
  const [commitComplete, setCommitComplete] = useState<'stage-and-commit' | 'commit-and-push' | null>(null)
  const [name, setName] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)
  const [from, setFrom] = useState('')
  const [stashMessage, setStashMessage] = useState('')
  const [tagName, setTagName] = useState('')
  const [tagTarget, setTagTarget] = useState('')
  const [tagMessage, setTagMessage] = useState('')
  const [tagAdvancedOpen, setTagAdvancedOpen] = useState(false)
  const [remoteFormMode, setRemoteFormMode] = useState<'add' | 'url' | 'rename'>('add')
  const [remoteTarget, setRemoteTarget] = useState('')
  const [remoteNewName, setRemoteNewName] = useState('')
  const [remoteNewUrl, setRemoteNewUrl] = useState('')
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [worktreePath, setWorktreePath] = useState('')
  const [worktreeParentPath, setWorktreeParentPath] = useState('')
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneTargetPath, setCloneTargetPath] = useState('')
  const [cloneParentPath, setCloneParentPath] = useState('')
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [diff, setDiff] = useState('')
  const [commandLog, setCommandLog] = useState<Array<{ time: number; command: string; success: boolean; output: string }>>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [conflictPath, setConflictPath] = useState('')
  const [conflictText, setConflictText] = useState('')
  const [choices, setChoices] = useState<Map<number, ConflictChoice>>(new Map())
  const [menu, setMenu] = useState<{ x: number; y: number; commit: Commit } | null>(null)
  const [restError, setRestError] = useState('')
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)
  const [branchStatus, setBranchStatus] = useState<BranchStatus | null>(null)
  const branchAnchor = useRef<HTMLButtonElement>(null)
  const closeBranchPicker = useCallback(() => setBranchPickerOpen(false), [])
  const loadSequence = useRef(0)

  const changesViewKey = cwd ? workspacePathKey(cwd) : ''
  const changeView = changeViewByWorkspace[changesViewKey] ?? (() => {
    try { return localStorage.getItem(`pi-desktop:git-changes-view:${changesViewKey}`) === 'tree' ? 'tree' : 'list' }
    catch { return 'list' }
  })()
  const setChangeView = (view: ChangeView) => {
    setChangeViewByWorkspace((current) => ({ ...current, [changesViewKey]: view }))
    try { localStorage.setItem(`pi-desktop:git-changes-view:${changesViewKey}`, view) } catch { /* storage is optional */ }
  }

  const withTimeout = <T,>(promise: Promise<T>, ms: number) => Promise.race([
    promise,
    new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('git_timeout')), ms) }),
  ])

  const load = useCallback(async (append = false, resetFilters = false) => {
    if (!cwd) return
    const sequence = ++loadSequence.current
    const timeoutMessage = () => t('common:gitBoard.timeout')
    // First paint: status + file list only (~200ms), so the Changes tab never waits on log/refs.
    let quickOk = false
    try {
      if (!append) {
        setRestError('')
        const quick = await withTimeout(
          git<QuickChanges>('gitBoard.changes', { cwd }),
          8000,
        )
        if (sequence !== loadSequence.current) return
        if (!quick.ok) {
          const absent = quick.error === 'not_repo'
          setMissing(absent)
          setLoadError(quick.ok || absent ? '' : quick.error || 'git_failed')
          if (!quick.ok) return setData(null)
        } else {
          quickOk = true
          setMissing(false)
          setLoadError('')
          setData((prev) => ({
            status: quick.status,
            files: quick.files,
            operation: quick.operation,
            branches: prev?.branches ?? [],
            commits: prev?.commits ?? [],
            hasMore: false,
            stashes: prev?.stashes ?? [],
            tags: prev?.tags ?? [],
            remotes: prev?.remotes ?? [],
            worktrees: prev?.worktrees ?? [],
          }))
        }
      }
      // Second pass: graph + branches + stashes + tags + remotes + worktrees.
      const result = await withTimeout(
        git<Overview>('gitBoard.overview', { cwd, skip: append ? data?.commits.length || 0 : 0, ...(!resetFilters && query.trim() ? { query: query.trim() } : {}), ...(!resetFilters && author.trim() ? { author: author.trim() } : {}) }),
        20_000,
      )
      if (sequence !== loadSequence.current) return
      const absent = !result.ok && result.error === 'not_repo'
      setMissing(absent)
      if (!result.ok) {
        if (quickOk || (append && data)) {
          setRestError(result.error || 'git_failed')
          return
        }
        setLoadError(result.error || 'git_failed')
        return setData(null)
      }
      setLoadError('')
      setRestError('')
      setData(append && data ? { ...result, commits: [...data.commits, ...result.commits] } : result)
    } catch (error) {
      if (sequence !== loadSequence.current) return
      const message = error instanceof Error ? error.message : String(error)
      const text = message === 'git_timeout' ? timeoutMessage() : message
      if (quickOk) setRestError(text)
      else setLoadError(text)
    }
  }, [author, cwd, data, query, t])
  useEffect(() => {
    setData(null)
    setMissing(false)
    setLoadError('')
    setRestError('')
    setDiff('')
    setDetail(null)
    setConflictPath('')
    setCommandLog([])
    setSelectedPushRemote('')
    setQuery('')
    setAuthor('')
    try {
      const stored = localStorage.getItem(`pi-desktop:git-tab:${workspacePathKey(cwd)}`)
      if (REPOSITORY_TABS.includes(stored as RepositoryTab)) { setRepositoryTab(stored as RepositoryTab); setTab('advanced') }
      else if (stored === 'repository') setTab('advanced')
      else setTab(TABS.includes(stored as Tab) ? stored as Tab : 'changes')
    } catch { setTab('changes') }
    void load(false, true)
    return () => { loadSequence.current += 1 }
  }, [cwd])
  const loadRef = useRef(load)
  loadRef.current = load
  // 手动刷新：以前点了完全没反馈（后台确实重跑了 git，但界面上什么都不动），
  // 而且按钮没有 shrink-0，头部横向挤满时会被压到滚动视口外，点上去像按了空气。
  // 必须定义在所有 early return 之前，否则加载态/错误态分支里的按钮会命中 TDZ。
  const manualRefresh = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    try { await load(false) } finally { refreshingRef.current = false; setRefreshing(false) }
  }, [load])
  const refreshButton = (
    <button
      type="button"
      data-git-refresh=""
      className="shrink-0 rounded border border-border/60 p-1 text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      aria-label={refreshing ? t('common:gitBoard.refreshing') : t('common:gitBoard.refresh')}
      title={refreshing ? t('common:gitBoard.refreshing') : t('common:gitBoard.refresh')}
      disabled={refreshing}
      onClick={() => void manualRefresh()}
    >
      <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
    </button>
  )
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.piDesktop?.onGitWorkspaceChanged?.(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void loadRef.current(false), 600)
    })
    return () => { if (timer) clearTimeout(timer); off?.() }
  }, [cwd])
  // The header branch label opens the shared picker, so it needs the same status the status bar reads.
  // Failure is not fatal: the overview already knows branch / upstream / ahead / behind, and that
  // fallback keeps the picker usable when the extra round trip does not answer.
  useEffect(() => {
    if (!cwd) return setBranchStatus(null)
    let live = true
    void ipcClient
      .invoke('git.branchStatus', { cwd })
      .then((r) => live && setBranchStatus(r as BranchStatus))
      .catch(() => live && setBranchStatus(null))
    return () => {
      live = false
    }
  }, [cwd, data?.status.branch, data?.status.ahead, data?.status.behind])

  const pickerStatus: BranchStatus =
    branchStatus ?? {
      isRepo: true,
      branch: data?.status.branch || null,
      head: data?.commits[0]?.hash || '',
      upstream: data?.status.upstream ?? null,
      ahead: data?.status.ahead ?? 0,
      behind: data?.status.behind ?? 0,
      dirty: data?.files.length ?? 0,
    }
  const rows = useMemo(() => layoutCommitGraph(data?.commits || []), [data])
  const nodes = useMemo(() => parseConflicts(conflictText), [conflictText])
  const unresolved = nodes.filter((node) => node.kind === 'conflict' && !choices.has(node.index)).length

  const [remoteChecks, setRemoteChecks] = useState<Record<string, {
    checkedAt: number
    incoming?: Array<{ hash: string; subject: string }>
    incomingCount?: number
    tracking?: boolean
    error?: string
  }>>({})
  const remoteKey = JSON.stringify([workspacePathKey(cwd || ''), data?.status.branch, data?.status.upstream])
  const remoteCheck = remoteChecks[remoteKey]
  const clearRemoteCheck = () => setRemoteChecks((old) => {
    const next = { ...old }
    delete next[remoteKey]
    return next
  })

  const checkRemote = async () => {
    if (!cwd || busy || !data?.remotes.length) return
    setBusy(true)
    try {
      const result = await git<{
        incoming: Array<{ hash: string; subject: string }>
        incomingCount?: number
        tracking: boolean
      }>('gitBoard.sync', { cwd, action: 'fetch' })
      if (!result.ok) throw new Error(result.error || 'git_failed')
      setRemoteChecks((old) => ({ ...old, [remoteKey]: {
        checkedAt: Date.now(), incoming: result.incoming, incomingCount: result.incomingCount, tracking: result.tracking,
      } }))
      await load(false)
    } catch (error) {
      setRemoteChecks((old) => ({ ...old, [remoteKey]: {
        checkedAt: Date.now(), error: error instanceof Error ? error.message : String(error),
      } }))
    } finally {
      setBusy(false)
    }
  }

  const run = async (method: string, request: Record<string, unknown> = {}) => {
    if (!cwd) return null
    setBusy(true)
    try {
      const result = await git<Record<string, unknown>>(method, { cwd, ...request })
      if (!result.ok) {
        if (method === 'gitBoard.commit' && result.committed === true && result.pushed === false) {
          await load(false)
          toast.error(t('common:gitBoard.pushFailedAfterCommit', { error: String(result.error || 'push_failed') }))
          return result
        }
        throw new Error(result.error || 'git_failed')
      }
      if (method === 'gitBoard.sync' || method === 'gitBoard.commit' || method === 'gitBoard.checkoutCommit'
        || method === 'gitBoard.operation' || method === 'gitBoard.merge' || method === 'gitBoard.rebase') clearRemoteCheck()
      if (method === 'gitBoard.commitDetail') return { ...result, hash: String(request.ref || '') }
      if (!['gitBoard.suggestCommit', 'gitBoard.diff', 'gitBoard.commitDetail'].includes(method)) {
        toast.success(method === 'gitBoard.commit' && request.action === 'commit-and-push' ? t('common:gitBoard.commitPushDone') : t('common:gitBoard.done'))
        await load(false)
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const knownErrors: Record<string, string> = {
        no_remote: 'noRemote',
        remote_required: 'selectRemote',
        invalid_remote: 'invalidRemote',
        detached_head: 'detachedHead',
        working_tree_dirty: 'workingTreeDirty',
      }
      toast.error(knownErrors[message] ? t(`common:gitBoard.${knownErrors[message]}`) : message)
      return null
    } finally {
      setBusy(false)
    }
  }
  const openDiff = async (path: string, request: Record<string, unknown>) => {
    const result = await run('gitBoard.diff', { path, ...request })
    setDiff(result?.stdout || '')
  }
  const openCommitDetail = async (hash: string) => {
    const result = await run('gitBoard.commitDetail', { ref: hash })
    if (result) {
      setDiff('')
      setDetail({ ...result, hash } as Detail)
    }
  }
  const suggestCommit = async () => {
    if (!cwd || busy || useCommitDrafts.getState().entries[draftKey]?.suggesting) return
    const original = message
    updateCommitDraft(draftKey, (draft) => ({ ...draft, suggesting: true }))
    try {
      const result = await git<{ text?: string }>('gitBoard.suggestCommit', { cwd, prompt: commitPrompt.trim() })
      if (!result.ok) throw new Error(result.error || 'git_failed')
      if (result.text) setMessage((current) => current === original ? result.text! : current)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      updateCommitDraft(draftKey, (draft) => ({ ...draft, suggesting: false }))
    }
  }
  const commit = async (action: 'stage-and-commit' | 'commit-and-push') => {
    const submitted = message
    if (!submitted.trim() || busy || commitAction) return
    const currentData = data
    if (action === 'commit-and-push') {
      if (!currentData?.status.branch) return toast.error(t('common:gitBoard.detachedHead'))
      if (!currentData.status.upstream && !currentData.remotes.length) return toast.error(t('common:gitBoard.noRemote'))
      if (!currentData.status.upstream && currentData.remotes.length > 1 && !currentData.remotes.some((remote) => remote.name === selectedPushRemote)) {
        return toast.error(t('common:gitBoard.selectRemote'))
      }
    }
    setCommitAction(action)
    setCommitComplete(null)
    try {
      const targetRemote = action === 'commit-and-push' && currentData && !currentData.status.upstream && currentData.remotes.length > 1 ? selectedPushRemote : undefined
      const result = await run('gitBoard.commit', { message: submitted, action, ...(targetRemote ? { remote: targetRemote } : {}) })
      if (result?.ok || result?.committed === true) setMessage((current) => current === submitted ? '' : current)
      if (result?.ok) {
        setCommitComplete(action)
        window.setTimeout(() => setCommitComplete(null), 2000)
      }
    } finally { setCommitAction(null) }
  }
  const loadLog = async () => {
    if (!cwd) return
    const result = await ipcClient.invoke('gitBoard.log', { cwd, limit: 200 }) as { entries?: Array<{ time: number; command: string; success: boolean; output: string }> }
    setCommandLog(result.entries || [])
  }
  useEffect(() => { if (tab === 'log' && cwd) void loadLog() }, [tab, cwd])
  const ask = (title: string, text: string, action: () => Promise<unknown>) => setConfirm({ title, message: text, run: async () => { setConfirm(null); await action() } })
  const openConflict = async (path: string) => {
    const result = await ipcClient.invoke('workspace.fs.readText', { workspaceRoot: cwd, path, maxBytes: 1_000_000 })
    if (!result?.ok || typeof result.content !== 'string') return toast.error(result?.error || 'read_failed')
    setConflictPath(path)
    setConflictText(result.content)
    setChoices(new Map())
  }
  const saveConflict = async () => {
    const applied = applyConflictChoices(nodes, choices)
    const written = await ipcClient.invoke('workspace.fs.writeText', { workspaceRoot: cwd, path: conflictPath, content: applied.lines.join('\n') })
    if (!written?.ok) return toast.error(written?.error || 'write_failed')
    if (applied.unresolved === 0) await run('gitBoard.stage', { paths: [conflictPath] })
    else toast.success(t('common:gitBoard.saved'))
    if (applied.unresolved === 0) setConflictPath('')
  }
  const removeBranch = (branch: string) => ask(t('common:gitBoard.delete'), branch, async () => {
    if (!cwd) return
    setBusy(true)
    try {
      const result = await git('gitBoard.branch', { cwd, action: 'delete', name: branch })
      if (result.ok) {
        toast.success(t('common:gitBoard.done'))
        await load(false)
        return
      }
      const message = result.error || 'git_failed'
      if (/not fully merged|未完全合并/i.test(message)) ask(t('common:gitBoard.deleteForce'), t('common:gitBoard.unmerged'), () => run('gitBoard.branch', { action: 'delete', name: branch, force: true }))
      else toast.error(message === 'current_branch' ? t('common:gitBoard.currentBranch') : message)
    } finally {
      setBusy(false)
    }
  })
  const browseWorktree = async () => {
    const result = await ipcClient.invoke('dialog:openDirectory', {})
    if (result?.path) {
      const branch = worktreeBranch.trim() || 'worktree'
      setWorktreeParentPath(String(result.path))
      setWorktreePath(joinChildPath(String(result.path), branch))
    }
  }
  const browseCloneDestination = async () => {
    const result = await ipcClient.invoke('dialog:openDirectory', {})
    if (!result?.path) return
    const repoName = cloneUrl.trim().split(/[\\/:]/).pop()?.replace(/\.git$/i, '') || 'repository'
    setCloneParentPath(String(result.path))
    setCloneTargetPath(joinChildPath(String(result.path), repoName))
  }
  const submitRemoteForm = async () => {
    const remote = remoteTarget || data?.remotes[0]?.name || ''
    const method = remoteFormMode === 'add' ? 'add' : remoteFormMode === 'url' ? 'setUrl' : 'rename'
    const result = await run('gitBoard.remote', {
      action: method,
      name: remoteFormMode === 'add' ? remoteNewName.trim() : remote,
      ...(remoteFormMode === 'rename' ? { to: remoteNewName.trim() } : {}),
      ...(remoteFormMode !== 'rename' ? { url: remoteNewUrl.trim() } : {}),
    })
    if (!result?.ok) return
    setRemoteNewName('')
    setRemoteNewUrl('')
    if (remoteFormMode === 'add') setRemoteTarget('')
    else if (remoteFormMode === 'rename') setRemoteTarget(remoteNewName.trim())
  }

  if (!cwd) return <p className="p-4 text-[12px] text-foreground-tertiary">{t('common:gitBoard.noWorkspace')}</p>
  if (loadError) return <div className="m-4 flex items-center gap-2 text-[12px]"><span className="text-destructive">{loadError}</span>{refreshButton}</div>
  if (missing) return <div className="m-4 space-y-2"><p className="text-[12px] text-foreground-tertiary">{t('common:gitBoard.notRepo')}</p><button type="button" className="rounded border px-3 py-1.5 text-[12px]" onClick={() => void run('gitBoard.init')}>{t('common:gitBoard.init')}</button></div>
  if (!data) return (
    <div className="flex h-full min-h-0 flex-col text-[12px]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/40 px-2">
        <span className="h-4 w-24 animate-pulse rounded bg-muted" aria-hidden />
        <span className="sr-only">{t('common:loading')}</span>
        <div className="ml-auto">
          {refreshButton}
        </div>
      </div>
      <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-border/50 bg-[var(--bg-1)]">{TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={cn('relative h-9 shrink-0 border-b-2 px-3 text-[12px] transition-colors', tab === item ? 'border-primary bg-[var(--bg-base)] font-medium text-foreground' : 'border-transparent text-foreground-secondary hover:bg-muted hover:text-foreground')} onClick={() => { setTab(item); try { localStorage.setItem(`pi-desktop:git-tab:${workspacePathKey(cwd)}`, item) } catch { void 0 } }}>{t(`common:gitBoard.${item}`)}</button>)}</div>
      <div className="min-h-0 flex-1 overflow-auto p-2" aria-hidden={tab !== 'changes'}>
        {tab === 'changes'
          ? [0, 1, 2, 3, 4].map((index) => <div key={index} className="mb-1.5 h-7 animate-pulse rounded bg-muted" />)
          : <p className="p-2 text-foreground-tertiary">{t('common:loading')}</p>}
      </div>
    </div>
  )
  if (conflictPath) {
    return (
      <div className="flex h-full min-h-0 flex-col text-[12px]">
        <div className="flex h-9 items-center gap-2 border-b px-2"><button type="button" onClick={() => setConflictPath('')}>{t('common:gitBoard.back')}</button><span className="min-w-0 flex-1 truncate">{conflictPath}</span><span>{unresolved ? t('common:gitBoard.remaining', { count: unresolved }) : t('common:gitBoard.allResolved')}</span></div>
        <div className="flex gap-1 border-b px-2 py-1"><button type="button" onClick={() => void run('gitBoard.resolve', { paths: [conflictPath], side: 'ours' }).then(() => setConflictPath(''))}>{t('common:gitBoard.takeWholeOurs')}</button><button type="button" onClick={() => void run('gitBoard.resolve', { paths: [conflictPath], side: 'theirs' }).then(() => setConflictPath(''))}>{t('common:gitBoard.takeWholeTheirs')}</button></div>
        <div className="min-h-0 flex-1 overflow-auto p-2">{nodes.map((node, index) => node.kind === 'text' ? <pre key={index} className="whitespace-pre-wrap text-foreground-tertiary">{node.lines.join('\n')}</pre> : <section key={index} className="mb-3 rounded border p-2"><div className="mb-1 flex justify-between"><span>#{node.index + 1}</span>{choices.has(node.index) ? <button type="button" onClick={() => setChoices((prev) => { const next = new Map(prev); next.delete(node.index); return next })}>{t('common:gitBoard.undo')}</button> : null}</div><div className="grid grid-cols-2 gap-2"><Choice title={node.oursLabel || t('common:gitBoard.ours')} text={node.ours.join('\n')} picked={choices.get(node.index) === 'ours'} onPick={() => setChoices((prev) => new Map(prev).set(node.index, 'ours'))} label={t('common:gitBoard.take')} /><Choice title={node.theirsLabel || t('common:gitBoard.theirs')} text={node.theirs.join('\n')} picked={choices.get(node.index) === 'theirs'} onPick={() => setChoices((prev) => new Map(prev).set(node.index, 'theirs'))} label={t('common:gitBoard.take')} /></div><button type="button" className="mt-1" onClick={() => setChoices((prev) => new Map(prev).set(node.index, 'both'))}>{t('common:gitBoard.takeBoth')}</button></section>)}
        </div>
        <div className="flex justify-end gap-2 border-t p-2"><button type="button" onClick={() => setConflictPath('')}>{t('common:gitBoard.cancel')}</button><button type="button" className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={() => void saveConflict()}>{t('common:gitBoard.saveResolve')}</button></div>
      </div>
    )
  }

  const groups = ['conflict', 'staged', 'unstaged'] as const
  const visibleChanges = data.files
  const hasPendingChanges = visibleChanges.length > 0
  const hasCommitChanges = visibleChanges.length > 0
  // Conflicts are left to the resolve/abort flow: "discard all" must not silently pick a side.
  const discardableChanges = data.files.filter((file) => file.group !== 'conflict')
  const shouldShowPush = !hasCommitChanges && Boolean(data.status.branch) && (data.status.ahead > 0 || !data.status.upstream) && (Boolean(data.status.upstream) || data.remotes.length > 0)
  const localBranches = data.branches.filter((branch) => branch.kind === 'local')
  const remoteBranches = data.branches.filter((branch) => branch.kind === 'remote')
  const branchBaseOptions = [...new Set([data.status.branch, ...localBranches.map((branch) => branch.name), ...remoteBranches.map((branch) => branch.name)].filter(Boolean))]
  const defaultBranchBase = data.status.branch || localBranches[0]?.name || remoteBranches[0]?.name || ''
  const selectedBranchBase = branchBaseOptions.includes(from) ? from : defaultBranchBase
  const pushRemoteOptions = data.remotes
  const selectedRemoteIsAvailable = pushRemoteOptions.some((remote) => remote.name === selectedPushRemote)
  const effectivePushRemote = selectedRemoteIsAvailable ? selectedPushRemote : pushRemoteOptions.length === 1 ? pushRemoteOptions[0].name : ''
  const chooseBranchRemote = (branch: Branch) => {
    const upstreamRemote = branch.upstream?.split('/')[0]
    return upstreamRemote || (pushRemoteOptions.length === 1 ? pushRemoteOptions[0].name : effectivePushRemote)
  }
  const publishBranch = (branch: Branch) => {
    const remote = chooseBranchRemote(branch)
    if (!remote) return toast.error(t('common:gitBoard.selectRemote'))
    return run('gitBoard.remote', { action: 'publish', name: remote, branch: branch.name })
  }
  const pushCurrentBranch = () => {
    if (data.status.upstream) return run('gitBoard.sync', { action: 'push' })
    const currentBranch = localBranches.find((branch) => branch.current)
    return currentBranch ? publishBranch(currentBranch) : toast.error(t('common:gitBoard.detachedHead'))
  }
  const openChangePreview = async (file: Change) => {
    if (file.group === 'conflict') return openConflict(file.path)
    let patch = ''
    if (file.group === 'untracked') {
      const result = await ipcClient.invoke('workspace.fs.readText', { workspaceRoot: cwd, path: file.path, maxBytes: 1_000_000 })
      if (!result?.ok || typeof result.content !== 'string') return toast.error(result?.error || 'read_failed')
      patch = `+++ ${file.path}\n${result.content.split('\n').map((line: string) => `+${line}`).join('\n')}`
    } else {
      const result = await run('gitBoard.diff', { path: file.path, staged: file.group === 'staged' })
      if (!result?.ok) return
      patch = String(result.stdout || '')
    }
    useUIStore.setState({
      workspaceFileToOpen: {
        workspaceRoot: cwd,
        rel: file.path,
        gitDiff: { patch, staged: file.group === 'staged', status: `${file.staged}${file.unstaged}` },
      },
      activePanel: 'files',
    })
    useUIStore.getState().revealRightPanel()
  }
  const discardFiles = (files: Change[], title: string, message: string) => {
    const tracked = files.filter((file) => file.group !== 'untracked').map((file) => file.path)
    const untracked = files.filter((file) => file.group === 'untracked').map((file) => file.path)
    ask(title, message, () => run('gitBoard.discard', { tracked, untracked }))
  }
  const renderFolderActions = (folder: string, _folderFiles: Array<{ path: string }>) => {
    const descendants = data.files.filter((file) => file.path.startsWith(`${folder}/`))
    if (!descendants.length) return null
    const untrackedCount = descendants.filter((file) => file.group === 'untracked').length
    const buttonClass = 'rounded p-1 text-foreground-tertiary opacity-0 transition hover:bg-background hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary'
    return <span className="flex shrink-0 items-center gap-0.5">
      {_folderFiles.some((file) => data.files.find((entry) => entry.path === file.path)?.group !== 'staged') ? <button type="button" className={buttonClass} title={t('common:gitBoard.stageFolder')} aria-label={t('common:gitBoard.stageFolder')} disabled={busy} onClick={() => void run('gitBoard.stage', { paths: descendants.map((file) => file.path) })}><Plus className="h-3.5 w-3.5" /></button> : <button type="button" className={buttonClass} title={t('common:gitBoard.unstageFolder')} aria-label={t('common:gitBoard.unstageFolder')} disabled={busy} onClick={() => void run('gitBoard.unstage', { paths: descendants.map((file) => file.path) })}><Minus className="h-3.5 w-3.5" /></button>}
      <button type="button" className={buttonClass} title={t('common:gitBoard.discardFolder')} aria-label={t('common:gitBoard.discardFolder')} disabled={busy} onClick={() => discardFiles(descendants, t('common:gitBoard.discardFolder'), t('common:gitBoard.discardFolderConfirm', { folder, count: descendants.length, untrackedCount }))}><Trash2 className="h-3.5 w-3.5" /></button>
    </span>
  }
  const renderChangeFile = (file: Change, group: typeof groups[number], depth = 0) => {
    const label = changeView === 'tree' ? file.path.split(/[\\/]/).pop() || file.path : file.path
    return (
      <div key={`${group}:${file.path}`} className="git-change-row flex min-h-7 items-center gap-1 rounded px-1.5 py-0.5 text-[12px]" style={{ paddingLeft: `${depth * 14 + 6}px` }}>
        <span className="w-6 shrink-0 font-mono text-[10px]">{file.group === 'untracked' ? 'U' : `${file.staged}${file.unstaged}`}</span>
        <GitFileIcon path={file.path} />
        <button type="button" className="min-w-0 flex-1 truncate text-left" title={file.path} onClick={() => void openChangePreview(file)}>{label}</button>
        {group === 'conflict' ? <><button type="button" onClick={() => void openConflict(file.path)}>{t('common:gitBoard.resolve')}</button><button type="button" onClick={() => discardFiles([file], t('common:gitBoard.discard'), t('common:gitBoard.discardFileConfirm', { path: file.path }))}>{t('common:gitBoard.discard')}</button></> : file.group === 'untracked' ? <><button type="button" title={t('common:gitBoard.excludeHint')} onClick={() => void run('gitBoard.exclude', { paths: [file.path] })}>{t('common:gitBoard.exclude')}</button><button type="button" onClick={() => void run('gitBoard.stage', { paths: [file.path] })}>{t('common:gitBoard.stage')}</button><button type="button" onClick={() => discardFiles([file], t('common:gitBoard.discard'), t('common:gitBoard.discardFileConfirm', { path: file.path }))}>{t('common:gitBoard.discard')}</button></> : <><button type="button" onClick={() => void run(group === 'staged' ? 'gitBoard.unstage' : 'gitBoard.stage', { paths: [file.path] })}>{t(`common:gitBoard.${group === 'staged' ? 'unstage' : 'stage'}`)}</button><button type="button" onClick={() => discardFiles([file], t('common:gitBoard.discard'), t('common:gitBoard.discardFileConfirm', { path: file.path }))}>{t('common:gitBoard.discard')}</button></>}
      </div>
    )
  }
  const checkoutBranch = (branch: Branch) => {
    if (branch.kind !== 'remote') return run('gitBoard.checkout', { ref: branch.name })
    const localName = branch.name.slice(branch.name.indexOf('/') + 1)
    const local = data.branches.find((item) => item.kind === 'local' && item.name === localName)
    return local
      ? run('gitBoard.checkout', { ref: local.name })
      : run('gitBoard.branch', { action: 'track', name: localName, from: branch.name })
  }
  const deleteRemoteBranch = (branch: Branch) => {
    const separator = branch.name.indexOf('/')
    if (separator < 1) return toast.error(t('common:gitBoard.invalidRemote'))
    return ask(t('common:gitBoard.deleteRemoteBranch'), branch.name, () => run('gitBoard.remote', {
      action: 'deleteBranch',
      name: branch.name.slice(0, separator),
      branch: branch.name.slice(separator + 1),
    }))
  }
  /** 先 pull 再 push：一键把本地和远端对齐，不需要先有提交内容 */
  const syncBoth = async () => {
    if (!cwd || busy) return
    setBusy(true)
    try {
      const pull = await git<Record<string, unknown>>('gitBoard.sync', { cwd, action: 'pull' })
      if (!pull.ok) throw new Error(pull.error || 'git_failed')
      clearRemoteCheck()
      await load(false)
      const push = await git<Record<string, unknown>>('gitBoard.sync', { cwd, action: 'push' })
      if (!push.ok) throw new Error(push.error || 'git_failed')
      toast.success(t('common:gitBoard.syncDone'))
      await load(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const syncActions: Array<[string, () => void]> = [
    [t('common:gitBoard.pull'), () => void run('gitBoard.sync', { action: 'pull' })],
    [t('common:gitBoard.sync'), () => void syncBoth()],
    [t('common:gitBoard.push'), () => void run('gitBoard.sync', { action: 'push' })],
  ]
  const remotePicker = (always = false) => (always || !data.status.upstream) && data.remotes.length > 1 ? (
    <label className="flex items-center gap-2 rounded border border-border/50 px-2 py-1 text-[11px] text-foreground-secondary">
      <span>{t('common:gitBoard.pushTarget')}</span>
      <select aria-label={t('common:gitBoard.pushTarget')} value={effectivePushRemote} onChange={(event) => setSelectedPushRemote(event.target.value)} className="min-w-0 bg-transparent text-foreground">
        <option value="">{t('common:gitBoard.selectRemote')}</option>
        {data.remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}
      </select>
    </label>
  ) : null
  return (
    <div className="git-board flex h-full min-h-0 flex-col" onClick={() => setMenu(null)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3 text-[12px]">
        <GitCommitHorizontal className="h-4 w-4 text-foreground-secondary" />
        <button
          ref={branchAnchor}
          type="button"
          className={cn(
            'flex min-w-0 max-w-[16rem] items-center gap-1 rounded px-1.5 py-0.5 font-medium',
            'hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
            data.status.branch ? 'cursor-pointer' : 'cursor-default',
          )}
          aria-haspopup="dialog"
          aria-expanded={branchPickerOpen}
          aria-label={t('common:branches.trigger', { branch: data.status.branch || 'HEAD' })}
          title={t('common:branches.trigger', { branch: data.status.branch || 'HEAD' })}
          disabled={!data.status.branch}
          onClick={() => setBranchPickerOpen((v) => !v)}
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
          <strong className="truncate font-medium">{data.status.branch || 'HEAD'}</strong>
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground-tertiary" />
        </button>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span
            className={cn(data.status.ahead > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-foreground-tertiary')}
            title={t('common:gitBoard.ahead', { n: data.status.ahead })}
          >
            {data.status.ahead}↑
          </span>
          <span
            className={cn(data.status.behind > 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-foreground-tertiary')}
            title={t('common:gitBoard.behindCached', { n: data.status.behind })}
          >
            {data.status.behind}↓
          </span>
        </span>
        {data.operation ? <span className="rounded bg-amber-500/15 px-1.5 text-amber-700">{data.operation}</span> : null}
        <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
          <button type="button" disabled={busy || data.remotes.length === 0} onClick={() => void checkRemote()}
            className="shrink-0 rounded border border-border/60 px-2 py-0.5 text-[12px] hover:bg-muted disabled:opacity-40">
            {t('common:gitBoard.checkRemote')}
          </button>
          {syncActions.map(([label, action]) => (
            <button
              key={label}
              type="button"
              disabled={busy}
              className="rounded border border-border/60 px-2 py-0.5 text-[12px] text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              onClick={action}
            >
              {label}
            </button>
          ))}
          {refreshButton}
        </div>
      </div>
      {data.remotes.length > 0 && (
        <div className="shrink-0 border-b border-border/50 px-3 py-1.5 text-[11px] text-foreground-secondary" aria-live="polite">
          {!remoteCheck ? t('common:gitBoard.remoteUnchecked') : remoteCheck.error
            ? <span className="break-words text-destructive">{t('common:gitBoard.remoteCheckFailed', { error: remoteCheck.error })}</span>
            : (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span>{t('common:gitBoard.remoteCheckedAt', { time: new Date(remoteCheck.checkedAt).toLocaleTimeString() })}</span>
                {remoteCheck.incoming?.length ? (
                  <details className="min-w-0">
                    <summary className="cursor-pointer">{t('common:gitBoard.remoteIncoming', { count: remoteCheck.incomingCount ?? remoteCheck.incoming.length })}</summary>
                    <ul className="max-h-36 overflow-auto pt-1">
                      {remoteCheck.incoming.map((commit) => (
                        <li key={commit.hash} className="flex gap-2"><code>{commit.hash}</code><span className="break-words">{commit.subject}</span></li>
                      ))}
                    </ul>
                  </details>
                ) : <span>{t(remoteCheck.tracking ? 'common:gitBoard.remoteCurrent' : 'common:gitBoard.remoteUntracked')}</span>}
              </div>
            )}
        </div>
      )}
      <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-border/50 bg-[var(--bg-1)]">{TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={cn('relative h-9 shrink-0 border-b-2 px-3 text-[12px] transition-colors', tab === item ? 'border-primary bg-[var(--bg-base)] font-medium text-foreground' : 'border-transparent text-foreground-secondary hover:bg-muted hover:text-foreground')} onClick={() => { setTab(item); try { localStorage.setItem(`pi-desktop:git-tab:${workspacePathKey(cwd)}`, item) } catch { void 0 } }}>{t(`common:gitBoard.${item}`)}{item === 'changes' && visibleChanges.length ? <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{visibleChanges.length}</span> : null}</button>)}</div>
      {tab === 'advanced' && <div role="tablist" aria-label={t('common:gitBoard.advanced')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-1">{REPOSITORY_TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={repositoryTab === item} className={cn('shrink-0 rounded px-2 py-1 text-[12px]', repositoryTab === item ? 'bg-muted font-medium text-foreground' : 'text-foreground-secondary hover:bg-muted')} onClick={() => setRepositoryTab(item)}>{t(`common:gitBoard.${item}`)}</button>)}</div>}
      {tab === 'changes' && !data.status.upstream && !data.remotes.length ? <p className="border-b border-border/40 px-3 py-2 text-[11px] text-foreground-tertiary">{t('common:gitBoard.addRemoteBeforePush')}</p> : null}
      {restError ? <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px] text-destructive"><span className="min-w-0 flex-1 truncate">{restError}</span><button type="button" className="shrink-0 rounded border px-2 py-0.5 text-foreground-secondary hover:bg-muted" onClick={() => void load(false)}>{t('common:gitBoard.refresh')}</button></div> : null}
      {tab === 'changes' && !data.status.branch ? <p className="border-b border-border/40 px-3 py-2 text-[11px] text-foreground-tertiary">{t('common:gitBoard.detachedHead')}</p> : null}
      {tab === 'changes' && !data.status.upstream ? remotePicker() : null}
      {data.operation ? <div className="flex gap-1 border-b px-2 py-1"><button type="button" className="rounded border px-2 py-1 text-[12px]" onClick={() => void run('gitBoard.operation', { operation: data.operation, action: 'continue' })}>{t('common:gitBoard.continue')}</button><button type="button" className="rounded border px-2 py-1 text-[12px]" onClick={() => void run('gitBoard.operation', { operation: data.operation, action: 'abort' })}>{t('common:gitBoard.abort')}</button></div> : null}

      {tab === 'changes' && <div className="git-changes flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--bg-1)] px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[12px] font-medium">{t('common:gitBoard.unstaged')}</span>
            <div role="group" aria-label={t('common:gitBoard.changeView')} className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-[var(--bg-base)] p-0.5">
              <button type="button" aria-label={t('common:gitBoard.listView')} aria-pressed={changeView === 'list'} className={cn('inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors hover:bg-muted', changeView === 'list' && 'bg-muted text-foreground shadow-sm')} onClick={() => setChangeView('list')}><Rows2 className="h-3.5 w-3.5" />{t('common:gitBoard.listView')}</button>
              <button type="button" aria-label={t('common:gitBoard.treeView')} aria-pressed={changeView === 'tree'} className={cn('inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors hover:bg-muted', changeView === 'tree' && 'bg-muted text-foreground shadow-sm')} onClick={() => setChangeView('tree')}><FolderTree className="h-3.5 w-3.5" />{t('common:gitBoard.treeView')}</button>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <button type="button" disabled={!discardableChanges.length || busy} className="whitespace-nowrap text-[11px] text-foreground-secondary hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400" onClick={() => discardFiles(discardableChanges, t('common:gitBoard.discardAll'), t('common:gitBoard.discardAllConfirm', { count: discardableChanges.length, untrackedCount: discardableChanges.filter((file) => file.group === 'untracked').length }))}>{t('common:gitBoard.discardAll')}</button>
            <button type="button" disabled={!data.files.some((file) => file.group !== 'conflict' && file.group !== 'staged') || busy} className="whitespace-nowrap text-[11px] text-foreground-secondary hover:text-foreground disabled:opacity-40" onClick={() => void run('gitBoard.stage', { paths: data.files.filter((file) => file.group !== 'conflict' && file.group !== 'staged').map((file) => file.path) })}>{t('common:gitBoard.stageAll')}</button>
          </div>
        </div>
        {groups.map((group) => {
          const files = data.files.filter((file) => group === 'unstaged' ? file.group === 'unstaged' || file.group === 'untracked' : file.group === group)
          if (!files.length) return null
          return <section key={group} className="mb-3">{group !== 'unstaged' ? <div className="mb-1 flex items-center text-[11px] text-foreground-tertiary"><span>{t(`common:gitBoard.${group}`)}</span>{group === 'staged' ? <button type="button" className="ml-auto" onClick={() => void run('gitBoard.unstageAll')}>{t('common:gitBoard.unstageAll')}</button> : null}</div> : null}{changeView === 'list' ? files.map((file) => renderChangeFile(file, group)) : <GitChangesTree files={files} renderFile={(file, depth) => renderChangeFile(file as Change, group, depth)} renderFolderActions={group === 'conflict' ? undefined : renderFolderActions} />}</section>
        })}{!visibleChanges.length && <p className="p-2 text-[12px] text-foreground-tertiary">{t('common:gitBoard.noTrackedChanges')}</p>}</div><div className="border-t p-2"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t('common:gitBoard.commitPlaceholder')} className="h-32 w-full resize-y rounded border bg-transparent p-2 text-[12px]" /><div className="mt-1 flex flex-wrap items-center gap-1">
<button type="button" disabled={busy || suggesting} className="rounded border px-2 py-1 text-[12px]" onClick={() => void suggestCommit()}>{suggesting ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 inline h-3 w-3" />}{t(suggesting ? 'common:gitBoard.generating' : 'common:gitBoard.suggest')}</button>
<button type="button" disabled={busy} aria-label={t('common:gitBoard.promptSettings')} title={t('common:gitBoard.promptSettings')} className="rounded border p-1.5 text-foreground-secondary hover:bg-muted" onClick={() => { setPromptDraft(commitPrompt); setPromptOpen(true) }}><Settings className="h-3.5 w-3.5" /></button>
{hasCommitChanges ? <>
<button type="button" disabled={busy || suggesting || !message.trim()} className="ml-auto rounded bg-primary px-2.5 py-1.5 text-[12px] text-primary-foreground disabled:opacity-50" onClick={() => void commit('stage-and-commit')}>{commitAction === 'stage-and-commit' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : commitComplete === 'stage-and-commit' ? <Check className="mr-1 inline h-3 w-3" /> : null}{t('common:gitBoard.commit')}</button>
{data.status.branch ? <button type="button" disabled={busy || suggesting || !message.trim()} className="rounded border border-primary/40 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-primary/5 disabled:opacity-50" onClick={() => void commit('commit-and-push')}>{commitAction === 'commit-and-push' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : commitComplete === 'commit-and-push' ? <Check className="mr-1 inline h-3 w-3" /> : null}{t('common:gitBoard.commitPush')}</button> : null}
</> : shouldShowPush ? <button type="button" disabled={busy || (!data.status.upstream && !effectivePushRemote)} className="ml-auto rounded bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50" onClick={() => void pushCurrentBranch()}>{t(data.status.upstream ? 'common:gitBoard.push' : 'common:gitBoard.publish')}</button> : hasPendingChanges ? <span className="ml-auto text-[11px] text-foreground-tertiary">{t('common:gitBoard.stageFilesBeforeCommit')}</span> : <span className="ml-auto text-[11px] text-foreground-tertiary">{data.status.behind > 0 ? t('common:gitBoard.behind', { n: data.status.behind }) : t('common:gitBoard.clean')}</span>}
</div></div></div>}

      {tab === 'graph' && <div className="flex min-h-0 flex-1 flex-col"><div className="flex gap-1 border-b p-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('common:gitBoard.refFilter')} className="h-7 min-w-0 flex-1 rounded border bg-transparent px-2 text-[12px]" /><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={t('common:gitBoard.authorFilter')} className="h-7 w-28 rounded border bg-transparent px-2 text-[12px]" /><button type="button" className="rounded border px-2 text-[12px]" onClick={() => void load(false)}>{t('common:gitBoard.filter')}</button></div><div className="relative min-h-0 flex-1 overflow-auto">{rows.map((row) => <div key={row.commit.hash} role="button" tabIndex={0} className="flex h-7 cursor-pointer items-center gap-2 pr-2 text-[12px] hover:bg-muted/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary" onClick={() => void openCommitDetail(row.commit.hash)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openCommitDetail(row.commit.hash) } }} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, commit: row.commit }) }}><GitLane lane={row.lane} passes={row.passes} links={row.links} columns={row.columns} fromAbove={row.fromAbove} /><CommitDate time={row.commit.time} /><span className="w-24 shrink-0 truncate text-[11px] text-foreground-secondary" title={row.commit.author}>{row.commit.author}</span><span className="min-w-0 flex-1 truncate">{row.commit.subject}</span></div>)}{data.hasMore ? <button type="button" className="m-2 rounded border px-2 py-1 text-[12px]" onClick={() => void load(true)}>{t('common:gitBoard.more')}</button> : null}</div>{detail && <CommitDetailDialog detail={detail} diff={diff} onClose={() => { setDetail(null); setDiff('') }} onOpenDiff={(path) => void openDiff(path, { commit: detail.hash })} onCheckout={async () => { const result = await run('gitBoard.checkoutCommit', { ref: detail.hash }); if (!result?.ok) return false; setDiff(''); await load(false); return true }} />}</div>}

      {tab === 'branches' && <div className="flex min-h-0 flex-1 flex-col text-[12px]">
        <form className="shrink-0 border-b border-border/60 p-3" onSubmit={(event) => { event.preventDefault(); if (name.trim()) void run('gitBoard.branch', { action: 'create', name, ...(selectedBranchBase ? { from: selectedBranchBase } : {}) }).then((result) => { if (result?.ok) setName('') }) }}>
          <div className="mb-2 text-[12px] font-medium">{t('common:gitBoard.createBranch')}</div>
          <div className="flex flex-wrap gap-2">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('common:gitBoard.branchNameOnly')} className="h-8 min-w-0 flex-1 rounded border border-border bg-[var(--bg-1)] px-2 outline-none focus:border-primary" />
            <select value={selectedBranchBase} onChange={(event) => setFrom(event.target.value)} className="h-8 min-w-0 flex-1 rounded border border-border bg-[var(--bg-1)] px-2">
              {branchBaseOptions.map((ref) => <option key={ref} value={ref}>{ref === data.status.branch ? `${ref} · ${t('common:gitBoard.currentBranch')}` : ref}</option>)}
            </select>
            <button type="submit" disabled={busy || !name.trim()} className="h-8 rounded bg-primary px-3 text-primary-foreground disabled:opacity-50">{t('common:gitBoard.create')}</button>
          </div>
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <section>
            <div className="mb-2 flex items-center gap-2 font-medium"><span>{t('common:gitBoard.localBranch')}</span><span className="text-[11px] font-normal text-foreground-tertiary">{localBranches.length}</span></div>
            {localBranches.length ? localBranches.map((branch) => <Row key={`local:${branch.name}`} title={`${branch.current ? '● ' : ''}${branch.name}`} meta={`${branch.upstream ? `${t('common:gitBoard.tracks')} ${branch.upstream} · ` : t('common:gitBoard.noUpstream')} ${branch.ahead}↑ ${branch.behind}↓`} actions={[
              ...(!branch.current ? [[t('common:gitBoard.checkout'), () => run('gitBoard.checkout', { ref: branch.name })] as [string, () => unknown]] : []),
              ...(!branch.upstream ? [[t('common:gitBoard.publish'), () => publishBranch(branch)] as [string, () => unknown]] : []),
              ...(!branch.current ? [[t('common:gitBoard.delete'), () => removeBranch(branch.name)] as [string, () => unknown]] : []),
            ]} />) : <p className="py-2 text-foreground-tertiary">{t('common:gitBoard.noLocalBranches')}</p>}
          </section>
          <section className="mt-4 border-t border-border/60 pt-3">
            <div className="mb-2 flex items-center gap-2 font-medium"><span>{t('common:gitBoard.remoteBranch')}</span><span className="text-[11px] font-normal text-foreground-tertiary">{remoteBranches.length}</span>{data.remotes.length > 1 ? <span className="ml-auto">{remotePicker(true)}</span> : null}</div>
            {remoteBranches.length ? remoteBranches.map((branch) => <Row key={`remote:${branch.name}`} title={branch.name} meta={`${branch.ahead}↑ ${branch.behind}↓`} actions={[[t('common:gitBoard.checkout'), () => checkoutBranch(branch)], [t('common:gitBoard.deleteRemoteBranch'), () => deleteRemoteBranch(branch)]]} />) : <p className="py-2 text-foreground-tertiary">{t('common:gitBoard.noRemoteBranches')}</p>}
          </section>
        </div>
      </div>}
      {tab === 'advanced' && repositoryTab === 'stash' && <div className="flex min-h-0 flex-1 flex-col text-[12px]">
        <form className="git-manager-form shrink-0 space-y-3" onSubmit={(event) => { event.preventDefault(); void run('gitBoard.stash', { action: 'save', message: stashMessage, includeUntracked }).then((result) => { if (result?.ok) setStashMessage('') }) }}>
          <div className="flex flex-wrap gap-2"><input value={stashMessage} maxLength={500} onChange={(event) => setStashMessage(event.target.value)} placeholder={t('common:gitBoard.stashMessagePlaceholder')} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none transition focus:border-primary" /><button type="submit" disabled={busy || !data.files.length} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"><Archive className="h-3.5 w-3.5" />{t('common:gitBoard.saveStash')}</button></div>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-foreground-secondary"><input type="checkbox" checked={includeUntracked} onChange={(event) => setIncludeUntracked(event.target.checked)} className="accent-primary" />{t('common:gitBoard.includeUntracked')}</label>
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-2">{data.stashes.map((stash) => <Row key={stash.ref} title={stash.ref} meta={stash.message} actions={[[t('common:gitBoard.applyStash'), () => run('gitBoard.stash', { action: 'apply', ref: stash.ref })], [t('common:gitBoard.stashPop'), () => ask(t('common:gitBoard.stashPop'), t('common:gitBoard.stashPopConfirm', { ref: stash.ref }), () => run('gitBoard.stash', { action: 'pop', ref: stash.ref }))], [t('common:gitBoard.dropStash'), () => ask(t('common:gitBoard.dropStash'), t('common:gitBoard.dropStashConfirm', { ref: stash.ref }), () => run('gitBoard.stash', { action: 'drop', ref: stash.ref }))]]} />)}{!data.stashes.length ? <ManagerEmpty>{t('common:gitBoard.emptyStashes')}</ManagerEmpty> : null}</div>
      </div>}
      {tab === 'advanced' && repositoryTab === 'tags' && <div className="flex min-h-0 flex-1 flex-col text-[12px]">
        <form className="git-manager-form shrink-0 space-y-2" onSubmit={(event) => { event.preventDefault(); void run('gitBoard.tag', { action: 'create', name: tagName.trim(), ...(tagTarget.trim() ? { target: tagTarget.trim() } : {}), ...(tagMessage.trim() ? { message: tagMessage.trim() } : {}) }).then((result) => { if (result?.ok) { setTagName(''); setTagMessage('') } }) }}>
          <div className="flex gap-2"><input value={tagName} maxLength={250} onChange={(event) => setTagName(event.target.value)} placeholder={t('common:gitBoard.tagName')} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none transition focus:border-primary" /><button type="submit" disabled={busy || !tagName.trim()} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{t('common:gitBoard.createTag')}</button></div>
          <details open={tagAdvancedOpen} onToggle={(event) => setTagAdvancedOpen(event.currentTarget.open)} className="text-foreground-secondary"><summary className="w-fit cursor-pointer select-none rounded px-1 py-1 hover:bg-muted">{t('common:gitBoard.tagAdvanced')}</summary><div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={tagTarget} maxLength={300} onChange={(event) => setTagTarget(event.target.value)} placeholder={t('common:gitBoard.tagTargetPlaceholder')} className="h-8 min-w-0 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none transition focus:border-primary" /><input value={tagMessage} maxLength={1000} onChange={(event) => setTagMessage(event.target.value)} placeholder={t('common:gitBoard.tagMessage')} className="h-8 min-w-0 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none transition focus:border-primary" /></div></details>
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-2">{data.tags.map((tag) => <Row key={tag} title={tag} actions={[
          ...(data.remotes.length ? [[t('common:gitBoard.pushTag'), () => run('gitBoard.tag', { action: 'push', name: tag, remote: data.remotes.find((remote) => remote.name === 'origin')?.name || data.remotes[0].name })] as [string, () => unknown]] : []),
          [t('common:gitBoard.deleteTag'), () => ask(t('common:gitBoard.deleteTag'), t('common:gitBoard.deleteTagConfirm', { name: tag }), () => run('gitBoard.tag', { action: 'delete', name: tag }))],
        ]} />)}{!data.tags.length ? <ManagerEmpty>{t('common:gitBoard.emptyTags')}</ManagerEmpty> : null}</div>
      </div>}
      {tab === 'advanced' && repositoryTab === 'remotes' && <div className="flex min-h-0 flex-1 flex-col text-[12px]">
        <div className="git-manager-form shrink-0 space-y-3">
          <div className="inline-flex w-fit rounded-lg border border-border/60 bg-[var(--bg-1)] p-1">{(['add', 'url', 'rename'] as const).map((mode) => <button key={mode} type="button" aria-pressed={remoteFormMode === mode} onClick={() => { setRemoteFormMode(mode); setRemoteTarget(data.remotes[0]?.name || ''); setRemoteNewName(''); setRemoteNewUrl('') }} className={cn('rounded-md px-2.5 py-1.5 text-[11px] transition', remoteFormMode === mode ? 'bg-[var(--bg-base)] font-medium text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground')}>{t(`common:gitBoard.remoteMode.${mode}`)}</button>)}</div>
          <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void submitRemoteForm() }}>
            {remoteFormMode !== 'add' ? <select value={data.remotes.some((remote) => remote.name === remoteTarget) ? remoteTarget : data.remotes[0]?.name || ''} onChange={(event) => setRemoteTarget(event.target.value)} className="h-9 min-w-32 rounded-md border border-border bg-[var(--bg-1)] px-2.5 outline-none focus:border-primary" disabled={!data.remotes.length}>{data.remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}</select> : <input value={remoteNewName} maxLength={250} onChange={(event) => setRemoteNewName(event.target.value)} placeholder={t('common:gitBoard.remoteName')} className="h-9 min-w-32 flex-1 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none focus:border-primary" />}
            {remoteFormMode !== 'rename' ? <input value={remoteNewUrl} maxLength={1000} onChange={(event) => setRemoteNewUrl(event.target.value)} placeholder={t('common:gitBoard.remoteUrl')} className="h-9 min-w-40 flex-[2] rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none focus:border-primary" /> : <input value={remoteNewName} maxLength={250} onChange={(event) => setRemoteNewName(event.target.value)} placeholder={t('common:gitBoard.remoteNewName')} className="h-9 min-w-32 flex-1 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none focus:border-primary" />}
            <button type="submit" disabled={busy || (remoteFormMode !== 'add' && !data.remotes.length) || (remoteFormMode === 'add' ? !remoteNewName.trim() || !remoteNewUrl.trim() : remoteFormMode === 'url' ? !remoteNewUrl.trim() : !remoteNewName.trim())} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{t(`common:gitBoard.remoteAction.${remoteFormMode}`)}</button>
          </form>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">{data.remotes.map((remote) => <Row key={remote.name} title={remote.name} meta={remote.fetch} actions={[[t('common:gitBoard.removeRemote'), () => ask(t('common:gitBoard.removeRemote'), t('common:gitBoard.removeRemoteConfirm', { name: remote.name }), () => run('gitBoard.remote', { action: 'remove', name: remote.name }))]]} />)}{!data.remotes.length ? <ManagerEmpty>{t('common:gitBoard.emptyRemotes')}</ManagerEmpty> : null}
          <details className="git-manager-card mt-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><CloudDownload className="h-4 w-4 text-foreground-secondary" />{t('common:gitBoard.cloneOtherRepository')}</summary>
            <div className="mt-3 grid gap-2">
              <input value={cloneUrl} onChange={(event) => { const value = event.target.value; setCloneUrl(value); if (cloneParentPath) { const repoName = value.trim().split(/[\\/:]/).pop()?.replace(/\.git$/i, '') || 'repository'; setCloneTargetPath(joinChildPath(cloneParentPath, repoName)) } }} placeholder={t('common:gitBoard.cloneUrl')} className="h-9 min-w-0 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none focus:border-primary" />
              <div className="flex min-w-0 gap-2"><input value={cloneTargetPath} onChange={(event) => { setCloneTargetPath(event.target.value); setCloneParentPath('') }} placeholder={t('common:gitBoard.cloneDestination')} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none focus:border-primary" /><button type="button" className="h-9 rounded-md border border-border px-2.5 hover:bg-muted" onClick={() => void browseCloneDestination()}>{t('common:gitBoard.browse')}</button></div>
              <div className="flex justify-end"><button type="button" disabled={busy || !cloneUrl.trim() || !cloneTargetPath.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 transition hover:bg-muted disabled:opacity-50" onClick={() => void run('gitBoard.clone', { url: cloneUrl, path: cloneTargetPath }).then(async (result) => { if (result?.path) { setCloneUrl(''); setCloneTargetPath(''); setCloneParentPath(''); await activateWorkspace(String(result.path), { preferHome: true }) } })}><CloudDownload className="h-3.5 w-3.5" />{t('common:gitBoard.clone')}</button></div>
            </div>
          </details>
        </div>
      </div>}
      {tab === 'advanced' && repositoryTab === 'worktrees' && <div className="flex min-h-0 flex-1 flex-col text-[12px]">
        <form className="git-manager-form shrink-0 space-y-3" onSubmit={(event) => { event.preventDefault(); void run('gitBoard.worktree', { action: 'add', path: worktreePath.trim(), branch: worktreeBranch.trim(), create: true }).then((result) => { if (result?.ok) { setWorktreeBranch(''); setWorktreePath(''); setWorktreeParentPath('') } }) }}>
          <div className="text-[11px] text-foreground-secondary">{t('common:gitBoard.worktreeCreateHint')}</div>
          <div className="flex flex-wrap gap-2"><input value={worktreeBranch} maxLength={250} onChange={(event) => { const value = event.target.value; setWorktreeBranch(value); if (worktreeParentPath) setWorktreePath(joinChildPath(worktreeParentPath, value.trim() || 'worktree')) }} placeholder={t('common:gitBoard.newBranchName')} className="h-9 min-w-32 flex-1 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none focus:border-primary" /><div className="flex min-w-40 flex-[2] gap-2"><input value={worktreePath} onChange={(event) => { setWorktreePath(event.target.value); setWorktreeParentPath('') }} placeholder={t('common:gitBoard.worktreeDestination')} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-[var(--bg-1)] px-3 outline-none focus:border-primary" /><button type="button" className="h-9 rounded-md border border-border px-2.5 hover:bg-muted" onClick={() => void browseWorktree()}>{t('common:gitBoard.browse')}</button></div><button type="submit" disabled={busy || !worktreeBranch.trim() || !worktreePath.trim()} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"><GitBranchPlus className="h-3.5 w-3.5" />{t('common:gitBoard.addWorktree')}</button></div>
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-2">{data.worktrees.map((tree) => <Row key={tree.path} title={tree.path} meta={tree.branch || tree.head} primaryAction={[t('common:gitBoard.openWorktree'), () => activateWorkspace(tree.path, { preferHome: true })]} actions={workspacePathKey(tree.path) === workspacePathKey(cwd) ? [] : [[t('common:gitBoard.removeWorktree'), () => ask(t('common:gitBoard.removeWorktree'), t('common:gitBoard.removeWorktreeConfirm', { path: tree.path }), () => run('gitBoard.worktree', { action: 'remove', path: tree.path }))]]} />)}{!data.worktrees.length ? <ManagerEmpty>{t('common:gitBoard.emptyWorktrees')}</ManagerEmpty> : null}</div>
      </div>}

      
      {tab === 'log' && <GitCommandHistory entries={commandLog} onRefresh={loadLog} onClear={async () => { await ipcClient.invoke('gitBoard.clearLog', { cwd }); await loadLog() }} />}{menu && <div className="fixed z-[700] min-w-40 rounded border bg-popover p-1 text-[12px] shadow-lg" style={{ left: menu.x, top: menu.y }}>{[
        [t('common:gitBoard.checkout'), () => run('gitBoard.checkout', { ref: menu.commit.hash })],
        [t('common:gitBoard.createBranch'), () => run('gitBoard.branch', { action: 'create', name: name || `branch-${menu.commit.short}`, from: menu.commit.hash })],
        [t('common:gitBoard.cherryPick'), () => run('gitBoard.cherryPick', { ref: menu.commit.hash })],
        [t('common:gitBoard.revert'), () => run('gitBoard.revert', { ref: menu.commit.hash })],
        [t('common:gitBoard.resetSoft'), () => run('gitBoard.reset', { hash: menu.commit.hash, mode: 'soft' })],
        [t('common:gitBoard.resetMixed'), () => run('gitBoard.reset', { hash: menu.commit.hash, mode: 'mixed' })],
        [t('common:gitBoard.resetHard'), () => ask(t('common:gitBoard.resetHard'), menu.commit.subject, () => run('gitBoard.reset', { hash: menu.commit.hash, mode: 'hard' }))],
        [t('common:gitBoard.copy'), () => navigator.clipboard.writeText(menu.commit.hash)],
      ].map(([label, action]) => <button key={String(label)} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-muted" onClick={() => { setMenu(null); void (action as () => unknown)() }}>{String(label)}</button>)}</div>}
      {promptOpen && createPortal(<div role="dialog" aria-modal="true" aria-label={t('common:gitBoard.promptSettings')} className="fixed inset-0 z-[800] flex items-center justify-center bg-black/40 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setPromptOpen(false) }} onKeyDown={(event) => { if (event.key === 'Escape') setPromptOpen(false) }}><div className="w-full max-w-lg rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"><h2 className="mb-2 font-semibold">{t('common:gitBoard.promptSettings')}</h2><textarea autoFocus value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} maxLength={8000} className="h-40 w-full resize-y rounded border bg-transparent p-2 text-[12px]" /><div className="mt-3 flex gap-2"><button type="button" className="rounded border px-3 py-1.5 text-[12px]" onClick={() => setPromptDraft(DEFAULT_COMMIT_PROMPT)}>{t('common:gitBoard.promptReset')}</button><button type="button" className="ml-auto rounded px-3 py-1.5 text-[12px] hover:bg-muted" onClick={() => setPromptOpen(false)}>{t('common:cancel')}</button><button type="button" className="rounded bg-primary px-3 py-1.5 text-[12px] text-primary-foreground" onClick={() => { const value = promptDraft.trim() || DEFAULT_COMMIT_PROMPT; setCommitPrompt(value); try { localStorage.setItem('pi-desktop:git-commit-prompt', value) } catch { void 0 }; setPromptOpen(false) }}>{t('common:gitBoard.promptSave')}</button></div></div></div>, document.body)}
      <ConfirmDialog open={!!confirm} title={confirm?.title || ''}  message={confirm?.message || ''}  destructive onConfirm={() => void confirm?.run()} onCancel={() => setConfirm(null)} />
      {branchPickerOpen && data.status.branch ? (
        <BranchPickerPopover
          cwd={cwd}
          status={pickerStatus}
          anchorRef={branchAnchor}
          onClose={closeBranchPicker}
          onSwitched={() => void load(false)}
        />
      ) : null}
    </div>
  )
}

function selectedPath(patch: string) { return patch.match(/^diff --git a\/(.+) b\//m)?.[1] || '' }
function Choice({ title, text, picked, onPick, label }: { title: string; text: string; picked: boolean; onPick: () => void; label: string }) {
  return <div className={cn('rounded border p-1', picked && 'border-primary')}><div className="mb-1 flex justify-between"><span className="truncate">{title}</span><button type="button" onClick={onPick}>{label}</button></div><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{text || '—'}</pre></div>
}
function ManagerEmpty({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-4 text-center text-[12px] text-foreground-tertiary">{children}</div>
}
function Row({ title, meta, actions, primaryAction }: { title: string; meta?: string; actions: Array<[string, () => unknown]>; primaryAction?: [string, () => unknown] }) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [menu])
  return <div className="git-manager-card group flex min-h-12 items-center gap-2"><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium" title={title}>{title}</div>{meta ? <div className="truncate text-[11px] text-foreground-tertiary" title={meta}>{meta}</div> : null}</div>{primaryAction ? <button type="button" className="shrink-0 rounded-md border border-border/70 px-2.5 py-1.5 text-[11px] font-medium text-foreground-secondary transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground" onClick={() => void primaryAction[1]() }>{primaryAction[0]}</button> : null}{actions.length ? <button type="button" aria-label={t('common:gitBoard.rowActions', { name: title })} aria-haspopup="menu" aria-expanded={!!menu} className="shrink-0 rounded-md p-1.5 text-foreground-secondary transition hover:bg-muted hover:text-foreground" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ left: Math.max(8, Math.min(box.right - 160, window.innerWidth - 168)), top: Math.max(8, Math.min(box.bottom, window.innerHeight - actions.length * 36 - 16)) }) }}><MoreHorizontal className="h-4 w-4" /></button> : null}{menu ? createPortal(<div role="menu" className="fixed z-[700] min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl" style={{ left: menu.left, top: menu.top }} onPointerDown={(event) => event.stopPropagation()}>{actions.map(([label, action]) => <button key={label} type="button" role="menuitem" className="block w-full rounded-md px-2.5 py-2 text-left text-[12px] transition hover:bg-muted" onClick={() => { setMenu(null); void action() }}>{label}</button>)}</div>, document.body) : null}</div>
}

function CommitDetailDialog({ detail, diff, onClose, onCheckout, onOpenDiff }: {
  detail: Detail
  diff: string
  onClose: () => void
  onCheckout: () => Promise<boolean>
  onOpenDiff: (path: string) => void
}) {
  const { t } = useTranslation()
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const close = () => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, 170)
  }
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }, [])
  const checkout = async () => { if (await onCheckout()) close() }
  return createPortal(
    <div
      data-state={closing ? 'closing' : 'open'}
      className="git-commit-backdrop electron-no-drag fixed inset-0 z-[800] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[3px] sm:p-6"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}
      onKeyDown={(event) => { if (event.key === 'Escape') close() }}
    >
      <section
        data-state={closing ? 'closing' : 'open'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-commit-dialog-title"
        className="git-commit-dialog flex max-h-[min(88vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-popover text-popover-foreground shadow-[0_24px_80px_rgba(0,0,0,0.38)] ring-1 ring-white/10"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><GitCommitHorizontal className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="git-commit-dialog-title" className="break-words text-[15px] font-semibold leading-6">{detail.subject}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-tertiary">
              <span>{detail.author}</span><span aria-hidden>·</span><time dateTime={new Date(detail.time * 1000).toISOString()}>{new Date(detail.time * 1000).toLocaleString()}</time>
              <code className="rounded-md border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono">{detail.hash.slice(0, 12)}</code>
            </div>
          </div>
          <button type="button" autoFocus aria-label={t('common:gitBoard.close')} title={t('common:gitBoard.close')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-tertiary transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={close}><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {detail.body ? <div className="mb-4 whitespace-pre-wrap break-words border-l-2 border-primary/30 pl-3 text-[12px] leading-6 text-foreground-secondary">{detail.body}</div> : <p className="mb-4 text-[12px] text-foreground-tertiary">{t('common:gitBoard.noCommitDescription')}</p>}
          <details className="group overflow-hidden rounded-xl border border-border/70 bg-background/50">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[12px] transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
              <FileText className="h-4 w-4 text-foreground-tertiary" />
              <span className="flex-1 font-medium">{t('common:gitBoard.changedFiles', { count: detail.files?.length || 0 })}</span>
              <span className="text-[10px] text-foreground-tertiary">{t('common:gitBoard.expand')}</span>
              <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-foreground-tertiary transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="border-t border-border/60 p-2">
              {detail.files?.length ? detail.files.map((file) => <button key={`${file.status}:${file.path}`} type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors hover:bg-muted" onClick={() => onOpenDiff(file.path)}><code className="w-7 shrink-0 rounded bg-muted px-1 py-0.5 text-center font-mono text-foreground-secondary">{file.status}</code><span className="min-w-0 flex-1 break-all">{file.path}</span><span className="text-foreground-tertiary">›</span></button>) : <p className="px-2 py-3 text-center text-[11px] text-foreground-tertiary">{t('common:gitBoard.noChangedFiles')}</p>}
            </div>
          </details>
          {diff ? <pre className="mt-3 max-h-52 overflow-auto rounded-xl border border-border/70 bg-background/80 p-3 text-[11px] leading-5">{diff}</pre> : null}
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-border/60 bg-background/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[10px] leading-4 text-foreground-tertiary">{t('common:gitBoard.checkoutCommitHint')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-lg border border-border/80 px-3.5 py-2 text-[12px] font-medium text-foreground-secondary hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={close}>{t('common:gitBoard.close')}</button>
            <button type="button" disabled={closing} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" onClick={() => void checkout()}><GitBranch className="h-3.5 w-3.5" />{t('common:gitBoard.checkoutCommit')}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
