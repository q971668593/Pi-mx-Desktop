import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { getMainWindow } from '../window'
import { authorizeProjectCwd } from '../trusted-workspace'
import { resolvePathUnderWorkspace } from '../workspace-fs'
import { commandLine, shellSetup } from '../workspace-tasks'
import { TERMINAL_REVEAL_CHANNEL, terminalProfiles, terminals } from './terminal-service'
import type { ShellProfile } from './shell-profiles'

type Args = { action?: unknown; id?: unknown; command?: unknown; args?: unknown; cwd?: unknown; label?: unknown; reuse?: unknown; all?: unknown }
type Task = { label: string; command: string; args: string[]; cwd: string }

let sequence = 0

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
      const items = open.map(({ id, cwd, profile, command, output, owner, state }) => ({ id, cwd, shell: profile.name, owner, state, command: command || null, output: output.slice(-8000) }))
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

    let previous: string | undefined
    let cwd = project.cwd
    let line = ''
    let markers: string[] = []
    let task: Task | undefined
    let profile = terminalProfiles().find((item) => item.piDefault) || terminalProfiles()[0]

    if (args.action === 'restart') {
      previous = typeof args.id === 'string' ? args.id : ''
      const old = open.find((item) => item.id === previous)
      if (!old) return reply('terminal_not_found', true)
      cwd = old.cwd
      profile = old.profile
      if (typeof args.command === 'string' && args.command.trim()) {
        const next = validTask(args)
        if (typeof next === 'string') return reply(next, true)
        task = { ...next, cwd }
        const marker = completionMarker()
        markers = [marker]
        line = `${shellSetup(cwd, profile.kind)}\r${withMarker(task, profile.kind, marker)}\r`
      } else if (old.command) {
        // The saved line already carries the marker it was started with.
        markers = [...old.markers]
        line = old.command
      } else return reply('terminal_has_no_saved_command: supply command and args to restart this terminal', true)
      manager.kill(old.id)
    } else if (args.action === 'start') {
      const next = validTask(args)
      if (typeof next === 'string') return reply(next, true)
      const requested = typeof args.cwd === 'string' && args.cwd ? resolve(project.cwd, args.cwd) : project.cwd
      const path = await resolvePathUnderWorkspace(project.cwd, requested)
      if (!path.ok || !(await stat(path.abs).catch(() => null))?.isDirectory()) return reply('invalid_working_directory', true)
      cwd = path.abs
      task = { ...next, cwd }
      // Reuse: one terminal is enough for a sequence of commands. Only AI terminals, and only ones
      // whose command has finished, so a running dev server is never typed into.
      const reusable = args.reuse === false ? undefined : [...open].reverse().find((item) => item.owner === 'ai' && item.state === 'idle')
      if (reusable) {
        const marker = completionMarker()
        const kind = reusable.profile.kind
        const reused = `${clearCommand(kind)}\r${shellSetup(cwd, kind)}\r${withMarker(task, kind, marker)}\r`
        manager.send(reusable.id, reused, [marker])
        notify(TERMINAL_REVEAL_CHANNEL, { id: reusable.id, workspace: project.cwd })
        return reply(JSON.stringify({ id: reusable.id, cwd, status: 'reused', cleared: true, visibleInSidebar: true }))
      }
      if (!profile) return reply('no_shell', true)
      const marker = completionMarker()
      markers = [marker]
      line = `${shellSetup(cwd, profile.kind)}\r${withMarker(task, profile.kind, marker)}\r`
    } else return reply('invalid_action', true)

    if (!profile) return reply('no_shell', true)
    const created = manager.create(profile, { cwd, workspace: project.cwd, command: line, cols: 100, rows: 24, owner: 'ai', markers })
    notify('ipc:terminal-created', { id: created.id, cwd, workspace: project.cwd, profile, task, previous })
    manager.writeWhenReady(created.id, line)
    return reply(JSON.stringify({ id: created.id, cwd, status: 'started', visibleInSidebar: true }))
  } catch (error) {
    return reply(error instanceof Error ? error.message : String(error), true)
  }
}
