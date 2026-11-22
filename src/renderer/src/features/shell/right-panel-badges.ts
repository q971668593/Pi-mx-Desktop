import type { TerminalTab } from '@renderer/features/terminal/terminal-store'
import { workspacePathsEqual } from '@shared/workspace-path'

export type RightPanelBadge = {
  count?: number
  dot?: boolean
  tone?: 'live' | 'warn' | 'neutral'
}

export function countWorkspaceLiveTerminals(tabs: TerminalTab[], workspace: string | null): number {
  let count = 0
  for (const tab of tabs) {
    if (workspace && tab.workspace && !workspacePathsEqual(tab.workspace, workspace)) continue
    for (const pane of tab.panes) {
      if (pane.exited === undefined) count += 1
    }
  }
  return count
}

/** Computes live status badges for right-panel tabs without altering panel order or labels. */
export function computeRightPanelBadges(input: {
  fileChangeCount: number
  activeTerminalCount: number
  runStatus: string
  contextPct: number | null
}): Record<string, RightPanelBadge> {
  const badges: Record<string, RightPanelBadge> = {}
  if (input.fileChangeCount > 0) {
    badges.review = { count: input.fileChangeCount, tone: 'neutral' }
  }
  if (input.activeTerminalCount > 0) {
    badges.terminal = { count: input.activeTerminalCount, tone: 'live' }
  }
  if (input.runStatus === 'running') {
    badges.run = { dot: true, tone: 'live' }
  }
  if (input.contextPct != null && input.contextPct >= 80) {
    badges.context = { dot: true, tone: 'warn' }
  }
  return badges
}
