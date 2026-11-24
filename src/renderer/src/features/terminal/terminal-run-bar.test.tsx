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

it('restores an in-flight detection and its draft after the panel unmounts', async () => {
  let resolve!: (result: { ok: boolean; content: string; groups: typeof mocks.groups }) => void
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === 'workspace.tasks.get') return { groups: [mocks.groups[0]] }
    if (method === 'workspace.fs.listDir') return { entries: [] }
    if (method === 'workspace.tasks.draft') return new Promise((done) => { resolve = done })
    return { ok: false }
  })
  const view = render(<TerminalRunBar />)
  await waitFor(() => expect(screen.getByText('common:terminal.run')).toBeTruthy())
  act(() => window.dispatchEvent(new Event('pi-desktop:terminal-detect-tasks')))
  await waitFor(() => expect(resolve).toBeDefined())
  view.unmount()
  render(<TerminalRunBar />)
  expect(await screen.findByRole('status')).toHaveTextContent('common:terminal.detecting')
  await act(async () => resolve({ ok: true, content: '{}', groups: mocks.groups }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'common:terminal.saveAndRun' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'common:cancel' }))
})

it('lists tasks with a one-line description and can delete a group', async () => {
  mocks.invoke.mockClear()
  render(<TerminalRunBar />)
  // 等本次挂载真的发过 get（上一轮的调用记录不能算数，否则事件还没挂上）
  await waitFor(() =>
    expect(mocks.invoke.mock.calls.some(([method]) => method === 'workspace.tasks.get')).toBe(true),
  )

  // 下一次 workspace.tasks.get 返回带 description 的完整列表（管理对话框用）
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === 'workspace.tasks.get') {
      return {
        ok: true,
        groups: [mocks.groups[0]],
        labels: ['dev:api', 'Run'],
        definitions: [
          { label: 'dev:api', dependsOn: [], detail: '运行开发服务（dev:api）' },
          { label: 'Run', dependsOn: ['dev:api'], detail: '同时启动 1 个任务' },
        ],
      }
    }
    if (method === 'workspace.tasks.delete') return { ok: true, groups: [], removed: ['Run'], definitions: [] }
    return { ok: false }
  })
  act(() => window.dispatchEvent(new Event('pi-desktop:terminal-manage-tasks')))

  const dialog = await screen.findByRole('dialog')
  // 右侧那句中文说明
  expect(await screen.findByText('运行开发服务（dev:api）')).toBeTruthy()
  expect(screen.getByText('同时启动 1 个任务')).toBeTruthy()

  // 两段式删除：第一次点只是进入确认态，第二次才真的调用
  const del = screen.getByRole('button', { name: 'common:terminal.deleteGroupNamed' })
  fireEvent.click(del)
  expect(mocks.invoke).not.toHaveBeenCalledWith('workspace.tasks.delete', expect.anything())
  fireEvent.click(del)
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('workspace.tasks.delete', { cwd: 'C:/project', label: 'Run' }),
  )
  expect(dialog).toBeTruthy()
})
