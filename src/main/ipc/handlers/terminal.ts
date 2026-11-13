import { ipcMain } from 'electron'
import { z } from 'zod'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { configStore } from '../../config-store'
import { terminalProfiles, terminals } from '../../terminal/terminal-service'
import { authorizeProjectCwd } from '../../trusted-workspace'
import { commandLine, isPathInside, shellSetup, type TaskLaunch } from '../../workspace-tasks'

const runSchema = z.object({
  cwd: z.string().min(1),
  profileId: z.string().optional(),
  tasks: z.array(z.object({
    label: z.string().min(1).max(200),
    command: z.string().min(1).max(1000),
    args: z.array(z.string().max(4000)).max(100),
    cwd: z.string().min(1),
  }).strict()).min(1).max(30),
}).strict()

export function registerTerminalHandlers(): void {
  registerHandler('ipc:terminal.profiles', async (req) => {
    const refresh = (req as { refresh?: boolean } | null)?.refresh === true
    return { profiles: terminalProfiles(refresh) }
  })
  registerHandler('ipc:terminal.create', async (req) => {
    const r = (req ?? {}) as { profileId?: string; cwd?: string; workspace?: string; rawCommand?: string; cols?: number; rows?: number }
    const all = terminalProfiles()
    const profile = all.find((p) => p.id === r.profileId) ?? all[0]
    if (!profile) return { ok: false, error: 'no_shell' }
    try {
      // No project in the renderer yet (home view): the last opened project, else home.
      const cwd = r.cwd || (configStore.get('currentProject') as string | undefined) || undefined
      const rawCommand = typeof r.rawCommand === 'string' ? r.rawCommand.trim() : ''
      if (rawCommand.length > 8000 || /[\r\n]/.test(rawCommand)) return { ok: false, error: 'invalid_command' }
      const line = rawCommand ? `${rawCommand}\r` : undefined
      const { id, pid } = terminals().create(profile, { cwd, workspace: r.workspace || cwd, command: line, cols: Number(r.cols), rows: Number(r.rows) })
      if (line) terminals().writeWhenReady(id, line, 5000, true)
      return { ok: true, id, pid, profile }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  registerHandlerWithSchema('ipc:terminal.runTasks', runSchema, async (req) => {
    const project = authorizeProjectCwd(req.cwd)
    if (!project.ok) return { ok: false, error: project.error }
    const all = terminalProfiles()
    const profile = all.find((item) => item.id === req.profileId) ?? all.find((item) => item.piDefault) ?? all[0]
    if (!profile) return { ok: false, error: 'no_shell' }
    const created: Array<{ id: string; label: string }> = []
    try {
      for (const task of req.tasks as TaskLaunch[]) {
        if (!isPathInside(project.cwd, task.cwd)) return { ok: false, error: 'cwd_not_trusted', created }
        const line = `${shellSetup(task.cwd, profile.kind)}\r${commandLine(task, profile.kind)}\r`
        const { id } = terminals().create(profile, { cwd: task.cwd, workspace: project.cwd, command: line, cols: 100, rows: 24 })
        terminals().writeWhenReady(id, line, 5000, true)
        created.push({ id, label: task.label })
      }
      return { ok: true, profile, terminals: created }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), created }
    }
  })
  registerHandler('ipc:terminal.resize', async (req) => {
    const r = (req ?? {}) as { id?: string; cols?: number; rows?: number }
    if (r.id) terminals().resize(r.id, Number(r.cols), Number(r.rows))
    return { ok: true }
  })
  registerHandler('ipc:terminal.kill', async (req) => {
    const id = (req as { id?: string } | null)?.id
    if (id) terminals().kill(id)
    return { ok: true }
  })
  // Keystrokes: fire-and-forget, no invoke round trip per key.
  ipcMain.removeAllListeners('ipc:terminal-write')
  ipcMain.on('ipc:terminal-write', (_e, payload: { id?: string; data?: string }) => {
    if (typeof payload?.id === 'string' && typeof payload.data === 'string') terminals().write(payload.id, payload.data)
  })
}
