import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import { getAgentDir, getShellConfig } from '@earendil-works/pi-coding-agent'
import { readPiAgentGlobalSettingsFromDisk } from '../pi-agent-settings-read'
import { getMainWindow } from '../window'
import { PtyManager, type SpawnPty } from './pty-manager'
import { detectProfiles, type ShellProfile } from './shell-profiles'

export const TERMINAL_DATA_CHANNEL = 'ipc:terminal-data'
export const TERMINAL_EXIT_CHANNEL = 'ipc:terminal-exit'
/** The tool closed a terminal: the sidebar removes the pane (an exit alone keeps the output). */
export const TERMINAL_CLOSED_CHANNEL = 'ipc:terminal-closed'
/** The tool typed into an existing terminal: focus it instead of opening another tab. */
export const TERMINAL_REVEAL_CHANNEL = 'ipc:terminal-reveal'

let manager: PtyManager | null = null
let profiles: ShellProfile[] | null = null

/** The shell pi runs its own commands with (settings.json `shellPath`, then Git Bash / bash). */
function piShell(): string | null {
  try {
    const custom = readPiAgentGlobalSettingsFromDisk()?.shellPath
    return getShellConfig(typeof custom === 'string' && custom ? custom : undefined).shell
  } catch {
    return null
  }
}

/** pi's `getShellEnv`: the process env with pi's bin dir (tools it installs, e.g. fd / rg) on PATH. */
function shellEnv(): NodeJS.ProcessEnv {
  const bin = join(getAgentDir(), 'bin')
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const current = process.env[key] ?? ''
  return current.split(delimiter).includes(bin) ? { ...process.env } : { ...process.env, [key]: [bin, current].filter(Boolean).join(delimiter) }
}

export function terminalProfiles(refresh = false): ShellProfile[] {
  if (!profiles || refresh) profiles = detectProfiles(piShell())
  return profiles
}

function send(channel: string, payload: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function terminals(): PtyManager {
  if (!manager) {
    // Loaded lazily: the native module is only needed once a terminal opens.
    const pty = createRequire(import.meta.url)('@lydell/node-pty') as { spawn: SpawnPty }
    manager = new PtyManager(pty.spawn, { data: (id, data) => send(TERMINAL_DATA_CHANNEL, { id, data }), exit: (id, code) => send(TERMINAL_EXIT_CHANNEL, { id, code }), closed: (id) => send(TERMINAL_CLOSED_CHANNEL, { id }) }, shellEnv)
  }
  return manager
}

/** Running terminals (the close guard asks before ending them). */
export function runningTerminalCount(): number {
  return manager?.count ?? 0
}

export function shutdownTerminals(): void {
  manager?.killAll()
}

/**
 * 项目被隐藏 / 从列表移除时，停掉它底下起的终端（含子目录里跑的，比如任务里的 dev server）。
 * 从没开过终端就什么都不做（也不去加载原生 pty 模块）。
 */
export function stopTerminalsForWorkspace(root: string): number {
  if (!manager) return 0
  const killed = manager.killWorkspace(root)
  if (killed.length) console.info(`[terminal] stopped ${killed.length} terminal(s) of hidden project ${root}`)
  return killed.length
}
