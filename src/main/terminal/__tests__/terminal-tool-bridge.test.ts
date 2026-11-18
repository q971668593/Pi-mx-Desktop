import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type OpenTerminal = { id: string; cwd: string; workspace: string; profile: { id: string; name: string; path: string; args: string[]; kind: string }; command?: string; output: string; owner: 'user' | 'ai'; state: 'idle' | 'busy'; markers: string[] }

const mocks = vi.hoisted(() => ({
  project: '',
  send: vi.fn(),
  create: vi.fn(() => ({ id: 'terminal-new', pid: 42 })),
  list: vi.fn(() => [] as OpenTerminal[]),
  writeWhenReady: vi.fn(),
  send2: vi.fn(),
  close: vi.fn(),
  kill: vi.fn(),
}))
vi.mock('../../trusted-workspace', () => ({ authorizeProjectCwd: (cwd: string) => cwd === mocks.project ? { ok: true, cwd } : { ok: false, error: 'cwd_not_trusted' } }))
vi.mock('../../window', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: mocks.send } }) }))
vi.mock('../terminal-service', () => ({ TERMINAL_REVEAL_CHANNEL: 'ipc:terminal-reveal', terminalProfiles: () => [{ id: 'shell', name: 'Shell', path: 'shell', args: [], kind: 'bash', piDefault: true }], terminals: () => ({ create: mocks.create, list: mocks.list, writeWhenReady: mocks.writeWhenReady, send: mocks.send2, close: mocks.close, kill: mocks.kill }) }))

import { handleTerminalToolRequest } from '../terminal-tool-bridge'

const profile = { id: 'shell', name: 'Shell', path: 'shell', args: [], kind: 'bash' }
const open = (over: Partial<OpenTerminal> = {}): OpenTerminal => ({ id: 'old', cwd: mocks.project, workspace: mocks.project, profile, command: 'npm run dev\r', output: '', owner: 'ai', state: 'idle', markers: [], ...over })

describe('terminal tool bridge', () => {
  afterEach(async () => { if (mocks.project) await rm(mocks.project, { recursive: true, force: true }); vi.clearAllMocks(); mocks.project = '' })

  it('starts a visible terminal under the project and rejects paths outside it', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'one', args: { action: 'start', command: 'npm', args: ['run', 'dev'] } }, { cwd: mocks.project }, post)
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspace: mocks.project, cwd: mocks.project, owner: 'ai', markers: [expect.any(String)] }))
    expect(mocks.send).toHaveBeenCalledWith('ipc:terminal-created', expect.objectContaining({ id: 'terminal-new', workspace: mocks.project }))
    expect(mocks.writeWhenReady).toHaveBeenCalledWith('terminal-new', expect.stringContaining('npm'))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ callId: 'one', result: expect.objectContaining({ isError: false }) }))

    mocks.create.mockClear()
    await handleTerminalToolRequest({ callId: 'two', args: { action: 'start', command: 'npm', cwd: '..' } }, { cwd: mocks.project }, post)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ callId: 'two', result: expect.objectContaining({ isError: true }) }))
  })

  it('reuses an idle terminal it opened, clearing it instead of adding another', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValueOnce([open({ id: 'ai-one' })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'reuse', args: { action: 'start', command: 'npx', args: ['tsc', '--noEmit'] } }, { cwd: mocks.project }, post)
    expect(mocks.create).not.toHaveBeenCalled()
    const [id, line, markers] = mocks.send2.mock.calls[0] as unknown as [string, string, string[]]
    expect(id).toBe('ai-one')
    expect(line).toContain('clear')
    expect(line).toContain('npx')
    expect(markers).toHaveLength(1)
    // The marker must not appear in the typed text: the terminal echo would look like completion.
    expect(line).not.toContain(markers[0])
    expect(markers[0]).toMatch(/^__PI_DONE_\d+_\d+__$/)
    expect(line).toContain("echo __PI'")
    expect(mocks.send).toHaveBeenCalledWith('ipc:terminal-reveal', { id: 'ai-one', workspace: mocks.project })
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ callId: 'reuse', result: expect.objectContaining({ isError: false, content: [{ type: 'text', text: expect.stringContaining('reused') }] }) }))
  })

  it('never reuses or closes a terminal the user opened, and skips busy ones', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValue([open({ id: 'user-one', owner: 'user' }), open({ id: 'ai-busy', state: 'busy' })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'start', args: { action: 'start', command: 'npm', args: ['test'] } }, { cwd: mocks.project }, post)
    expect(mocks.send2).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)

    await handleTerminalToolRequest({ callId: 'close', args: { action: 'close', id: 'user-one' } }, { cwd: mocks.project }, post)
    expect(mocks.close).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ callId: 'close', result: expect.objectContaining({ isError: true }) }))
  })

  it('closes the terminals it opened', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValue([open({ id: 'ai-one' }), open({ id: 'ai-two', state: 'busy' })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'close', args: { action: 'close', all: true } }, { cwd: mocks.project }, post)
    expect(mocks.close.mock.calls).toEqual([['ai-one'], ['ai-two']])
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ callId: 'close', result: expect.objectContaining({ isError: false }) }))
  })

  it('restarts only a terminal owned by the requesting project', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValueOnce([open({ id: 'old' })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'restart', args: { action: 'restart', id: 'old' } }, { cwd: mocks.project }, post)
    expect(mocks.list).toHaveBeenCalledWith(mocks.project)
    expect(mocks.kill).toHaveBeenCalledWith('old')
    expect(mocks.send).toHaveBeenCalledWith('ipc:terminal-created', expect.objectContaining({ previous: 'old', id: 'terminal-new' }))
    expect(mocks.writeWhenReady).toHaveBeenCalledWith('terminal-new', 'npm run dev\r')
  })
})
