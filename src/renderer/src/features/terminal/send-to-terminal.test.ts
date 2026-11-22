import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeToPty: vi.fn(),
  spawnPane: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  setActivePanel: vi.fn(),
  revealRightPanel: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@renderer/lib/i18n', () => ({
  default: { t: (k: string) => k },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      currentWorkspace: '/repo',
      setActivePanel: mocks.setActivePanel,
      revealRightPanel: mocks.revealRightPanel,
    }),
  },
}))

vi.mock('./terminal-bridge', () => ({
  writeToPty: mocks.writeToPty,
  spawnPane: mocks.spawnPane,
}))

import { isShellLanguage, sendCommandToTerminal } from './send-to-terminal'
import { terminalActions, useTerminalStore } from './terminal-store'

describe('send-to-terminal', () => {
  beforeEach(() => {
    mocks.writeToPty.mockReset()
    mocks.spawnPane.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.setActivePanel.mockReset()
    mocks.revealRightPanel.mockReset()
    useTerminalStore.setState({ open: false, tabs: [], activeTab: null, activeByWorkspace: {}, profiles: null })
  })

  it('detects shell languages case-insensitively', () => {
    expect(isShellLanguage('bash')).toBe(true)
    expect(isShellLanguage('PWSH')).toBe(true)
    expect(isShellLanguage('sh')).toBe(true)
    expect(isShellLanguage('typescript')).toBe(false)
    expect(isShellLanguage(undefined)).toBe(false)
  })

  it('writes command to an existing workspace pane without trailing newline', async () => {
    terminalActions.addTab(
      { ptyId: 'pty-1', profile: { id: 'pwsh', name: 'PowerShell', path: 'pwsh.exe', args: [], kind: 'pwsh' } },
      '/repo',
      '/repo',
    )

    const ok = await sendCommandToTerminal('\nnpm run test:unit\n')
    expect(ok).toBe(true)
    expect(mocks.setActivePanel).toHaveBeenCalledWith('terminal')
    expect(mocks.revealRightPanel).toHaveBeenCalled()
    expect(mocks.spawnPane).not.toHaveBeenCalled()
    expect(mocks.writeToPty).toHaveBeenCalledWith('pty-1', 'npm run test:unit')
    expect(mocks.toastSuccess).toHaveBeenCalledWith('timeline:sentToTerminal')
  })

  it('spawns a new terminal pane when none is alive for the workspace', async () => {
    mocks.spawnPane.mockResolvedValue({
      ptyId: 'pty-new',
      profile: { id: 'bash', name: 'bash', path: 'bash', args: [], kind: 'bash' },
    })

    const ok = await sendCommandToTerminal('echo hello')
    expect(ok).toBe(true)
    expect(mocks.spawnPane).toHaveBeenCalledWith(undefined, '/repo', '/repo')
    expect(mocks.writeToPty).toHaveBeenCalledWith('pty-new', 'echo hello')
  })
})
