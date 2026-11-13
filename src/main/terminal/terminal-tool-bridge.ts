import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { getMainWindow } from '../window'
import { authorizeProjectCwd } from '../trusted-workspace'
import { resolvePathUnderWorkspace } from '../workspace-fs'
import { commandLine, shellSetup } from '../workspace-tasks'
import { terminalProfiles, terminals } from './terminal-service'

type Args = { action?: unknown; id?: unknown; command?: unknown; args?: unknown; cwd?: unknown; label?: unknown }

export async function handleTerminalToolRequest(data: Record<string, unknown>, slot: { cwd: string }, post: (message: Record<string, unknown>) => void): Promise<void> {
  const callId = String(data.callId || '')
  if (!callId) return
  const reply = (text: string, isError = false) => post({ type: 'terminal-tool-response', callId, result: { content: [{ type: 'text', text }], isError } })
  try {
    const project = authorizeProjectCwd(slot.cwd)
    if (!project.ok) return reply(project.error, true)
    const args = (data.args || {}) as Args
    const manager = terminals()
    if (args.action === 'list') {
      const items = manager.list(project.cwd).map(({ id, cwd, profile, command, output }) => ({ id, cwd, shell: profile.name, command: command || null, output: output.slice(-8000) }))
      return reply(JSON.stringify({ terminals: items }))
    }
    let previous: string | undefined
    let cwd = project.cwd
    let line = ''
    let task: { label: string; command: string; args: string[]; cwd: string } | undefined
    let profile = terminalProfiles().find((item) => item.piDefault) || terminalProfiles()[0]
    if (args.action === 'restart') {
      previous = typeof args.id === 'string' ? args.id : ''
      const old = manager.list(project.cwd).find((item) => item.id === previous)
      if (!old) return reply('terminal_not_found', true)
      cwd = old.cwd
      profile = old.profile
      if (typeof args.command === 'string' && args.command.trim()) {
        if (args.command.length > 1000 || (args.args !== undefined && (!Array.isArray(args.args) || args.args.length > 100 || args.args.some((item) => typeof item !== 'string' || item.length > 4000)))) return reply('invalid_command', true)
        task = { label: typeof args.label === 'string' ? args.label.slice(0, 200) : args.command, command: args.command, args: Array.isArray(args.args) ? args.args as string[] : [], cwd }
        line = `${shellSetup(cwd, profile.kind)}\r${commandLine(task, profile.kind)}\r`
      } else if (old.command) line = old.command
      else return reply('terminal_has_no_saved_command: supply command and args to restart this terminal', true)
      manager.kill(old.id)
    } else if (args.action === 'start') {
      if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 1000) return reply('invalid_command', true)
      if (args.args !== undefined && (!Array.isArray(args.args) || args.args.length > 100 || args.args.some((item) => typeof item !== 'string' || item.length > 4000))) return reply('invalid_args', true)
      const requested = typeof args.cwd === 'string' && args.cwd ? resolve(project.cwd, args.cwd) : project.cwd
      const path = await resolvePathUnderWorkspace(project.cwd, requested)
      if (!path.ok || !(await stat(path.abs).catch(() => null))?.isDirectory()) return reply('invalid_working_directory', true)
      cwd = path.abs
      if (!profile) return reply('no_shell', true)
      task = { label: typeof args.label === 'string' ? args.label.slice(0, 200) : args.command, command: args.command, args: Array.isArray(args.args) ? args.args as string[] : [], cwd }
      line = `${shellSetup(cwd, profile.kind)}\r${commandLine(task, profile.kind)}\r`
    } else return reply('invalid_action', true)
    if (!profile) return reply('no_shell', true)
    const created = manager.create(profile, { cwd, workspace: project.cwd, command: line, cols: 100, rows: 24 })
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('ipc:terminal-created', { id: created.id, cwd, workspace: project.cwd, profile, task, previous })
    manager.writeWhenReady(created.id, line)
    return reply(JSON.stringify({ id: created.id, cwd, status: 'started', visibleInSidebar: true }))
  } catch (error) {
    return reply(error instanceof Error ? error.message : String(error), true)
  }
}
