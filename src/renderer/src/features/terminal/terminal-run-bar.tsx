import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Play, Sparkles, Upload } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import { spawnPane } from './terminal-bridge'
import { terminalActions, useTerminalStore, type ShellProfile } from './terminal-store'
import { workspacePathsEqual } from '@shared/workspace-path'

type TaskLaunch = { label: string; command: string; args: string[]; cwd: string; background?: boolean }
type TaskGroup = { kind: string; label: string; isDefault: boolean; tasks: TaskLaunch[] }
type Draft = { content: string; groups: TaskGroup[] }

const EMPTY_HINTS = ['package.json', 'pnpm-workspace.yaml', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'composer.json', '*.csproj', '*.sln']

async function projectHints(root: string): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = []
  const read = async (path: string) => {
    const result = await ipcClient.invoke('workspace.fs.readText', { workspaceRoot: root, path, maxBytes: 12_000 }).catch(() => null) as { ok?: boolean; content?: string } | null
    if (result?.ok && result.content) files.push({ path, content: result.content.slice(0, 12_000) })
  }
  await Promise.all(EMPTY_HINTS.filter((item) => !item.includes('*')).map(read))
  const skipped = new Set(['node_modules', 'vendor', 'bin', 'obj', 'dist', 'build', 'publish', 'coverage'])
  let directories = ['.']
  for (let depth = 0; depth <= 2 && directories.length && files.length < 35; depth++) {
    const listings = await Promise.all(directories.map(async (directory) => ({ directory, result: await ipcClient.invoke('workspace.fs.listDir', { workspaceRoot: root, path: directory, includeDotfiles: false }).catch(() => null) as { entries?: Array<{ name: string; isDirectory: boolean }> } | null })))
    const next: string[] = []
    const reads: string[] = []
    for (const { directory, result } of listings) for (const entry of result?.entries || []) {
      const path = directory === '.' ? entry.name : `${directory}/${entry.name}`
      if (entry.isDirectory && depth < 2 && !skipped.has(entry.name.toLowerCase())) next.push(path)
      else if (!entry.isDirectory && (entry.name === 'package.json' && path !== 'package.json' || /\.(csproj|sln)$/i.test(entry.name))) reads.push(path)
    }
    await Promise.all(reads.slice(0, 35 - files.length).map(read))
    directories = next.slice(0, 40)
  }
  for (const scripts of files.filter((file) => file.path.endsWith('package.json'))) {
    try {
      const pkg = JSON.parse(scripts.content) as { scripts?: Record<string, string> }
      files[files.indexOf(scripts)].content = JSON.stringify({ scripts: pkg.scripts || {} }, null, 2)
    } catch { /* the model can still inspect the raw file */ }
  }
  return files
}

