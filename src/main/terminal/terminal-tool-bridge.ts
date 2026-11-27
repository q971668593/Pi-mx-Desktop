import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { getMainWindow } from '../window'
import { authorizeProjectCwd } from '../trusted-workspace'
import { resolvePathUnderWorkspace } from '../workspace-fs'
import { commandLine, shellSetup } from '../workspace-tasks'
import { detectListeningPorts, isServerCommand } from '@shared/terminal-ports'
import { TERMINAL_REVEAL_CHANNEL, terminalProfiles, terminals } from './terminal-service'
import type { ShellProfile } from './shell-profiles'

type Args = { action?: unknown; id?: unknown; command?: unknown; args?: unknown; cwd?: unknown; label?: unknown; reuse?: unknown; replace?: unknown; all?: unknown }
type Task = { label: string; command: string; args: string[]; cwd: string }
type OpenTerminal = ReturnType<ReturnType<typeof terminals>['list']>[number]

/**
 * At most this many AI terminals per project. Beyond it the oldest finished one is closed when
 * another is needed, so running a check ten times does not leave ten panes in the sidebar.
 */
const MAX_AI_TERMINALS = 3
/** 硬上限兜底：即使命令卡住未返回（一直处于 busy），非服务类 AI 终端也不允许无限堆积。 */
const MAX_AI_HARD_CAP = 5

let sequence = 0

function normalizedPath(value: string): string {
  const withSlashes = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? withSlashes.toLowerCase() : withSlashes
}

function sameCwd(a: string, b: string): boolean {
  return normalizedPath(a) === normalizedPath(b)
}

/** The command a terminal was started with, split back into bin + args so it can be classified. */
function commandParts(saved: string | undefined): { command: string; args: string[] } | null {
  const first = saved?.split(/[\r\n]/u)[0]?.trim()
  if (!first) return null
  const match = /^(?:"([^"]+)"|(\S+))\s*(.*)$/u.exec(first)
  if (!match) return null
  const command = match[1] || match[2] || ''
  return command ? { command, args: match[3] ? match[3].split(/\s+/u).filter(Boolean) : [] } : null
}

/** A terminal that keeps a port open: it advertised one, or its command is a dev server. */
function isServerTerminal(item: { command?: string; output: string }): boolean {
  if (detectListeningPorts(item.output).length > 0) return true
  const parts = commandParts(item.command)
  return !!parts && isServerCommand(parts.command, parts.args)
}

/** Other terminals that are still busy, so the model knows what it is sharing the project with. */
function runningSummary(open: OpenTerminal[], exceptId?: string) {
  return open
    .filter((item) => item.state !== 'idle' && item.id !== exceptId)
    .map((item) => ({
      id: item.id,
      command: commandParts(item.command)?.command ?? null,
      ports: detectListeningPorts(item.output),
    }))
}

/**
 * A token the shell echoes when the command finishes, so the manager knows the terminal is idle
 * again. It is stripped from the visible output. A long-running command (a dev server) only echoes
 * it when the process exits, which is exactly when the terminal is free.
 */
function completionMarker(): string {
  return `__PI_DONE_${process.pid}_${++sequence}__`
}
function clearCommand(kind: ShellProfile['kind']): string {
  if (kind === 'cmd') return 'cls'
  if (kind === 'pwsh' || kind === 'powershell') return 'Clear-Host'
  return 'clear'
}

/**
 * The echo is written so the *typed* text does not contain the marker, while its output does:
 * the terminal echoes what is typed, and that echo would otherwise look like the marker arriving
 * while the command is still running.
 */
function markerEcho(marker: string, kind: ShellProfile['kind']): string {
  const at = marker.indexOf('_DONE_')
  const head = at > 0 ? marker.slice(0, at) : marker
  const tail = at > 0 ? marker.slice(at) : ''
  if (kind === 'cmd') return `echo ${head}^${tail}`
  if (kind === 'pwsh' || kind === 'powershell') return `echo ("${head}" + "${tail}")`
  return `echo ${head}'${tail}'`
}

/** One line: the command and, once it returns, the marker echo. */
function withMarker(task: Pick<Task, 'command' | 'args'>, kind: ShellProfile['kind'], marker: string): string {
  return `${commandLine(task, kind)}${kind === 'cmd' ? ' & ' : ' ; '}${markerEcho(marker, kind)}`
}

