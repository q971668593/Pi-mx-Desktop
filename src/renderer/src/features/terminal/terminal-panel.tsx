import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, MessageSquarePlus, Plus, RefreshCw, SlidersHorizontal, Sparkles, Terminal as TerminalIcon, X } from '@renderer/components/icons'
import { sendToComposer } from '@renderer/features/browser/browser-composer'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { TerminalRunBar } from './terminal-run-bar'
import { initializeTerminalBridge, killPty, loadProfiles, spawnPane } from './terminal-bridge'
import { clearTerminalDisplay, disposeTerminalInstance, onTerminalSelection, TerminalPane, terminalSelection, useClosePane } from './terminal-pane'
import { tabTitle, terminalActions, useTerminalStore, type ShellProfile, type TerminalTab } from './terminal-store'
import { workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import { ipcClient } from '@renderer/lib/ipc-client'

const isToggleKey = (e: KeyboardEvent) => e.ctrlKey && !e.altKey && !e.metaKey && (e.code === 'Backquote' || e.key === '`')

function showTerminalPanel(): void {
  const ui = useUIStore.getState()
  ui.setActivePanel('terminal')
  ui.revealRightPanel()
}

/** Open a new shell in the current project and reveal the right-side terminal page. */
export async function openTerminalTab(profileId?: string, cwd = useUIStore.getState().currentWorkspace ?? undefined): Promise<string | null> {
  const pane = await spawnPane(profileId, cwd)
  if ('error' in pane) {
    window.dispatchEvent(new CustomEvent('pi-desktop:terminal-error', { detail: pane.error }))
    return null
  }
  const id = terminalActions.addTab(pane, cwd, useUIStore.getState().currentWorkspace ?? cwd)
  showTerminalPanel()
  return id
}

/** Ctrl+` opens the terminal page, creating the first shell when none exists. */
export function useTerminalShortcut(): void {
  useEffect(() => {
    initializeTerminalBridge()
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleKey(e)) return
      e.preventDefault()
      const s = useTerminalStore.getState()
      const ui = useUIStore.getState()
      const visible = ui.activePanel === 'terminal' && !ui.rightPanelCollapsed
      if (visible) {
        ui.toggleRightPanel()
        return
      }
      if (!s.tabs.some((tab) => ui.currentWorkspace ? workspacePathsEqual(tab.workspace, ui.currentWorkspace) : !tab.workspace)) void openTerminalTab()
      else showTerminalPanel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

function ProfileMenu({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick: (p: ShellProfile) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const profiles = useTerminalStore((s) => s.profiles)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void loadProfiles()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])
  const r = anchor.getBoundingClientRect()
  return (
    <div ref={ref} role="menu" className="fixed z-[500] min-w-[200px] overflow-hidden rounded-lg border border-border bg-popover py-1 text-[12.5px] text-popover-foreground shadow-lg" style={{ left: Math.min(r.left, window.innerWidth - 220), top: Math.min(r.bottom + 6, window.innerHeight - 240) }}>
      {(profiles ?? []).map((p) => (
        <button key={p.id} role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted" title={p.path} onClick={() => { onPick(p); onClose() }}>
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          {p.piDefault ? <span className="text-[11px] text-foreground-tertiary">{t('common:terminal.default')}</span> : null}
        </button>
      ))}
      {profiles && profiles.length === 0 ? <div className="px-3 py-1.5 text-foreground-tertiary">{t('common:terminal.noShell')}</div> : null}
    </div>
  )
}

function IconButton({ label, onClick, children, buttonRef, active }: { label: string; onClick: () => void; children: React.ReactNode; buttonRef?: React.Ref<HTMLButtonElement>; active?: boolean }) {
  return <button ref={buttonRef} type="button" title={label} aria-label={label} className={cn('flex h-6 w-6 items-center justify-center rounded-md text-foreground-tertiary hover:bg-muted hover:text-foreground', active && 'bg-muted text-foreground')} onClick={onClick}>{children}</button>
}

function SplitPanes({ tab, active, onClose }: { tab: TerminalTab; active: boolean; onClose: (ptyId: string) => void }) {
  const { t } = useTranslation()
  const split = tab.panes.length > 1
  const startDrag = (index: number) => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const height = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect().height || 1
    let lastY = event.clientY
    const move = (ev: MouseEvent) => {
      terminalActions.resizeSplit(tab.id, index, (ev.clientY - lastY) / height)
      lastY = ev.clientY
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tab.panes.map((pane, index) => (
        <div key={pane.ptyId} className={cn('flex min-h-0 min-w-0', index > 0 && 'border-t border-border')} style={{ flex: `${tab.sizes[index] ?? 1} 1 0` }}>
          {index > 0 ? <div role="separator" aria-orientation="horizontal" aria-label={t('common:terminal.resizePane')} className="h-1.5 shrink-0 cursor-row-resize hover:bg-primary/30" onMouseDown={startDrag(index - 1)} /> : null}
          <TerminalPane tabId={tab.id} index={index} pane={pane} active={active && tab.activePane === index} visible split={split} onClose={() => onClose(pane.ptyId)} />
        </div>
      ))}
    </div>
  )
}

function TerminalBlock({ tab, active, canResize, onClose }: { tab: TerminalTab; active: boolean; canResize: boolean; onClose: (ptyId: string) => void }) {
  const { t } = useTranslation()
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canResize) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = event.currentTarget.parentElement?.getBoundingClientRect().height || 180
    const move = (ev: PointerEvent) => terminalActions.setTabHeight(tab.id, Math.max(120, Math.round(startHeight + ev.clientY - startY)))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  return (
    <section className="flex min-h-[120px] flex-col border-b border-border/60" style={tab.height ? { height: tab.height, flex: '0 0 auto' } : { flex: '1 1 0' }}>
      {canResize ? <div role="separator" aria-orientation="horizontal" aria-label={t('common:terminal.resize')} className="h-1.5 shrink-0 cursor-row-resize hover:bg-primary/30" onPointerDown={startDrag} /> : null}
      <button type="button" role="tab" aria-selected={active} className={cn('flex h-7 shrink-0 items-center gap-2 px-2 text-left text-[12px]', active ? 'bg-muted/70 text-foreground' : 'text-foreground-secondary hover:bg-muted/40')} onClick={() => terminalActions.focusTab(tab.id)}>
        <TerminalIcon className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate">{tabTitle(tab)}</span>
        <span className="max-w-[45%] truncate text-[11px] text-foreground-tertiary">{tab.cwd}</span>
        <span role="button" tabIndex={0} aria-label={t('common:terminal.clearDisplay')} title={t('common:terminal.clearDisplay')} className="shrink-0 rounded px-1 text-[11px] hover:bg-background" onClick={(event) => { event.stopPropagation(); clearTerminalDisplay(tab.panes[tab.activePane].ptyId) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); clearTerminalDisplay(tab.panes[tab.activePane].ptyId) } }}>{t('common:terminal.clearShort')}</span>
        <span role="button" aria-label={t('common:terminal.restartTerminal')} title={t('common:terminal.restartTerminal')} className="flex h-4 w-4 items-center justify-center rounded hover:bg-background" onClick={(event) => { event.stopPropagation(); window.dispatchEvent(new CustomEvent('pi-desktop:terminal-restart', { detail: tab.panes[tab.activePane].ptyId })) }}><RefreshCw className="h-3 w-3" /></span>
        <span role="button" aria-label={t('common:terminal.closeTab')} className="flex h-4 w-4 items-center justify-center rounded hover:bg-background" onClick={(event) => { event.stopPropagation(); tab.panes.forEach((pane) => onClose(pane.ptyId)) }}><X className="h-3 w-3" /></span>
      </button>
      <SplitPanes tab={tab} active={active} onClose={onClose} />
    </section>
  )
}