export function TerminalRunBar() {
  const { t } = useTranslation()
  const workspace = useUIStore((s) => s.currentWorkspace)
  const profiles = useTerminalStore((s) => s.profiles)
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [busy, setBusy] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [taskLabels, setTaskLabels] = useState<string[] | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupTasks, setGroupTasks] = useState<Set<string>>(new Set())
  const [taskDefinitions, setTaskDefinitions] = useState<Array<{ label: string; dependsOn: string[] }>>([])
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([])

  useEffect(() => {
    try { const stored = JSON.parse(localStorage.getItem(`pi-desktop:terminal-hidden-groups:${workspace || ''}`) || '[]'); setHiddenGroups(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []) } catch { setHiddenGroups([]) }
    if (!workspace) return setGroups([])
    let live = true
    const load = async () => {
      const result = await ipcClient.invoke('workspace.tasks.get', { cwd: workspace }).catch(() => null) as { groups?: TaskGroup[] } | null
      if (live) setGroups(result?.groups || [])
    }
    void load()
    const onFocus = () => void load()
    const onChanged = (event: Event) => { if (workspacePathsEqual((event as CustomEvent<string>).detail, workspace)) void load() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('pi-desktop:workspace-tasks-changed', onChanged)
    return () => { live = false; window.removeEventListener('focus', onFocus); window.removeEventListener('pi-desktop:workspace-tasks-changed', onChanged) }
  }, [workspace])

  const profile = (): ShellProfile | undefined => profiles?.find((item) => item.piDefault) || profiles?.[0]

  const run = async (tasks: TaskLaunch[]) => {
    if (!workspace || !tasks.length) return
    setBusy(true)
    try {
      const selected = profile()
      const launches = tasks.map(({ label, command, args, cwd }) => ({ label, command, args, cwd }))
      const result = await ipcClient.invoke('terminal.runTasks', { cwd: workspace, profileId: selected?.id, tasks: launches }) as { ok?: boolean; error?: string; terminals?: Array<{ id: string; label: string }>; profile?: ShellProfile }
      if (!result?.ok || !result.profile || !result.terminals?.length) throw new Error(result?.error || 'run_failed')
      for (const [index, item] of result.terminals.entries()) terminalActions.addTab({ ptyId: item.id, profile: result.profile, task: launches[index] }, launches[index]?.cwd || workspace, workspace)
      toast.success(t('common:terminal.tasksStarted', { count: result.terminals.length }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const detect = async () => {
    if (!workspace) return
    setBusy(true)
    setDetecting(true)
    try {
      const files = await projectHints(workspace)
      const result = await ipcClient.invoke('workspace.tasks.draft', { cwd: workspace, files }) as { ok?: boolean; content?: string; groups?: TaskGroup[]; error?: string; detail?: string }
      if (!result?.ok || !result.content || !result.groups?.length) throw new Error(result?.detail || result?.error || 'draft_failed')
      setDraft({ content: result.content, groups: result.groups })
      const defaultIndex = result.groups.findIndex((group) => group.isDefault || group.kind === 'build')
      const chosen = Math.max(0, defaultIndex)
      setSelectedTasks(new Set(result.groups[chosen].tasks.map((_, index) => `${chosen}:${index}`)))
    } catch (error) {
      toast.error(t('common:terminal.detectFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setDetecting(false)
      setBusy(false)
    }
  }

  const acceptDraft = async (runSelected: boolean) => {
    if (!workspace || !draft) return
    setBusy(true)
    try {
      const saved = await ipcClient.invoke('workspace.tasks.save', { cwd: workspace, content: draft.content }) as { ok?: boolean; groups?: TaskGroup[]; error?: string }
      if (!saved?.ok) throw new Error(saved?.error || 'save_failed')
      const next = saved.groups || draft.groups
      setGroups(next)
      setDraft(null)
      window.dispatchEvent(new CustomEvent('pi-desktop:workspace-tasks-changed', { detail: workspace }))
      if (!runSelected) toast.success(t('common:terminal.tasksSaved'))
      const chosen = draft.groups.flatMap((group, groupIndex) => group.tasks.filter((_, taskIndex) => selectedTasks.has(`${groupIndex}:${taskIndex}`)))
      if (runSelected && chosen.length) await run(chosen)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onDetect = () => { if (!busy && workspace) void detect() }
    const onManage = () => {
      if (busy || !workspace) return
      setBusy(true)
      void ipcClient.invoke('workspace.tasks.get', { cwd: workspace }).then((result: { ok?: boolean; labels?: string[]; definitions?: Array<{ label: string; dependsOn: string[] }>; error?: string }) => {
        if (!result.ok) throw new Error(result.error || 'load_failed')
        setTaskLabels(result.labels || [])
        setTaskDefinitions(result.definitions || [])
        setEditingGroup(null)
        setGroupName('')
        setGroupTasks(new Set())
      }).catch((error) => toast.error(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false))
    }
    window.addEventListener('pi-desktop:terminal-detect-tasks', onDetect)
    window.addEventListener('pi-desktop:terminal-manage-tasks', onManage)
    return () => { window.removeEventListener('pi-desktop:terminal-detect-tasks', onDetect); window.removeEventListener('pi-desktop:terminal-manage-tasks', onManage) }
  })

  const labelFor = (group: TaskGroup) => group.isDefault && !/\(AI(?: \d+)?\)$/.test(group.label) ? t('common:terminal.run') : group.label

  const saveGroup = async () => {
    if (!workspace || !groupName.trim() || !groupTasks.size || busy) return
    setBusy(true)
    try {
      const result = await ipcClient.invoke('workspace.tasks.save', { cwd: workspace, group: { label: groupName.trim(), dependsOn: [...groupTasks], ...(editingGroup ? { originalLabel: editingGroup } : {}) } }) as { ok?: boolean; groups?: TaskGroup[]; error?: string }
      if (!result.ok) throw new Error(result.error || 'save_failed')
      setGroups(result.groups || [])
      setTaskLabels(null)
      window.dispatchEvent(new CustomEvent('pi-desktop:workspace-tasks-changed', { detail: workspace }))
      toast.success(t('common:terminal.groupSaved'))
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'invalid_task_group' ? t('common:terminal.invalidGroup') : String(error))
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-1.5">
        {groups.filter((group) => !hiddenGroups.includes(group.label)).map((group) => (
          <button key={`${group.kind}:${group.label}`} type="button" disabled={busy} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-[11.5px] text-primary-foreground disabled:opacity-50" onClick={() => void run(group.tasks)}>
            {group.kind === 'publish' ? <Upload className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {labelFor(group)}
          </button>
        ))}
          {detecting && groups.length > 0 ? <span role="status" className="px-2 text-[11.5px] text-foreground-secondary">{t('common:terminal.detecting')}</span> : null}
          {!groups.length ? <button type="button" disabled={busy || !workspace} className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11.5px] hover:bg-muted disabled:opacity-50" onClick={() => void detect()}>
            <Sparkles className="h-3 w-3" />{busy ? t('common:terminal.detecting') : t('common:terminal.detectTasks')}
          </button> : null}
      </div>
      {taskLabels && createPortal(<div role="dialog" aria-modal="true" aria-label={t('common:terminal.manageTasks')} className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setTaskLabels(null) }} onKeyDown={(event) => { if (event.key === 'Escape') setTaskLabels(null) }}>
        <div className="w-full max-w-lg rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl">
          <h2 className="mb-2 font-semibold">{t('common:terminal.manageTasks')}</h2>
          {groups.length > 0 && <div><p className="mb-1 text-[12px] text-foreground-secondary">{t('common:terminal.visibleGroups')}</p><div className="mb-3 max-h-36 space-y-1 overflow-auto rounded border border-border p-2">{groups.map((group) => <div key={group.label} className="flex items-center gap-2 text-[12px]"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={!hiddenGroups.includes(group.label)} onChange={(event) => { const next = event.target.checked ? hiddenGroups.filter((item) => item !== group.label) : [...hiddenGroups, group.label]; setHiddenGroups(next); try { localStorage.setItem(`pi-desktop:terminal-hidden-groups:${workspace || ''}`, JSON.stringify(next)) } catch { void 0 } }} /><span className="truncate">{labelFor(group)}</span></label><button type="button" className="rounded px-2 py-1 hover:bg-muted" onClick={() => { setEditingGroup(group.label); setGroupName(group.label); setGroupTasks(new Set(taskDefinitions.find((item) => item.label === group.label)?.dependsOn || [])) }}>{t('common:terminal.editGroup')}</button></div>)}</div></div>}
          {editingGroup && <button type="button" className="mb-2 text-[12px] text-accent hover:underline" onClick={() => { setEditingGroup(null); setGroupName(''); setGroupTasks(new Set()) }}>{t('common:terminal.newGroup')}</button>}
          <label className="block text-[12px]">{t('common:terminal.groupName')}<input value={groupName} disabled={!!editingGroup} onChange={(event) => setGroupName(event.target.value)} className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 disabled:opacity-60" /></label>
          <p className="mt-3 text-[12px] text-foreground-secondary">{t('common:terminal.groupHelp')}</p>
          <div className="mt-2 max-h-48 overflow-auto">{taskLabels.filter((label) => label !== editingGroup).map((label) => <label key={label} className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-muted"><input type="checkbox" checked={groupTasks.has(label)} onChange={(event) => setGroupTasks((current) => { const next = new Set(current); if (event.target.checked) next.add(label); else next.delete(label); return next })} />{label}</label>)}{!taskLabels.length && <p className="py-2 text-[12px] text-foreground-secondary">{t('common:terminal.noTasks')}</p>}</div>
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded px-3 py-1.5 hover:bg-muted" onClick={() => setTaskLabels(null)}>{t('common:cancel')}</button><button type="button" disabled={busy || !groupName.trim() || !groupTasks.size} className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" onClick={() => void saveGroup()}>{t('common:terminal.saveGroup')}</button></div>
        </div>
      </div>, document.body)}
      {draft ? createPortal(<div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setDraft(null) }}>
        <div role="dialog" aria-modal="true" aria-label={t('common:terminal.draftTitle')} className="w-full max-w-lg rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl" onKeyDown={(event) => { if (event.key === 'Escape') setDraft(null) }}>
          <h2 className="mb-2 font-semibold">{t('common:terminal.draftTitle')}</h2>
          <p className="mb-2 text-[12px] text-foreground-secondary">{t('common:terminal.draftHelp')}</p>
          <div className="max-h-80 space-y-3 overflow-auto">{draft.groups.map((group, groupIndex) => <section key={`${group.kind}:${groupIndex}`}><h3 className="mb-1 text-[12px] font-medium">{labelFor(group)}</h3>{group.tasks.map((task, taskIndex) => {
            const key = `${groupIndex}:${taskIndex}`
            return <label key={key} className="flex items-start gap-2 rounded p-1 text-[12px] hover:bg-muted"><input type="checkbox" checked={selectedTasks.has(key)} onChange={(event) => setSelectedTasks((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next })} /><span className="min-w-0"><span className="block">{task.label}</span><code className="block break-all text-foreground-tertiary">{task.command} {task.args.join(' ')}</code></span></label>
          })}</section>)}</div>
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded px-3 py-1.5 hover:bg-muted" onClick={() => setDraft(null)}>{t('common:cancel')}</button><button type="button" disabled={busy} className="rounded border px-3 py-1.5 disabled:opacity-50" onClick={() => void acceptDraft(false)}>{t('common:terminal.saveOnly')}</button><button type="button" disabled={busy || !selectedTasks.size} className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" onClick={() => void acceptDraft(true)}>{t('common:terminal.saveAndRun')}</button></div>
        </div>
      </div>, document.body) : null}
    </>
  )
}

export async function openTerminalAt(cwd: string, profileId?: string): Promise<void> {
  const pane = await spawnPane(profileId, cwd)
  if ('error' in pane) {
    toast.error(pane.error)
    return
  }
  terminalActions.addTab(pane, cwd, useUIStore.getState().currentWorkspace ?? cwd)
  useUIStore.getState().setActivePanel('terminal')
  useUIStore.getState().revealRightPanel()
}