function validTask(args: Args): Task | string {
  if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 1000) return 'invalid_command'
  if (args.args !== undefined && (!Array.isArray(args.args) || args.args.length > 100 || args.args.some((item) => typeof item !== 'string' || item.length > 4000))) return 'invalid_args'
  return { label: typeof args.label === 'string' ? args.label.slice(0, 200) : args.command, command: args.command, args: Array.isArray(args.args) ? (args.args as string[]) : [], cwd: '' }
}

export async function handleTerminalToolRequest(data: Record<string, unknown>, slot: { cwd: string }, post: (message: Record<string, unknown>) => void): Promise<void> {
  const callId = String(data.callId || '')
  if (!callId) return
  const reply = (text: string, isError = false) => post({ type: 'terminal-tool-response', callId, result: { content: [{ type: 'text', text }], isError } })
  try {
    const project = authorizeProjectCwd(slot.cwd)
    if (!project.ok) return reply(project.error, true)
    const args = (data.args || {}) as Args
    const manager = terminals()
    const open = manager.list(project.cwd)
    const win = getMainWindow()
    const notify = (channel: string, payload: unknown) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }

    if (args.action === 'list') {
      const items = open.map(({ id, cwd, profile, command, output, owner, state }) => ({
        id,
        cwd,
        shell: profile.name,
        owner,
        state,
        command: command || null,
        ports: detectListeningPorts(output),
        output: output.slice(-8000),
      }))
      return reply(JSON.stringify({ terminals: items }))
    }

    if (args.action === 'close') {
      const id = typeof args.id === 'string' ? args.id : ''
      if (args.all !== true && !id) return reply('invalid_id: pass id, or all:true to close every AI terminal', true)
      const targets = args.all === true ? open : open.filter((item) => item.id === id)
      if (!targets.length) return reply('terminal_not_found', true)
      const userOwned = targets.filter((item) => item.owner !== 'ai')
      if (userOwned.length) return reply(`terminal_owned_by_user: ${userOwned.map((item) => item.id).join(', ')} was opened by the user and stays open`, true)
      for (const item of targets) manager.close(item.id)
      return reply(JSON.stringify({ closed: targets.map((item) => item.id) }))
    }

    /** Create the pane, reveal it, type the command and answer the tool call. */
    const createTerminal = (
      profile: ShellProfile,
      cwd: string,
      line: string,
      markers: string[],
      task: Task | undefined,
      options: { previous?: string; status: string; extra?: Record<string, unknown> },
    ) => {
      const created = manager.create(profile, { cwd, workspace: project.cwd, command: line, cols: 100, rows: 24, owner: 'ai', markers })
      notify('ipc:terminal-created', { id: created.id, cwd, workspace: project.cwd, profile, task, previous: options.previous })
      manager.writeWhenReady(created.id, line)
      return reply(JSON.stringify({
        id: created.id,
        cwd,
        status: options.status,
        ...(options.previous ? { previous: options.previous } : {}),
        visibleInSidebar: true,
        running: runningSummary(open, options.previous),
        ...options.extra,
      }))
    }

    const defaultProfile = (): ShellProfile | undefined => terminalProfiles().find((item) => item.piDefault) || terminalProfiles()[0]

    if (args.action === 'restart') {
      const targetId = typeof args.id === 'string' ? args.id : ''
      const old = open.find((item) => item.id === targetId)
      if (!old) return reply('terminal_not_found', true)
      if (typeof args.command === 'string' && args.command.trim()) {
        const next = validTask(args)
        if (typeof next === 'string') return reply(next, true)
        const task = { ...next, cwd: old.cwd }
        const marker = completionMarker()
        manager.kill(old.id)
        return createTerminal(old.profile, old.cwd, `${shellSetup(old.cwd, old.profile.kind)}\r${withMarker(task, old.profile.kind, marker)}\r`, [marker], task, {
          previous: old.id,
          status: 'restarted',
        })
      }
      if (!old.command) return reply('terminal_has_no_saved_command: supply command and args to restart this terminal', true)
      // The saved line already carries the marker it was started with.
      manager.kill(old.id)
      return createTerminal(old.profile, old.cwd, old.command, [...old.markers], undefined, { previous: old.id, status: 'restarted' })
    }

    if (args.action !== 'start') return reply('invalid_action', true)

    const next = validTask(args)
    if (typeof next === 'string') return reply(next, true)
    const requested = typeof args.cwd === 'string' && args.cwd ? resolve(project.cwd, args.cwd) : project.cwd
    const path = await resolvePathUnderWorkspace(project.cwd, requested)
    if (!path.ok || !(await stat(path.abs).catch(() => null))?.isDirectory()) return reply('invalid_working_directory', true)
    const cwd = path.abs
    const task = { ...next, cwd }
    const profile = defaultProfile()
    if (!profile) return reply('no_shell', true)

    const aiOpen = open.filter((item) => item.owner === 'ai')
    // Legacy `reuse:false` meant "give me a fresh shell". It must not mean "leave the old server
    // running on its port", so it is treated as `replace`.
    const wantsFresh = args.replace === true || args.reuse === false

    // 1. An AI terminal whose command already returned: type into it instead of adding a pane.
    const reusable = [...aiOpen].reverse().find((item) => item.state === 'idle')
    if (reusable && !wantsFresh) {
      const marker = completionMarker()
      const kind = reusable.profile.kind
      const line = `${clearCommand(kind)}\r${shellSetup(cwd, kind)}\r${withMarker(task, kind, marker)}\r`
      manager.send(reusable.id, line, [marker])
      notify(TERMINAL_REVEAL_CHANNEL, { id: reusable.id, workspace: project.cwd })
      return reply(JSON.stringify({
        id: reusable.id,
        cwd,
        status: 'reused',
        cleared: true,
        visibleInSidebar: true,
        running: runningSummary(open, reusable.id),
      }))
    }

    // 2. A second dev server for the same directory only produces "port already in use" or a
    //    silently different port (Vite 3019 → 3020). Replace the one still serving instead.
    const sameDirBusy = aiOpen.filter((item) => item.state !== 'idle' && sameCwd(item.cwd, cwd))
    const staleServer = [...sameDirBusy].reverse().find(isServerTerminal)
    const victim = wantsFresh
      ? ([...sameDirBusy].reverse()[0] ?? reusable ?? sameDirBusy[0])
      : (isServerCommand(task.command, task.args) ? staleServer : undefined)
    if (victim) {
      const marker = completionMarker()
      const kind = victim.profile.kind
      const line = `${clearCommand(kind)}\r${shellSetup(cwd, kind)}\r${withMarker(task, kind, marker)}\r`
      manager.kill(victim.id)
      return createTerminal(victim.profile, cwd, line, [marker], task, {
        previous: victim.id,
        status: 'replaced',
        extra: { replacedPorts: detectListeningPorts(victim.output) },
      })
    }

    // 3. Keep the sidebar tidy: close the oldest finished AI terminal before adding another;
    //    if stuck busy non-server terminals exceed MAX_AI_HARD_CAP, evict the stalest one too.
    const closedIdle: string[] = []
    let liveCount = aiOpen.length
    for (const item of aiOpen) {
      if (liveCount < MAX_AI_TERMINALS) break
      if (item.state !== 'idle') continue
      manager.close(item.id)
      closedIdle.push(item.id)
      liveCount -= 1
    }
    if (liveCount >= MAX_AI_HARD_CAP) {
      const closedSet = new Set(closedIdle)
      const staleBusy = aiOpen
        .filter((item) => !closedSet.has(item.id) && !isServerTerminal(item))
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
      for (const item of staleBusy) {
        if (liveCount < MAX_AI_HARD_CAP) break
        manager.close(item.id)
        closedIdle.push(item.id)
        liveCount -= 1
      }
    }

    const marker = completionMarker()
    return createTerminal(profile, cwd, `${shellSetup(cwd, profile.kind)}\r${withMarker(task, profile.kind, marker)}\r`, [marker], task, {
      status: 'started',
      extra: closedIdle.length ? { closedIdle } : {},
    })
  } catch (error) {
    return reply(error instanceof Error ? error.message : String(error), true)
  }
}
