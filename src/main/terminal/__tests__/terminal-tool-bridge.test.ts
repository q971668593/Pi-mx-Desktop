import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  project: '',
  send: vi.fn(),
  create: vi.fn(() => ({ id: 'terminal-new', pid: 42 })),
  list: vi.fn(() => [] as Array<{ id: string; cwd: string; workspace: string; profile: { id: string; name: string; path: string; args: string[]; kind: string }; command?: string; output: string }>),
  writeWhenReady: vi.fn(),
  kill: vi.fn(),
}))
vi.mock('../../trusted-workspace', () => ({ authorizeProjectCwd: (cwd: string) => cwd === mocks.project ? { ok: true, cwd } : { ok: false, error: 'cwd_not_trusted' } }))
vi.mock('../../window', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: mocks.send } }) }))
vi.mock('../terminal-service', () => ({ terminalProfiles: () => [{ id: 'shell', name: 'Shell', path: 'shell', args: [], kind: 'bash', piDefault: true }], terminals: () => mocks }))

import { handleTerminalToolRequest } from '../terminal-tool-bridge'

describe('terminal tool bridge', () => {
  afterEach(async () => { if (mocks.project) await rm(mocks.project, { recursive: true, force: true }); vi.clearAllMocks(); mocks.project = '' })

  it('starts a visible terminal under the project and rejects paths outside it', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'one', args: { action: 'start', command: 'npm', args: ['run', 'dev'] } }, { cwd: mocks.project }, post)
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspace: mocks.project, cwd: mocks.project }))
    expect(mocks.send).toHaveBeenCalledWith('ipc:terminal-created', expect.objectContaining({ id: 'terminal-new', workspace: mocks.project }))
    expect(mocks.writeWhenReady).toHaveBeenCalledWith('terminal-new', expect.stringContaining('npm'))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ callId: 'one', result: expect.objectContaining({ isError: false }) }))

    mocks.create.mockClear()
    await handleTerminalToolRequest({ callId: 'two', args: { action: 'start', command: 'npm', cwd: '..' } }, { cwd: mocks.project }, post)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ callId: 'two', result: expect.objectContaining({ isError: true }) }))
  })

  it('restarts only a terminal owned by the requesting project', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    const profile = { id: 'shell', name: 'Shell', path: 'shell', args: [], kind: 'bash' }
    mocks.list.mockReturnValueOnce([{ id: 'old', cwd: mocks.project, workspace: mocks.project, profile, command: 'npm run dev\r', output: '' }])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'restart', args: { action: 'restart', id: 'old' } }, { cwd: mocks.project }, post)
    expect(mocks.list).toHaveBeenCalledWith(mocks.project)
    expect(mocks.kill).toHaveBeenCalledWith('old')
    expect(mocks.send).toHaveBeenCalledWith('ipc:terminal-created', expect.objectContaining({ previous: 'old', id: 'terminal-new' }))
    expect(mocks.writeWhenReady).toHaveBeenCalledWith('terminal-new', 'npm run dev\r')
  })
})
