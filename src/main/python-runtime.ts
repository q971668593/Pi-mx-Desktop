import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'

const execFile = promisify(execFileCallback)
const PYTHON_DOWNLOADS = 'https://www.python.org/downloads/windows/'
const PYTHON_MANAGER_STORE_ID = '9NQ7512CXL7T'
const MAX_BUFFER = 1024 * 1024

export interface PythonRuntimeStatus {
  supported: boolean
  installed: boolean
  version?: string
  path?: string
  prompt: boolean
  error?: string
}

function versionFromOutput(value: string): string | null {
  return value.match(/\bPython\s+(\d+\.\d+\.\d+(?:[a-zA-Z0-9.+-]*))/i)?.[1] ?? null
}

async function run(executable: string, args: string[], timeout = 5000): Promise<string> {
  const { stdout, stderr } = await execFile(executable, args, {
    windowsHide: true,
    timeout,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
  })
  return `${stdout}\n${stderr}`.trim()
}

async function findOnPath(name: string): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    const out = await run('where.exe', [name])
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function probeExecutable(executable: string): Promise<{ version: string; path: string } | null> {
  // WindowsApps aliases can open the Store or trigger implicit installation. Detection must stay read-only.
  if (/\\Microsoft\\WindowsApps\\(?:python|python3)(?:\.exe)?$/i.test(executable)) return null
  try {
    const output = await run(executable, ['--version'])
    const version = versionFromOutput(output)
    return version ? { version, path: executable } : null
  } catch {
    return null
  }
}

async function detectPython(): Promise<{ version: string; path: string } | null> {
  if (process.platform !== 'win32') return null
  const candidates = new Set<string>()
  for (const name of ['python.exe', 'python3.exe', 'py.exe']) {
    for (const path of await findOnPath(name)) candidates.add(path)
  }

  // The legacy launcher can locate registered CPython installs that are not on PATH.
  const launchers = [...candidates].filter((path) => /\\py\.exe$/i.test(path))
  for (const launcher of launchers) {
    try {
      const listing = await run(launcher, ['-0p'])
      for (const match of listing.matchAll(/(?:[A-Za-z]:\\|\\\\)[^\r\n]*?pythonw?\.exe/gi)) candidates.add(match[0].trim())
    } catch {
      // A Python Install Manager's py alias has a different interface; the direct commands are probed below.
    }
  }

  // Check the manager's interpreter list first so its managed latest runtime wins over an older install.
  const managerCandidates = [...(await findOnPath('pymanager.exe'))]
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    const managerAlias = join(localAppData, 'Microsoft', 'WindowsApps', 'pymanager.exe')
    if (existsSync(managerAlias)) managerCandidates.push(managerAlias)
  }
  for (const manager of managerCandidates) {
    try {
      const listing = await run(manager, ['list', '--one', '--format=exe', 'default'])
      const path = listing.split(/\r?\n/).map((line) => line.trim()).find((line) => /pythonw?\.exe$/i.test(line))
      if (path) {
        const result = await probeExecutable(path)
        if (result) return result
      }
    } catch {
      // Continue with registered PATH/launcher installs.
    }
  }

  for (const executable of candidates) {
    const result = await probeExecutable(executable)
    if (result) return result
  }
  return null
}

export async function getPythonRuntimeStatus(promptHandled: boolean): Promise<PythonRuntimeStatus> {
  if (process.platform !== 'win32') return { supported: false, installed: false, prompt: false }
  const detected = await detectPython()
  return {
    supported: true,
    installed: !!detected,
    ...(detected ? { version: detected.version, path: detected.path } : {}),
    prompt: !detected && !promptHandled,
  }
}

async function runWinget(args: string[], timeout: number): Promise<string> {
  try {
    return await run('winget.exe', args, timeout)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ENOENT|not found|cannot find/i.test(message)) throw new Error('WINGET_NOT_FOUND')
    throw error
  }
}

async function resolvePythonManager(): Promise<string | null> {
  const fromPath = await findOnPath('pymanager.exe')
  if (fromPath.length) return fromPath[0]
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return null
  const alias = join(localAppData, 'Microsoft', 'WindowsApps', 'pymanager.exe')
  return existsSync(alias) ? alias : null
}

/** Ensure the official per-user Python manager exists, then install/update its latest stable CPython runtime. */
async function installLatestPythonImpl(): Promise<PythonRuntimeStatus> {
  if (process.platform !== 'win32') return { supported: false, installed: false, prompt: false, error: 'UNSUPPORTED_PLATFORM' }
  let manager = await resolvePythonManager()
  if (!manager) {
    await runWinget(
      ['install', '--id', PYTHON_MANAGER_STORE_ID, '--exact', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
      10 * 60_000,
    )
    manager = await resolvePythonManager()
  }
  if (!manager) throw new Error('PYTHON_MANAGER_NOT_FOUND')
  await run(manager, ['install', '--update', 'default'], 20 * 60_000)

  const installed = await detectPython()
  if (!installed) throw new Error('PYTHON_INSTALL_VERIFY_FAILED')
  return { supported: true, installed: true, version: installed.version, path: installed.path, prompt: false }
}

let installInProgress: Promise<PythonRuntimeStatus> | null = null

export function installLatestPython(): Promise<PythonRuntimeStatus> {
  if (installInProgress) return installInProgress
  installInProgress = installLatestPythonImpl().finally(() => { installInProgress = null })
  return installInProgress
}

export async function openPythonDownloads(): Promise<void> {
  await shell.openExternal(PYTHON_DOWNLOADS)
}

