import { existsSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ShellProfile } from './shell-profiles'

/** The slice of node-pty this module uses (so tests can pass a fake). */
export type PtyProcess = {
  pid: number
  onData(cb: (data: string) => void): { dispose(): void } | void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } | void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
export type SpawnPty = (file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) => PtyProcess

function interactiveShellArgs(profile: ShellProfile): string[] {
  if (process.platform !== 'win32' || profile.kind !== 'bash' || profile.name !== 'Git Bash') return profile.args
  const rcfile = join(tmpdir(), 'pi-desktop-git-bash-prompt.rc')
  const startup = `if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r ~/.bash_profile ]; then . ~/.bash_profile
elif [ -r ~/.bash_login ]; then . ~/.bash_login
elif [ -r ~/.profile ]; then . ~/.profile
fi
PS1='\\w> '
export PS1
`
  try {
    writeFileSync(rcfile, startup, 'utf8')
    return ['--rcfile', rcfile.replace(/\\/g, '/'), '-i']
  } catch {
    return profile.args
  }
}

export type TerminalSink = {
  data(id: string, data: string): void
  exit(id: string, code: number): void
}

/** Output is batched this long before it crosses IPC (a `cat` of a big file would otherwise send thousands of messages). */
const FLUSH_MS = 16
const MAX_BATCH = 256 * 1024

type Entry = { pty: PtyProcess; profile: ShellProfile; cwd: string; workspace: string; command?: string; output: string; buf: string; timer: ReturnType<typeof setTimeout> | null; ready: boolean; resized: boolean; waitForResize: boolean; pending: string[]; readyTimer: ReturnType<typeof setTimeout> | null }

export class PtyManager {
  private readonly ptys = new Map<string, Entry>()
  private seq = 0

  constructor(
    private readonly spawn: SpawnPty,
    private readonly sink: TerminalSink,
    private readonly baseEnv: () => NodeJS.ProcessEnv,
  ) {}

  get count(): number {
    return this.ptys.size
  }

  create(profile: ShellProfile, opts: { cwd?: string; workspace?: string; command?: string; cols: number; rows: number }): { id: string; pid: number } {
    const cwd = opts.cwd && existsSync(opts.cwd) && statSync(opts.cwd).isDirectory() ? opts.cwd : homedir()
    const env = { ...this.baseEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'pi-desktop' }
    const pty = this.spawn(profile.path, interactiveShellArgs(profile), { name: 'xterm-256color', cols: clampDim(opts.cols, 80), rows: clampDim(opts.rows, 24), cwd, env })
    const id = `t${++this.seq}`
    const entry: Entry = { pty, profile, cwd, workspace: opts.workspace || cwd, command: opts.command, output: '', buf: '', timer: null, ready: false, resized: false, waitForResize: false, pending: [], readyTimer: null }
    this.ptys.set(id, entry)
    pty.onData((d) => {
      this.markReady(id)
      this.push(id, d)
    })
    pty.onExit(({ exitCode }) => {
      this.flush(id)
      this.ptys.delete(id)
      this.sink.exit(id, exitCode)
    })
    return { id, pid: pty.pid }
  }

  list(workspace: string): Array<{ id: string; cwd: string; workspace: string; profile: ShellProfile; command?: string; output: string }> {
    const normalized = (value: string) => process.platform === 'win32' ? value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : value.replace(/\/$/, '')
    return [...this.ptys.entries()].filter(([, entry]) => normalized(entry.workspace) === normalized(workspace)).map(([id, entry]) => ({ id, cwd: entry.cwd, workspace: entry.workspace, profile: entry.profile, command: entry.command, output: entry.output }))
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.pty.write(data)
  }

  /** Wait for the shell's first output so a launched command is not typed before it can receive input. */
  writeWhenReady(id: string, data: string, timeoutMs = 5000, waitForResize = false): void {
    const entry = this.ptys.get(id)
    if (!entry) return
    if (entry.ready && (!waitForResize || entry.resized)) {
      entry.pty.write(data)
      return
    }
    entry.pending.push(data)
    entry.waitForResize ||= waitForResize
    if (entry.readyTimer) return
    entry.readyTimer = setTimeout(() => this.flushPending(id, true), timeoutMs)
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.ptys.get(id)
    if (!e) return
    try {
      e.pty.resize(clampDim(cols, 80), clampDim(rows, 24))
      e.resized = true
      this.flushPending(id)
    } catch {
      /* the process may have just exited */
    }
  }

  kill(id: string): void {
    const e = this.ptys.get(id)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    if (e.readyTimer) clearTimeout(e.readyTimer)
    this.ptys.delete(id)
    try {
      e.pty.kill()
    } catch {
      /* already gone */
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }

  private push(id: string, data: string): void {
    const e = this.ptys.get(id)
    if (!e) return
    e.output = (e.output + data).slice(-32_000)
    e.buf += data
    if (e.buf.length >= MAX_BATCH) return this.flush(id)
    if (!e.timer) e.timer = setTimeout(() => this.flush(id), FLUSH_MS)
  }

  private flush(id: string): void {
    const e = this.ptys.get(id)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    e.timer = null
    if (!e.buf) return
    const out = e.buf
    e.buf = ''
    this.sink.data(id, out)
  }

  private markReady(id: string): void {
    const entry = this.ptys.get(id)
    if (!entry || entry.ready) return
    entry.ready = true
    this.flushPending(id)
  }

  private flushPending(id: string, force = false): void {
    const entry = this.ptys.get(id)
    if (!entry || (!force && (!entry.ready || (entry.waitForResize && !entry.resized)))) return
    if (force) entry.ready = true
    if (entry.readyTimer) clearTimeout(entry.readyTimer)
    entry.readyTimer = null
    entry.waitForResize = false
    for (const data of entry.pending.splice(0)) entry.pty.write(data)
  }
}

function clampDim(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 2 ? Math.min(Math.floor(n), 1000) : fallback
}
