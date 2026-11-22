import { describe, expect, it } from 'vitest'
import type { TerminalTab } from '@renderer/features/terminal/terminal-store'
import { computeRightPanelBadges, countWorkspaceLiveTerminals } from './right-panel-badges'

describe('right-panel-badges', () => {
  it('computes review, terminal, run, and context warning badges from live state', () => {
    expect(
      computeRightPanelBadges({
        fileChangeCount: 4,
        activeTerminalCount: 2,
        runStatus: 'running',
        contextPct: 84,
      }),
    ).toEqual({
      review: { count: 4, tone: 'neutral' },
      terminal: { count: 2, tone: 'live' },
      run: { dot: true, tone: 'live' },
      context: { dot: true, tone: 'warn' },
    })
  })

  it('omits badges when idle and below warning thresholds', () => {
    expect(
      computeRightPanelBadges({
        fileChangeCount: 0,
        activeTerminalCount: 0,
        runStatus: 'idle',
        contextPct: 65,
      }),
    ).toEqual({})
  })

  it('counts only non-exited terminal panes matching current workspace', () => {
    const profile = { id: 'pwsh', name: 'PowerShell', path: 'pwsh.exe', args: [], kind: 'pwsh' }
    const tabs: TerminalTab[] = [
      {
        id: 't1',
        workspace: 'E:\\Repo',
        panes: [
          { ptyId: 'p1', profile },
          { ptyId: 'p2', profile, exited: 0 },
        ],
        activePane: 0,
        sizes: [0.5, 0.5],
      },
      {
        id: 't2',
        workspace: 'E:\\Other',
        panes: [{ ptyId: 'p3', profile }],
        activePane: 0,
        sizes: [1],
      },
    ]

    expect(countWorkspaceLiveTerminals(tabs, 'e:/repo')).toBe(1)
  })
})
