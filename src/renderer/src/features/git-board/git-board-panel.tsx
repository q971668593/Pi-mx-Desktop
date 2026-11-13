import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, GitCommitHorizontal, Loader2, RefreshCw, Settings, Sparkles } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import { applyConflictChoices, parseConflicts, type ConflictChoice } from './conflict-editor'
import { GitLane } from './git-lane'
import { layoutCommitGraph } from './git-graph'
import { workspacePathKey } from '@shared/workspace-path'
import { fileTreeIcon } from '@renderer/features/workspace-files/file-tree-icons'
import './git-board.css'
import { GitCommandHistory } from './git-command-history'

function GitFileIcon({ path }: { path: string }) {
  const { Icon, className } = fileTreeIcon(path, false)
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', className)} aria-hidden />
}

type Change = { staged: string; unstaged: string; path: string; group: 'conflict' | 'staged' | 'unstaged' | 'untracked' }
type Commit = { hash: string; short: string; parents: string[]; author: string; time: number; subject: string; decorations: string }
type Branch = { name: string; kind: 'local' | 'remote'; current: boolean; hash: string; upstream: string | null; ahead: number; behind: number; subject: string }
type FileRow = { status: string; path: string }
type Detail = { hash: string; subject: string; body: string; author: string; parents: string[]; files: FileRow[] }
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
const TABS = ['changes', 'graph', 'branches', 'log', 'repository'] as const
type Tab = (typeof TABS)[number]
const REPOSITORY_TABS = ['stash', 'tags', 'remotes', 'worktrees'] as const
type RepositoryTab = (typeof REPOSITORY_TABS)[number]
const DEFAULT_COMMIT_PROMPT = '根据 git diff 写一条简短提交说明。只输出说明正文，不要代码块或解释。第一行不超过 72 个字符，需要时再用短正文说明原因。不要编造未出现的改动。'

async function git<T>(method: string, request: Record<string, unknown>) {
  return ipcClient.invoke(method, request) as Promise<T & { ok?: boolean; error?: string; text?: string; stdout?: string }>
}

