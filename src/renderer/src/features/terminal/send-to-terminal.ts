import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import { spawnPane, writeToPty } from './terminal-bridge'
import { terminalActions, useTerminalStore, type TerminalTab } from './terminal-store'

const SHELL_LANGUAGES = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'pwsh',
  'powershell',
  'ps1',
  'cmd',
  'bat',
  'console',
  'terminal',
])

export function isShellLanguage(lang?: string): boolean {
  if (!lang) return false
  return SHELL_LANGUAGES.has(lang.trim().toLowerCase())
}

function findLivePaneForWorkspace(tabs: TerminalTab[], activeByWorkspace: Record<string, string>, activeTabId: string | null, cwd?: string): { tabId: string; ptyId: string } | null {
  const matchingTabs = cwd
    ? tabs.filter((tab) => !tab.workspace || workspacePathsEqual(tab.workspace, cwd))
    : tabs
  const preferredId = cwd ? activeByWorkspace[workspacePathKey(cwd)] ?? activeTabId : activeTabId
  const ordered = preferredId
    ? [...matchingTabs].sort((a, b) => (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0))
    : matchingTabs

  for (const tab of ordered) {
    const activePane = tab.panes[tab.activePane]
    if (activePane && activePane.exited === undefined) return { tabId: tab.id, ptyId: activePane.ptyId }
    const fallback = tab.panes.find((p) => p.exited === undefined)
    if (fallback) return { tabId: tab.id, ptyId: fallback.ptyId }
  }
  return null
}

/**
 * Inserts a shell snippet into the active (or newly spawned) workspace terminal without sending Enter,
 * so the developer can review or edit before executing.
 */
export async function sendCommandToTerminal(code: string): Promise<boolean> {
  const payload = code.replace(/^\r?\n+|\r?\n+$/g, '')
  if (!payload.trim()) return false

  const ui = useUIStore.getState()
  const cwd = ui.currentWorkspace || undefined
  ui.setActivePanel('terminal')
  ui.revealRightPanel()

  const term = useTerminalStore.getState()
  let target = findLivePaneForWorkspace(term.tabs, term.activeByWorkspace, term.activeTab, cwd)
  let delayMs = 0

  if (!target) {
    const spawned = await spawnPane(undefined, cwd, cwd)
    if ('error' in spawned) {
      toast.error(i18n.t('timeline:sendToTerminalFailed'))
      return false
    }
    const tabId = terminalActions.addTab(spawned, cwd, cwd)
    target = { tabId, ptyId: spawned.ptyId }
    delayMs = 150
  } else {
    terminalActions.focusTab(target.tabId)
  }

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  writeToPty(target.ptyId, payload)
  toast.success(i18n.t('timeline:sentToTerminal'))
  return true
}
