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

/** 比较路径用：Windows 不分大小写、分隔符统一成 `/`、去掉结尾斜杠。 */
function normalizePath(value: string): string {
  const text = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? text.toLowerCase() : text
}

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

/** Who opened the terminal: the user (sidebar / a task button) or the AI through desktop_terminal. */
export type TerminalOwner = 'user' | 'ai'
/** `busy` while a command the tool typed still runs; its completion marker flips it back to `idle`. */
export type TerminalState = 'idle' | 'busy'

export type TerminalSink = {
  data(id: string, data: string): void
  exit(id: string, code: number): void
  /** The tool closed the terminal: the sidebar drops the pane instead of keeping the dead output. */
  closed?(id: string): void
}

/** Output is batched this long before it crosses IPC (a `cat` of a big file would otherwise send thousands of messages). */
const FLUSH_MS = 16
const MAX_BATCH = 256 * 1024

type Entry = { pty: PtyProcess; profile: ShellProfile; cwd: string; workspace: string; command?: string; output: string; buf: string; timer: ReturnType<typeof setTimeout> | null; ready: boolean; resized: boolean; waitForResize: boolean; pending: string[]; readyTimer: ReturnType<typeof setTimeout> | null; owner: TerminalOwner; state: TerminalState; markers: string[] }

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

  create(profile: ShellProfile, opts: { cwd?: string; workspace?: string; command?: string; cols: number; rows: number; owner?: TerminalOwner; markers?: string[]; env?: NodeJS.ProcessEnv }): { id: string; pid: number } {
    const cwd = opts.cwd && existsSync(opts.cwd) && statSync(opts.cwd).isDirectory() ? opts.cwd : homedir()
    const env = { ...this.baseEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'pi-desktop', ...opts.env }
    const pty = this.spawn(profile.path, interactiveShellArgs(profile), { name: 'xterm-256color', cols: clampDim(opts.cols, 80), rows: clampDim(opts.rows, 24), cwd, env })
    const id = `t${++this.seq}`
    const markers = [...(opts.markers ?? [])]
    const entry: Entry = { pty, profile, cwd, workspace: opts.workspace || cwd, command: opts.command, output: '', buf: '', timer: null, ready: false, resized: false, waitForResize: false, pending: [], readyTimer: null, owner: opts.owner === 'ai' ? 'ai' : 'user', state: markers.length ? 'busy' : 'idle', markers }
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

  list(workspace: string): Array<{ id: string; cwd: string; workspace: string; profile: ShellProfile; command?: string; output: string; owner: TerminalOwner; state: TerminalState; markers: string[] }> {
    const normalized = (value: string) => process.platform === 'win32' ? value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : value.replace(/\/$/, '')
    return [...this.ptys.entries()].filter(([, entry]) => normalized(entry.workspace) === normalized(workspace)).map(([id, entry]) => ({ id, cwd: entry.cwd, workspace: entry.workspace, profile: entry.profile, command: entry.command, output: entry.output, owner: entry.owner, state: entry.state, markers: [...entry.markers] }))
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.pty.write(data)
  }

  /**
   * Type a command into a terminal that is already open (the tool reuses an idle one instead of
   * opening another) and watch for its completion marker, which clears the marker from the output.
   */
  send(id: string, line: string, markers: string[] = [], timeoutMs = 5000): void {
    const entry = this.ptys.get(id)
    if (!entry) return
    for (const marker of markers) if (!entry.markers.includes(marker)) entry.markers.push(marker)
    if (markers.length) entry.state = 'busy'
    this.writeWhenReady(id, line, timeoutMs)
  }

  /** Close from the tool side: the pane goes away instead of staying as a dead terminal. */
  close(id: string): void {
    if (!this.ptys.has(id)) return
    this.kill(id)
    this.sink.closed?.(id)
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

  /**
   * 项目被隐藏 / 从列表移除时，把它底下起的终端全部停掉。
   * 只认 workspace 落在该目录内（含子目录）的，别人的终端不受影响。
   */
  killWorkspace(root: string): string[] {
    const wanted = normalizePath(root)
    if (!wanted) return []
    const killed: string[] = []
    for (const [id, entry] of [...this.ptys]) {
      const workspace = normalizePath(entry.workspace)
      if (workspace === wanted || workspace.startsWith(`${wanted}/`)) {
        this.kill(id)
        killed.push(id)
      }
    }
    return killed
  }

  private push(id: string, data: string): void {
    const e = this.ptys.get(id)
    if (!e) return
    // Markers are matched on the unsent batch so one split across two chunks still counts.
    e.buf += data
    let text = data
    for (const marker of e.markers) {
      if (!e.buf.includes(marker)) continue
      e.state = 'idle'
      e.buf = e.buf.split(marker).join('')
      text = text.split(marker).join('')
    }
    if (text) e.output = (e.output + text).slice(-32_000)
    if (!e.buf) return
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