export function GitBoardPanel() {
  const { t } = useTranslation()
  const cwd = useUIStore((s) => s.currentWorkspace)
  const [data, setData] = useState<Overview | null>(null)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<Tab>('changes')
  const [repositoryTab, setRepositoryTab] = useState<RepositoryTab>('stash')
  const [message, setMessage] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [commitPrompt, setCommitPrompt] = useState(() => { try { return localStorage.getItem('pi-desktop:git-commit-prompt') || DEFAULT_COMMIT_PROMPT } catch { return DEFAULT_COMMIT_PROMPT } })
  const [promptDraft, setPromptDraft] = useState(commitPrompt)
  const [commitAction, setCommitAction] = useState<'stage-and-commit' | 'commit-and-push' | null>(null)
  const [commitComplete, setCommitComplete] = useState<'stage-and-commit' | 'commit-and-push' | null>(null)
  const [name, setName] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)
  const [from, setFrom] = useState('')
  const [url, setUrl] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [cloneUrl, setCloneUrl] = useState('')
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [diff, setDiff] = useState('')
  const [selectedHunks, setSelectedHunks] = useState<string[]>([])
  const [commandLog, setCommandLog] = useState<Array<{ time: number; command: string; success: boolean; output: string }>>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [conflictPath, setConflictPath] = useState('')
  const [conflictText, setConflictText] = useState('')
  const [choices, setChoices] = useState<Map<number, ConflictChoice>>(new Map())
  const [menu, setMenu] = useState<{ x: number; y: number; commit: Commit } | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null)
  const [busy, setBusy] = useState(false)
  const loadSequence = useRef(0)

  const load = useCallback(async (append = false, resetFilters = false) => {
    if (!cwd) return
    const sequence = ++loadSequence.current
    try {
      const result = await git<Overview>('gitBoard.overview', { cwd, skip: append ? data?.commits.length || 0 : 0, ...(!resetFilters && query.trim() ? { ref: query.trim() } : {}), ...(!resetFilters && author.trim() ? { author: author.trim() } : {}) })
      if (sequence !== loadSequence.current) return
      const absent = !result.ok && result.error === 'not_repo'
      setMissing(absent)
      setLoadError(result.ok || absent ? '' : result.error || 'git_failed')
      if (!result.ok) return setData(null)
      setData(append && data ? { ...result, commits: [...data.commits, ...result.commits] } : result)
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [author, cwd, data, query])
  useEffect(() => {
    setData(null)
    setMissing(false)
    setLoadError('')
    setDiff('')
    setDetail(null)
    setConflictPath('')
    setCommandLog([])
    setMessage('')
    setQuery('')
    setAuthor('')
    try {
      const stored = localStorage.getItem(`pi-desktop:git-tab:${workspacePathKey(cwd)}`)
      if (REPOSITORY_TABS.includes(stored as RepositoryTab)) { setRepositoryTab(stored as RepositoryTab); setTab('repository') }
      else setTab(TABS.includes(stored as Tab) ? stored as Tab : 'changes')
    } catch { setTab('changes') }
    void load(false, true)
    return () => { loadSequence.current += 1 }
  }, [cwd])
  useEffect(() => window.piDesktop?.onGitWorkspaceChanged?.(() => void load(false)) || (() => {}), [load])
  const rows = useMemo(() => layoutCommitGraph(data?.commits || []), [data])
  const nodes = useMemo(() => parseConflicts(conflictText), [conflictText])
  const unresolved = nodes.filter((node) => node.kind === 'conflict' && !choices.has(node.index)).length

  const run = async (method: string, request: Record<string, unknown> = {}) => {
    if (!cwd) return null
    setBusy(true)
    try {
      const result = await git<Record<string, unknown>>(method, { cwd, ...request })
      if (!result.ok) throw new Error(result.error || 'git_failed')
      if (method === 'gitBoard.commitDetail') return { ...result, hash: String(request.ref || '') }
      if (!['gitBoard.suggestCommit', 'gitBoard.diff', 'gitBoard.commitDetail'].includes(method)) {
        toast.success(t('common:gitBoard.done'))
        await load(false)
      }
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setBusy(false)
    }
  }
  const openDiff = async (path: string, request: Record<string, unknown>) => {
    const result = await run('gitBoard.diff', { path, ...request })
    setDiff(result?.stdout || '')
    setSelectedHunks([])
  }
  const suggestCommit = async () => {
    if (suggesting || busy) return
    const original = message
    setSuggesting(true)
    try {
      const result = await run('gitBoard.suggestCommit', { prompt: commitPrompt.trim() })
      if (result?.text) setMessage((current) => current === original ? result.text! : current)
    } finally { setSuggesting(false) }
  }
  const commit = async (action: 'stage-and-commit' | 'commit-and-push') => {
    const submitted = message
    if (!submitted.trim() || busy || commitAction) return
    setCommitAction(action)
    setCommitComplete(null)
    try {
      const result = await run('gitBoard.commit', { message: submitted, action })
      if (result?.ok) {
        setMessage((current) => current === submitted ? '' : current)
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
  const stageSelected = async (patch: string, hunks: string[]) => {
    const path = selectedPath(patch)
    if (!path) return
    await run('gitBoard.stagePatch', { path, hunks })
    setDiff('')
    setSelectedHunks([])
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
    if (result?.path) setTargetPath(result.path)
  }

  if (!cwd) return <p className="p-4 text-[12px] text-foreground-tertiary">{t('common:gitBoard.noWorkspace')}</p>
  if (loadError) return <div className="m-4 flex items-center gap-2 text-[12px]"><span className="text-destructive">{loadError}</span><button type="button" className="rounded border px-2 py-1" onClick={() => void load(false)}>{t('common:gitBoard.refresh')}</button></div>
  if (missing) return <div className="m-4 space-y-2"><p className="text-[12px] text-foreground-tertiary">{t('common:gitBoard.notRepo')}</p><button type="button" className="rounded border px-3 py-1.5 text-[12px]" onClick={() => void run('gitBoard.init')}>{t('common:gitBoard.init')}</button></div>
  if (!data) return <p className="p-4 text-[12px] text-foreground-tertiary">{t('common:loading')}</p>
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

  const groups = ['conflict', 'staged', 'unstaged', 'untracked'] as const
  const remoteBranches = data.branches.filter((branch) => branch.kind === 'remote')
  /** 先 pull 再 push：一键把本地和远端对齐，不需要先有提交内容 */
  const syncBoth = async () => {
    if (!cwd || busy) return
    setBusy(true)
    try {
      const pull = await git<Record<string, unknown>>('gitBoard.sync', { cwd, action: 'pull' })
      if (!pull.ok) throw new Error(pull.error || 'git_failed')
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
  return (
    <div className="git-board flex h-full min-h-0 flex-col" onClick={() => setMenu(null)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3 text-[12px]">
        <GitCommitHorizontal className="h-4 w-4 text-foreground-secondary" />
        <strong className="truncate font-medium">{data.status.branch || 'HEAD'}</strong>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span
            className={cn(data.status.ahead > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-foreground-tertiary')}
            title={t('common:gitBoard.ahead', { n: data.status.ahead })}
          >
            {data.status.ahead}↑
          </span>
          <span
            className={cn(data.status.behind > 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-foreground-tertiary')}
            title={t('common:gitBoard.behind', { n: data.status.behind })}
          >
            {data.status.behind}↓
          </span>
        </span>
        {data.operation ? <span className="rounded bg-amber-500/15 px-1.5 text-amber-700">{data.operation}</span> : null}
        <div className="ml-auto flex items-center gap-1">
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
          <button type="button" className="rounded p-1.5 text-foreground-secondary hover:bg-muted hover:text-foreground" aria-label={t('common:gitBoard.refresh')} onClick={() => void load(false)}><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-border/50 bg-[var(--bg-1)]">{TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={cn('relative h-9 shrink-0 border-b-2 px-3 text-[12px] transition-colors', tab === item ? 'border-primary bg-[var(--bg-base)] font-medium text-foreground' : 'border-transparent text-foreground-secondary hover:bg-muted hover:text-foreground')} onClick={() => { setTab(item); try { localStorage.setItem(`pi-desktop:git-tab:${workspacePathKey(cwd)}`, item) } catch { void 0 } }}>{t(`common:gitBoard.${item}`)}{item === 'changes' && data.files.length ? <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{data.files.length}</span> : null}</button>)}</div>
      {tab === 'repository' && <div role="tablist" aria-label={t('common:gitBoard.repository')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-1">{REPOSITORY_TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={repositoryTab === item} className={cn('shrink-0 rounded px-2 py-1 text-[12px]', repositoryTab === item ? 'bg-muted font-medium text-foreground' : 'text-foreground-secondary hover:bg-muted')} onClick={() => setRepositoryTab(item)}>{t(`common:gitBoard.${item}`)}</button>)}</div>}
      {data.operation ? <div className="flex gap-1 border-b px-2 py-1"><button type="button" className="rounded border px-2 py-1 text-[12px]" onClick={() => void run('gitBoard.operation', { operation: data.operation, action: 'continue' })}>{t('common:gitBoard.continue')}</button><button type="button" className="rounded border px-2 py-1 text-[12px]" onClick={() => void run('gitBoard.operation', { operation: data.operation, action: 'abort' })}>{t('common:gitBoard.abort')}</button></div> : null}

      {tab === 'changes' && <div className="git-changes flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-auto p-2">{groups.map((group) => {
        const files = data.files.filter((file) => file.group === group)
        if (!files.length) return null
        return <section key={group} className="mb-3"><div className="mb-1 flex items-center text-[11px] text-foreground-tertiary"><span>{t(`common:gitBoard.${group}`)}</span>{group === 'staged' ? <button type="button" className="ml-auto" onClick={() => void run('gitBoard.unstageAll')}>{t('common:gitBoard.unstageAll')}</button> : group !== 'conflict' ? <button type="button" className="ml-auto" onClick={() => void run('gitBoard.stageAll')}>{t('common:gitBoard.stageAll')}</button> : null}</div>{files.map((file) => <div key={`${group}:${file.path}`} className="flex items-center gap-1 py-0.5 text-[12px]"><span className="w-6 font-mono text-[10px]">{group === 'untracked' ? 'U' : `${file.staged}${file.unstaged}`}</span><GitFileIcon path={file.path} /><button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => group === 'conflict' ? void openConflict(file.path) : void openDiff(file.path, { staged: group === 'staged' })}>{file.path}</button>{group === 'conflict' ? <><button type="button" onClick={() => void openConflict(file.path)}>{t('common:gitBoard.resolve')}</button><button type="button" onClick={() => ask(t('common:gitBoard.discard'), file.path, () => run('gitBoard.discard', { tracked: [file.path] }))}>{t('common:gitBoard.discard')}</button></> : <><button type="button" onClick={() => void run('gitBoard.exclude', { paths: [file.path] })}>{t('common:gitBoard.exclude')}</button><button type="button" onClick={() => void run(group === 'staged' ? 'gitBoard.unstage' : 'gitBoard.stage', { paths: [file.path] })}>{t(`common:gitBoard.${group === 'staged' ? 'unstage' : 'stage'}`)}</button><button type="button" onClick={() => ask(t('common:gitBoard.discard'), file.path, () => run('gitBoard.discard', group === 'untracked' ? { untracked: [file.path] } : { tracked: [file.path] }))}>{t('common:gitBoard.discard')}</button></>}</div>)}</section>
      })}{!data.files.length && <p className="p-2 text-[12px] text-foreground-tertiary">{t('common:gitBoard.clean')}</p>}{diff && <div className="mt-2 rounded bg-muted/40 p-2"><pre className="max-h-48 overflow-auto text-[11px]">{diff.split(/\n/).map((line, index) => line.startsWith('@@') ? <label key={index} className="block"><input type="checkbox" className="mr-1" checked={selectedHunks.includes(line)} onChange={(event) => setSelectedHunks((current) => event.target.checked ? [...current, line] : current.filter((item) => item !== line))} />{line}</label> : <span key={index} className="block">{line}</span>)}</pre>{selectedHunks.length ? <button type="button" className="mt-1 rounded border px-2 py-1" onClick={() => void stageSelected(diff, selectedHunks)}>{t('common:gitBoard.stageSelected')}</button> : null}</div>}</div><div className="border-t p-2"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t('common:gitBoard.commitPlaceholder')} className="h-32 w-full resize-y rounded border bg-transparent p-2 text-[12px]" /><div className="mt-1 flex gap-1"><button type="button" disabled={busy} className="rounded border px-2 py-1 text-[12px]" onClick={() => void suggestCommit()}>{suggesting ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 inline h-3 w-3" />}{t(suggesting ? 'common:gitBoard.generating' : 'common:gitBoard.suggest')}</button><button type="button" disabled={busy} aria-label={t('common:gitBoard.promptSettings')} title={t('common:gitBoard.promptSettings')} className="rounded border p-1.5 text-foreground-secondary hover:bg-muted" onClick={() => { setPromptDraft(commitPrompt); setPromptOpen(true) }}><Settings className="h-3.5 w-3.5" /></button><button type="button" disabled={busy || !message.trim()} className="ml-auto rounded bg-primary px-2 py-1 text-[12px] text-primary-foreground disabled:opacity-50" onClick={() => void commit('stage-and-commit')}>{commitAction === 'stage-and-commit' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : commitComplete === 'stage-and-commit' ? <Check className="mr-1 inline h-3 w-3 animate-pulse" /> : null}{t('common:gitBoard.commit')}</button><button type="button" disabled={busy || !message.trim()} className="rounded border px-2 py-1 text-[12px] disabled:opacity-50" onClick={() => void commit('commit-and-push')}>{commitAction === 'commit-and-push' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : commitComplete === 'commit-and-push' ? <Check className="mr-1 inline h-3 w-3 animate-pulse" /> : null}{t('common:gitBoard.commitPush')}</button></div></div></div>}

      {tab === 'graph' && <div className="flex min-h-0 flex-1 flex-col"><div className="flex gap-1 border-b p-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('common:gitBoard.refFilter')} className="h-7 min-w-0 flex-1 rounded border bg-transparent px-2 text-[12px]" /><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={t('common:gitBoard.authorFilter')} className="h-7 w-28 rounded border bg-transparent px-2 text-[12px]" /><button type="button" className="rounded border px-2 text-[12px]" onClick={() => void load(false)}>{t('common:gitBoard.filter')}</button></div><div className="relative min-h-0 flex-1 overflow-auto">{rows.map((row) => <div key={row.commit.hash} className="flex h-7 items-center gap-2 pr-2 text-[12px]" onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, commit: row.commit }) }}><GitLane lane={row.lane} passes={row.passes} links={row.links} columns={row.columns} fromAbove={row.fromAbove} /><span className="w-14 font-mono text-[10px] text-foreground-tertiary">{row.commit.short}</span><GitCommitHorizontal className="h-3 w-3" /><button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => void run('gitBoard.commitDetail', { ref: row.commit.hash }).then((result) => result && setDetail(result as Detail))}>{row.commit.subject}</button><span className="max-w-[35%] truncate text-[10px] text-sky-600">{row.commit.decorations}</span></div>)}{data.hasMore ? <button type="button" className="m-2 rounded border px-2 py-1 text-[12px]" onClick={() => void load(true)}>{t('common:gitBoard.more')}</button> : null}</div>{detail && <div className="max-h-[45%] overflow-auto border-t p-2 text-[12px]"><div className="mb-1 flex items-center gap-2"><strong className="min-w-0 flex-1 truncate">{detail.subject}</strong><button type="button" onClick={() => setDetail(null)}>{t('common:gitBoard.close')}</button></div><p className="text-[11px] text-foreground-tertiary">{detail.author}</p><pre className="whitespace-pre-wrap text-[11px]">{detail.body}</pre>{detail.files?.map((file) => <button key={file.path} type="button" className="block w-full truncate py-0.5 text-left hover:bg-muted" onClick={() => void run('gitBoard.diff', { path: file.path, commit: detail.hash }).then((result) => result && setDiff(result.stdout || ''))}>{file.status} {file.path}</button>)}{diff && <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{diff}</pre>}</div>}</div>}

      {tab === 'branches' && <Manager busy={busy} name={name} setName={setName} from={from} setFrom={setFrom} placeholder={t('common:gitBoard.branchName')} actions={[[t('common:gitBoard.createBranch'), () => run('gitBoard.branch', { action: 'create', name, ...(from ? { from } : {}) }), !name.trim()], [t('common:gitBoard.rename'), () => run('gitBoard.branch', { action: 'rename', name, from }), !name.trim() || !from.trim()], [t('common:gitBoard.merge'), () => run('gitBoard.merge', { ref: name }), !name.trim()], [t('common:gitBoard.mergeNoFf'), () => run('gitBoard.merge', { ref: name, noFf: true }), !name.trim()], [t('common:gitBoard.rebase'), () => run('gitBoard.rebase', { ref: name }), !name.trim()], [t('common:gitBoard.pull'), () => run('gitBoard.sync', { action: 'pull' })], [t('common:gitBoard.push'), () => run('gitBoard.sync', { action: 'push' })], [t('common:gitBoard.fetch'), () => run('gitBoard.sync', { action: 'fetch' })]]}>{data.branches.map((branch) => <Row key={`${branch.kind}:${branch.name}`} title={`${branch.current ? '* ' : ''}${branch.name}`} meta={`${branch.upstream || ''} ${branch.ahead}↑ ${branch.behind}↓`} actions={[[t('common:gitBoard.checkout'), () => run('gitBoard.checkout', { ref: branch.name })], ...(branch.kind === 'local' ? [[t('common:gitBoard.publish'), () => run('gitBoard.remote', { action: 'publish', name: 'origin', branch: branch.name })], [t('common:gitBoard.delete'), () => removeBranch(branch.name)]] as Array<[string, () => unknown]> : [[t('common:gitBoard.deleteRemoteBranch'), () => ask(t('common:gitBoard.deleteRemoteBranch'), branch.name, () => run('gitBoard.remote', { action: 'deleteBranch', name: branch.name.split('/')[0], branch: branch.name.split('/').slice(1).join('/') }))]] as Array<[string, () => unknown]>)]} />)}</Manager>}
      {tab === 'repository' && repositoryTab === 'stash' && <Manager busy={busy} name={name} setName={setName} placeholder={t('common:gitBoard.message')} actions={[[t('common:gitBoard.saveStash'), () => run('gitBoard.stash', { action: 'save', message: name, includeUntracked })]]}><label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={includeUntracked} onChange={(event) => setIncludeUntracked(event.target.checked)} />{t('common:gitBoard.includeUntracked')}</label>{data.stashes.map((stash) => <Row key={stash.ref} title={stash.ref} meta={stash.message} actions={[[t('common:gitBoard.applyStash'), () => run('gitBoard.stash', { action: 'apply', ref: stash.ref })], [t('common:gitBoard.stashPop'), () => run('gitBoard.stash', { action: 'pop', ref: stash.ref })], [t('common:gitBoard.dropStash'), () => run('gitBoard.stash', { action: 'drop', ref: stash.ref })]]} />)}</Manager>}
      {tab === 'repository' && repositoryTab === 'tags' && <Manager busy={busy} name={name} setName={setName} from={from} setFrom={setFrom} placeholder={t('common:gitBoard.tagName')} actions={[[t('common:gitBoard.tag'), () => run('gitBoard.tag', { action: 'create', name, ...(from ? { target: from } : {}), ...(message.trim() ? { message } : {}) }), !name.trim()]]}>{data.tags.map((tag) => <Row key={tag} title={tag} actions={[[t('common:gitBoard.pushTag'), () => run('gitBoard.tag', { action: 'push', name: tag })], [t('common:gitBoard.deleteTag'), () => run('gitBoard.tag', { action: 'delete', name: tag })]]} />)}</Manager>}
      {tab === 'repository' && repositoryTab === 'remotes' && <Manager busy={busy} name={name} setName={setName} url={url} setUrl={setUrl} from={from} setFrom={setFrom} placeholder={t('common:gitBoard.remoteName')} fromPlaceholder={t('common:gitBoard.remoteNewName', { defaultValue: '新远程名称' })} actions={[[t('common:gitBoard.addRemote'), () => run('gitBoard.remote', { action: 'add', name, url }), !name.trim() || !url.trim()], [t('common:gitBoard.setUrl'), () => run('gitBoard.remote', { action: 'setUrl', name, url }), !name.trim() || !url.trim()], [t('common:gitBoard.rename'), () => run('gitBoard.remote', { action: 'rename', name, to: from }), !name.trim() || !from.trim()]]}>{data.remotes.map((remote) => <Row key={remote.name} title={remote.name} meta={remote.fetch} actions={[[t('common:gitBoard.removeRemote'), () => run('gitBoard.remote', { action: 'remove', name: remote.name })]]} />)}<div className="mt-3 border-t pt-2"><strong>{t('common:gitBoard.remoteBranches')}</strong>{remoteBranches.map((branch) => <Row key={branch.name} title={branch.name} actions={[[t('common:gitBoard.checkout'), () => run('gitBoard.branch', { action: 'track', name: branch.name.split('/').slice(1).join('/'), from: branch.name })], [t('common:gitBoard.deleteRemoteBranch'), () => ask(t('common:gitBoard.deleteRemoteBranch'), branch.name, () => run('gitBoard.remote', { action: 'deleteBranch', name: branch.name.split('/')[0], branch: branch.name.split('/').slice(1).join('/') }))]]} />)}</div></Manager>}
      {tab === 'repository' && repositoryTab === 'worktrees' && <Manager busy={busy} name={name} setName={setName} targetPath={targetPath} setTargetPath={setTargetPath} onBrowse={() => void browseWorktree()} placeholder={t('common:gitBoard.branchName')} actions={[[t('common:gitBoard.addWorktree'), () => run('gitBoard.worktree', { action: 'add', path: targetPath, branch: name, create: true }), !name.trim() || !targetPath.trim()]]}>{data.worktrees.map((tree) => <Row key={tree.path} title={tree.path} meta={tree.branch || tree.head} actions={[[t('common:gitBoard.openWorktree'), () => void activateWorkspace(tree.path, { preferHome: true })], [t('common:gitBoard.removeWorktree'), () => ask(t('common:gitBoard.removeWorktree'), tree.path, () => run('gitBoard.worktree', { action: 'remove', path: tree.path }))]]} />)}<div className="mt-3 flex gap-1 border-t pt-2"><input value={cloneUrl} onChange={(event) => setCloneUrl(event.target.value)} placeholder={t('common:gitBoard.cloneUrl')} className="h-7 min-w-0 flex-1 rounded border bg-transparent px-2" /><button type="button" disabled={busy || !cloneUrl.trim() || !targetPath.trim()} className="rounded border px-2 disabled:opacity-50" onClick={() => void run('gitBoard.clone', { url: cloneUrl, path: targetPath }).then(async (result) => { if (result?.path) await activateWorkspace(String(result.path), { preferHome: true }) })}>{t('common:gitBoard.clone')}</button></div></Manager>}

      
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
    </div>
  )
}

function selectedPath(patch: string) { return patch.match(/^diff --git a\/(.+) b\//m)?.[1] || '' }
function Choice({ title, text, picked, onPick, label }: { title: string; text: string; picked: boolean; onPick: () => void; label: string }) {
  return <div className={cn('rounded border p-1', picked && 'border-primary')}><div className="mb-1 flex justify-between"><span className="truncate">{title}</span><button type="button" onClick={onPick}>{label}</button></div><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{text || '—'}</pre></div>
}
function Manager({ children, actions, busy, onBrowse, ...fields }: { children: React.ReactNode; actions: Array<[string, () => unknown, boolean?]>; busy: boolean; onBrowse?: () => void; name: string; setName: (value: string) => void; placeholder: string; fromPlaceholder?: string; message?: string; setMessage?: (value: string) => void; from?: string; setFrom?: (value: string) => void; url?: string; setUrl?: (value: string) => void; targetPath?: string; setTargetPath?: (value: string) => void }) {
  const { t } = useTranslation()
  const inputClass = 'h-8 min-w-0 flex-1 rounded border border-border bg-[var(--bg-1)] px-2 outline-none focus:border-primary'
  return (
    <div className="flex min-h-0 flex-1 flex-col text-[12px]">
      <div className="git-manager-form shrink-0 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <input value={fields.name} onChange={(event) => fields.setName(event.target.value)} placeholder={fields.placeholder} className={inputClass} />
          {fields.setMessage ? <input value={fields.message || ''} onChange={(event) => fields.setMessage?.(event.target.value)} placeholder={t('common:gitBoard.tagMessage')} className={inputClass} /> : null}
          {fields.setFrom ? <input value={fields.from || ''} onChange={(event) => fields.setFrom?.(event.target.value)} placeholder={fields.fromPlaceholder || t('common:gitBoard.sourceRef')} className={inputClass} /> : null}
          {fields.setUrl ? <input value={fields.url || ''} onChange={(event) => fields.setUrl?.(event.target.value)} placeholder={t('common:gitBoard.remoteUrl')} className={inputClass} /> : null}
          {fields.setTargetPath ? <><input value={fields.targetPath || ''} onChange={(event) => fields.setTargetPath?.(event.target.value)} placeholder={t('common:gitBoard.targetPath')} className={inputClass} /><button type="button" className="h-8 rounded border border-border px-2 hover:bg-muted" onClick={onBrowse}>{t('common:gitBoard.browse')}</button></> : null}
        </div>
        <div className="flex flex-wrap gap-1">{actions.map(([label, action, unavailable]) => <button key={label} type="button" disabled={busy || unavailable} className="rounded px-2 py-1 text-foreground-secondary hover:bg-muted hover:text-foreground disabled:opacity-50" onClick={() => void action()}>{label}</button>)}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </div>
  )
}
function Row({ title, meta, actions }: { title: string; meta?: string; actions: Array<[string, () => unknown]> }) {
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
  return <div className="git-manager-card group flex min-h-12 items-center gap-2"><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium" title={title}>{title}</div>{meta ? <div className="truncate text-[11px] text-foreground-tertiary" title={meta}>{meta}</div> : null}</div><button type="button" aria-label={t('common:gitBoard.rowActions', { name: title })} aria-haspopup="menu" aria-expanded={!!menu} className="shrink-0 rounded px-2 text-lg leading-6 text-foreground-secondary hover:bg-muted" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ left: Math.max(8, Math.min(box.right - 160, window.innerWidth - 168)), top: Math.max(8, Math.min(box.bottom, window.innerHeight - actions.length * 32 - 16)) }) }}>⋯</button>{menu ? createPortal(<div role="menu" className="fixed z-[700] min-w-40 rounded border border-border bg-popover p-1 text-popover-foreground shadow-lg" style={{ left: menu.left, top: menu.top }} onPointerDown={(event) => event.stopPropagation()}>{actions.map(([label, action]) => <button key={label} type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-muted" onClick={() => { setMenu(null); void action() }}>{label}</button>)}</div>, document.body) : null}</div>
}