/** Right-side terminal page: shells stack vertically and keep running while another page is visible. */
export function TerminalPanel() {
  const { t } = useTranslation()
  const tabs = useTerminalStore((s) => s.tabs)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const workspaceTabs = tabs.filter((item) => workspace ? workspacePathsEqual(item.workspace, workspace) : !item.workspace)
  const activeTab = useTerminalStore((s) => s.activeByWorkspace[workspacePathKey(workspace)])
  const closePane = useClosePane()
  const [menuFor, setMenuFor] = useState<'new' | null>(null)
  const newRef = useRef<HTMLButtonElement>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restartPrompt, setRestartPrompt] = useState<string | null>(null)
  const [restartCommand, setRestartCommand] = useState('')
  const restarting = useRef(new Set<string>())
  const tab = workspaceTabs.find((item) => item.id === activeTab) ?? workspaceTabs[workspaceTabs.length - 1] ?? null
  const activePty = tab?.panes[tab.activePane]?.ptyId

  useEffect(() => onTerminalSelection(activePty || '', setHasSelection), [activePty])
  useEffect(() => {
    const onClose = (e: Event) => closePane(String((e as CustomEvent).detail))
    const onRestart = async (e: Event) => {
      const detail = (e as CustomEvent<string | { id: string; command: string }>).detail
      const old = typeof detail === 'string' ? detail : detail.id
      if (restarting.current.has(old)) return
      const owner = useTerminalStore.getState().tabs.find((item) => item.panes.some((pane) => pane.ptyId === old))
      const prev = owner?.panes.find((pane) => pane.ptyId === old)
      if (!prev) return
      const command = prev.rawCommand || (typeof detail === 'object' ? detail.command.trim() : '')
      if (!prev.task && !command) { setRestartCommand(''); setRestartPrompt(old); return }
      restarting.current.add(old)
      try {
        if (prev.exited === undefined) await killPty(old)
        terminalActions.markExited(old, -1)
        disposeTerminalInstance(old)
        let pane
        if (prev.task && owner?.workspace) {
          const result = await ipcClient.invoke('terminal.runTasks', { cwd: owner.workspace, profileId: prev.profile.id, tasks: [prev.task] })
          if (!result.ok || !result.terminals?.[0] || !result.profile) return setError(result.error || 'restart failed')
          pane = { ptyId: result.terminals[0].id, profile: result.profile, task: prev.task }
        } else {
          pane = await spawnPane(prev.profile.id, owner?.cwd, owner?.workspace, command)
          if ('error' in pane) return setError(pane.error)
        }
        if (!useTerminalStore.getState().tabs.some((item) => item.panes.some((current) => current.ptyId === old))) {
          await killPty(pane.ptyId)
          return
        }
        terminalActions.replacePane(old, pane)
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
      } finally {
        restarting.current.delete(old)
      }
    }
    const onErr = (e: Event) => setError(String((e as CustomEvent).detail ?? ''))
    window.addEventListener('pi-desktop:terminal-close-pane', onClose)
    window.addEventListener('pi-desktop:terminal-restart', onRestart)
    window.addEventListener('pi-desktop:terminal-error', onErr)
    return () => {
      window.removeEventListener('pi-desktop:terminal-close-pane', onClose)
      window.removeEventListener('pi-desktop:terminal-restart', onRestart)
      window.removeEventListener('pi-desktop:terminal-error', onErr)
    }
  }, [closePane])

  return (
    <div className="terminal-drawer flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground-secondary">{t('common:terminal.title')}</span>
        {error ? <span className="max-w-[40%] truncate text-[11px] text-destructive" title={error}>{error}</span> : null}
        {hasSelection && activePty ? <IconButton label={t('common:terminal.sendSelection')} onClick={() => sendToComposer({ text: `\`\`\`\n${terminalSelection(activePty).trimEnd()}\n\`\`\`` })}><MessageSquarePlus className="h-3.5 w-3.5" /></IconButton> : null}
        <IconButton label={t('common:terminal.detectTasks')} onClick={() => window.dispatchEvent(new Event('pi-desktop:terminal-detect-tasks'))}><Sparkles className="h-3.5 w-3.5" /></IconButton>
        <IconButton label={t('common:terminal.manageTasks')} onClick={() => window.dispatchEvent(new Event('pi-desktop:terminal-manage-tasks'))}><SlidersHorizontal className="h-3.5 w-3.5" /></IconButton>
        <IconButton label={t('common:terminal.new')} onClick={() => { setError(null); void openTerminalTab() }}><Plus className="h-3.5 w-3.5" /></IconButton>
        <IconButton label={t('common:terminal.selectShell')} buttonRef={newRef} active={menuFor === 'new'} onClick={() => setMenuFor(menuFor === 'new' ? null : 'new')}><ChevronDown className="h-3.5 w-3.5" /></IconButton>
        <IconButton label={t('common:terminal.closeAll')} onClick={() => { if (workspaceTabs.length && window.confirm(t('common:terminal.confirmCloseAll', { count: workspaceTabs.length }))) workspaceTabs.forEach((item) => item.panes.forEach((pane) => closePane(pane.ptyId)) ) }}><X className="h-3.5 w-3.5" /></IconButton>
      </div>
      <TerminalRunBar />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {workspaceTabs.map((item, index) => <TerminalBlock key={item.id} tab={item} active={item.id === tab?.id} canResize={index > 0} onClose={closePane} />)}
        {!workspaceTabs.length ? <button type="button" className="m-auto rounded-md px-3 py-1.5 text-[12px] text-foreground-tertiary hover:bg-muted hover:text-foreground" onClick={() => void openTerminalTab()}>{t('common:terminal.empty')}</button> : null}
      </div>
      {menuFor === 'new' && newRef.current ? <ProfileMenu anchor={newRef.current} onPick={(profile) => { setError(null); void openTerminalTab(profile.id) }} onClose={() => setMenuFor(null)} /> : null}
      {restartPrompt ? createPortal(<div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setRestartPrompt(null) }}>
        <div role="dialog" aria-modal="true" aria-label={t('common:terminal.restartTerminal')} className="w-full max-w-md rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl" onKeyDown={(event) => { if (event.key === 'Escape') setRestartPrompt(null) }}>
          <label className="block text-[13px]">{t('common:terminal.enterRestartCommand')}<input autoFocus className="mt-2 w-full rounded border border-border bg-background px-2 py-1.5 outline-none" value={restartCommand} onChange={(event) => setRestartCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && restartCommand.trim()) { window.dispatchEvent(new CustomEvent('pi-desktop:terminal-restart', { detail: { id: restartPrompt, command: restartCommand } })); setRestartPrompt(null) } }} /></label>
          <div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded px-3 py-1.5 hover:bg-muted" onClick={() => setRestartPrompt(null)}>{t('common:cancel')}</button><button type="button" disabled={!restartCommand.trim()} className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" onClick={() => { window.dispatchEvent(new CustomEvent('pi-desktop:terminal-restart', { detail: { id: restartPrompt, command: restartCommand } })); setRestartPrompt(null) }}>{t('common:confirm')}</button></div>
        </div>
      </div>, document.body) : null}
    </div>
  )
}

/** @deprecated The terminal now lives in the right panel. */
export const TerminalDrawer = TerminalPanel
