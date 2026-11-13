import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtyManager, type PtyProcess } from '../pty-manager'

function fakePty() {
  let onData: (d: string) => void = () => {}
  let onExit: (e: { exitCode: number }) => void = () => {}
  const p = {
    pid: 42,
    written: [] as string[],
    size: [0, 0],
    killed: false,
    onData: (cb: (d: string) => void) => void (onData = cb),
    onExit: (cb: (e: { exitCode: number }) => void) => void (onExit = cb),
    write(d: string) {
      p.written.push(d)
    },
    resize(c: number, r: number) {
      p.size = [c, r]
    },
    kill() {
      p.killed = true
    },
    emit: (d: string) => onData(d),
    exit: (code: number) => onExit({ exitCode: code }),
  }
  return p
}

const profile = { id: 'bash:/bin/bash', name: 'bash', path: '/bin/bash', args: ['-l'], kind: 'bash' as const }

describe('PtyManager', () => {
  afterEach(() => vi.useRealTimers())

  it('spawns with the terminal env, batches output and reports exit', () => {
    vi.useFakeTimers()
    const pty = fakePty()
    const spawn = vi.fn(() => pty as unknown as PtyProcess)
    const sink = { data: vi.fn(), exit: vi.fn() }
    const m = new PtyManager(spawn, sink, () => ({ PATH: '/pi/bin:/usr/bin' }))
    const { id } = m.create(profile, { cwd: '/definitely/missing', cols: 120, rows: 30 })
    const [file, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: NodeJS.ProcessEnv; cols: number }]
    expect([file, args, opts.cols]).toEqual(['/bin/bash', ['-l'], 120])
    expect(opts.env).toMatchObject({ PATH: '/pi/bin:/usr/bin', TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    expect(opts.cwd).not.toBe('/definitely/missing')
    pty.emit('a')
    pty.emit('b')
    expect(sink.data).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(sink.data).toHaveBeenCalledWith(id, 'ab')
    pty.emit('tail')
    pty.exit(3)
    expect(sink.data).toHaveBeenLastCalledWith(id, 'tail')
    expect(sink.exit).toHaveBeenCalledWith(id, 3)
    expect(m.count).toBe(0)
  })

  it('writes, resizes (clamped) and kills', () => {
    const pty = fakePty()
    const m = new PtyManager(() => pty as unknown as PtyProcess, { data: vi.fn(), exit: vi.fn() }, () => ({}))
    const { id } = m.create(profile, { cols: 80, rows: 24 })
    m.write(id, 'ls\r')
    m.resize(id, 0, 5000)
    expect(pty.written).toEqual(['ls\r'])
    expect(pty.size).toEqual([80, 1000])
    expect(m.count).toBe(1)
    m.killAll()
    expect(pty.killed).toBe(true)
    expect(m.count).toBe(0)
  })

  it('only exposes terminal output to its owning project and bounds retained output', () => {
    const pty = fakePty()
    const manager = new PtyManager(() => pty as unknown as PtyProcess, { data: vi.fn(), exit: vi.fn() }, () => ({}))
    const { id } = manager.create(profile, { workspace: 'project-one', command: 'npm run dev', cols: 80, rows: 24 })
    pty.emit('x'.repeat(35_000))
    expect(manager.list('project-two')).toEqual([])
    expect(manager.list('project-one')).toMatchObject([{ id, command: 'npm run dev', output: 'x'.repeat(32_000) }])
    manager.kill(id)
    expect(manager.list('project-one')).toEqual([])
  })

  it('types a task only after the shell can receive it', () => {
    vi.useFakeTimers()
    const pty = fakePty()
    const m = new PtyManager(() => pty as unknown as PtyProcess, { data: vi.fn(), exit: vi.fn() }, () => ({}))
    const { id } = m.create(profile, { cols: 80, rows: 24 })
    m.writeWhenReady(id, 'npm run dev\r')
    vi.advanceTimersByTime(200)
    expect(pty.written).toEqual([])
    pty.emit('PS> ')
    expect(pty.written).toEqual(['npm run dev\r'])
  })

  it('does not leave a task waiting when the shell stays silent', () => {
    vi.useFakeTimers()
    const pty = fakePty()
    const m = new PtyManager(() => pty as unknown as PtyProcess, { data: vi.fn(), exit: vi.fn() }, () => ({}))
    const { id } = m.create(profile, { cols: 80, rows: 24 })
    m.writeWhenReady(id, 'npm run dev\r', 5000)
    vi.advanceTimersByTime(4999)
    expect(pty.written).toEqual([])
    vi.advanceTimersByTime(1)
    expect(pty.written).toEqual(['npm run dev\r'])
  })

  it('waits for the visible terminal size before starting a task', () => {
    vi.useFakeTimers()
    const pty = fakePty()
    const manager = new PtyManager(() => pty as unknown as PtyProcess, { data: vi.fn(), exit: vi.fn() }, () => ({}))
    const { id } = manager.create(profile, { cols: 100, rows: 24 })
    manager.writeWhenReady(id, 'npm run dev\r', 5000, true)
    pty.emit('ready')
    expect(pty.written).toEqual([])
    manager.resize(id, 80, 40)
    expect(pty.size).toEqual([80, 40])
    expect(pty.written).toEqual(['npm run dev\r'])
    vi.advanceTimersByTime(5000)
    expect(pty.written).toEqual(['npm run dev\r'])
  })

  it('starts when shell readiness and sizing arrive in either order, with a timeout fallback', () => {
    vi.useFakeTimers()
    const first = fakePty()
    const second = fakePty()
    const ptys = [first, second]
    const manager = new PtyManager(() => ptys.shift() as unknown as PtyProcess, { data: vi.fn(), exit: vi.fn() }, () => ({}))
    const one = manager.create(profile, { cols: 80, rows: 24 })
    manager.resize(one.id, 90, 30)
    manager.writeWhenReady(one.id, 'first\r', 5000, true)
    first.emit('ready')
    expect(first.written).toEqual(['first\r'])
    const two = manager.create(profile, { cols: 80, rows: 24 })
    manager.writeWhenReady(two.id, 'second\r', 5000, true)
    second.emit('ready')
    vi.advanceTimersByTime(5000)
    expect(second.written).toEqual(['second\r'])
  })
})
