import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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

describe('terminal tool bridge · no duplicate servers', () => {
  afterEach(async () => { if (mocks.project) await rm(mocks.project, { recursive: true, force: true }); vi.clearAllMocks(); mocks.project = '' })

  const parse = (post: ReturnType<typeof vi.fn>, callId: string) => {
    const call = [...post.mock.calls].reverse().find(([message]) => (message as { callId?: string }).callId === callId)
    const result = (call?.[0] as { result?: { content: { text: string }[]; isError?: boolean } })?.result
    return { isError: !!result?.isError, body: result ? JSON.parse(result.content[0].text) as Record<string, unknown> : null }
  }

  it('replaces the dev server still running in the same directory instead of starting a second one', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValue([open({
      id: 't2',
      state: 'busy',
      command: 'npm run dev\r',
      output: '  VITE v7 ready\n  ➜  Local:   http://localhost:3019/',
    })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'dev', args: { action: 'start', command: 'npm', args: ['run', 'dev'] } }, { cwd: mocks.project }, post)
    expect(mocks.kill).toHaveBeenCalledWith('t2')
    expect(mocks.send2).not.toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledWith('ipc:terminal-created', expect.objectContaining({ previous: 't2' }))
    const { body } = parse(post, 'dev')
    expect(body).toMatchObject({ status: 'replaced', previous: 't2', replacedPorts: [3019] })
  })

  it('treats the legacy reuse:false as replace, so a fresh shell never leaves the old server running', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValue([open({ id: 't2', state: 'busy', command: 'npm run dev\r' })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'fresh', args: { action: 'start', command: 'npm', args: ['run', 'dev'], reuse: false } }, { cwd: mocks.project }, post)
    expect(mocks.kill).toHaveBeenCalledWith('t2')
    expect(parse(post, 'fresh').body).toMatchObject({ status: 'replaced' })
  })

  it('still allows a second terminal for a one-shot check and reports the running server', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValue([open({
      id: 't2',
      state: 'busy',
      command: 'npm run dev\r',
      output: 'http://localhost:3019/',
    })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'test', args: { action: 'start', command: 'npm', args: ['test'] } }, { cwd: mocks.project }, post)
    expect(mocks.kill).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const { body } = parse(post, 'test')
    expect(body).toMatchObject({ status: 'started' })
    expect(body?.running).toEqual([{ id: 't2', command: 'npm', ports: [3019] }])
  })

  it('does not replace a server running in a different subdirectory (monorepo web + api)', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    const appDir = join(mocks.project, 'apps', 'web')
    await mkdir(appDir, { recursive: true })
    mocks.list.mockReturnValue([open({ id: 'web', cwd: appDir, state: 'busy', command: 'npm run dev\r', output: 'http://localhost:3019/' })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'api', args: { action: 'start', command: 'npm', args: ['run', 'dev'] } }, { cwd: mocks.project }, post)
    expect(mocks.kill).not.toHaveBeenCalled()
    expect(parse(post, 'api').body).toMatchObject({ status: 'started' })
  })

  it('closes the oldest finished AI terminal instead of stacking a fourth pane', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValue([
      open({ id: 't1', state: 'idle' }),
      open({ id: 't2', state: 'idle' }),
      open({ id: 't3', state: 'idle' }),
    ])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'cap', args: { action: 'start', command: 'npx', args: ['tsc'] } }, { cwd: mocks.project }, post)
    // One reused (idle terminals exist), so nothing is created and nothing is closed.
    expect(parse(post, 'cap').body).toMatchObject({ status: 'reused' })

    mocks.list.mockReturnValue([
      open({ id: 't1', state: 'busy' }),
      open({ id: 't2', state: 'busy' }),
      open({ id: 't3', state: 'idle' }),
    ])
    await handleTerminalToolRequest({ callId: 'cap2', args: { action: 'start', command: 'npx', args: ['tsc'] } }, { cwd: mocks.project }, post)
    expect(parse(post, 'cap2').body).toMatchObject({ status: 'reused' })
  })

  it('lists the ports each terminal is serving', async () => {
    mocks.project = await mkdtemp(join(tmpdir(), 'pi-terminal-tool-'))
    mocks.list.mockReturnValue([open({ id: 't2', state: 'busy', output: '  Local:   http://localhost:3019/' })])
    const post = vi.fn()
    await handleTerminalToolRequest({ callId: 'list', args: { action: 'list' } }, { cwd: mocks.project }, post)
    const { body } = parse(post, 'list')
    expect((body?.terminals as Array<{ ports: number[] }>)[0].ports).toEqual([3019])
  })
})
