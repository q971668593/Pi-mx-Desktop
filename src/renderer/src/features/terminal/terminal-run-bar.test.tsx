import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const groups = [
    { kind: 'build', label: 'Run', isDefault: true, tasks: [{ label: 'web', command: 'npm', args: ['run', 'dev'], cwd: 'C:/project' }] },
    { kind: 'publish', label: 'Publish', isDefault: false, tasks: [{ label: 'release', command: 'npm', args: ['run', 'publish'], cwd: 'C:/project' }] },
  ]
  const invoke = vi.fn(async (method: string) => {
    if (method === 'workspace.tasks.get') return { groups: [groups[0]] }
    if (method === 'workspace.fs.listDir') return { entries: [] }
    if (method === 'workspace.tasks.draft') return { ok: true, content: '{}', groups }
    if (method === 'workspace.tasks.save') return { ok: true, groups }
    if (method === 'terminal.runTasks') return { ok: true, profile: { id: 'test', name: 'test', path: 'test', args: [], kind: 'bash' }, terminals: [{ id: 't1', label: 'release' }] }
    return { ok: false }
  })
  return { groups, invoke, addTab: vi.fn() }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/components/icons', () => ({ Play: () => null, Sparkles: () => null, Upload: () => null }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/stores/ui-store', () => ({ useUIStore: (selector: (state: unknown) => unknown) => selector({ currentWorkspace: 'C:/project' }) }))
vi.mock('./terminal-store', () => ({ useTerminalStore: (selector: (state: unknown) => unknown) => selector({ profiles: [] }), terminalActions: { addTab: mocks.addTab } }))
vi.mock('./terminal-bridge', () => ({ spawnPane: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TerminalRunBar } from './terminal-run-bar'

afterEach(cleanup)

it('allows AI task detection with existing tasks and runs only the selected draft commands', async () => {
  render(<TerminalRunBar />)
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('workspace.tasks.get', { cwd: 'C:/project' }))
  act(() => window.dispatchEvent(new Event('pi-desktop:terminal-detect-tasks')))
  const dialog = await screen.findByRole('dialog')
  const boxes = dialog.querySelectorAll('input[type="checkbox"]')
  expect(boxes).toHaveLength(2)
  expect(boxes[0]).toBeChecked()
  fireEvent.click(boxes[0])
  fireEvent.click(boxes[1])
  fireEvent.click(screen.getByRole('button', { name: 'common:terminal.saveAndRun' }))
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('terminal.runTasks', expect.objectContaining({ tasks: [mocks.groups[1].tasks[0]] })))
})
