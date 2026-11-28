import { isAbsolute, join, posix, resolve } from 'path'
import { existsSync, readFileSync, statSync } from 'fs'
import { isWslWindowsPath, wslPathToWindows, wslWindowsPathDistro } from '@shared/wsl-path'
import { configStore } from './config-store'
import { isSandboxWorkspacePath } from './sandbox-workspaces'
import { readSessionMetaFromFile, sessionFilePathForFs } from './session-file-meta'
import { workerManager } from './worker-manager'
import { getAgentRuntimeConfig } from './wsl/runtime-config'
import { normalizeWorkspaceCwd } from './wsl/workspace-path'

/** Active workspace root for capability-bound IPC (git mutations, image preview). */
export function getTrustedWorkspaceRoot(): string | null {
  const raw = workerManager.cwd || configStore.get('currentProject')
  const t = typeof raw === 'string' ? raw.trim() : ''
  return t ? normalizeWorkspaceCwd(t) : null
}

export function authorizeTrustedCwd(reqCwd: string | undefined): { ok: true; cwd: string } | { ok: false; error: string } {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted) return { ok: false, error: 'no_trusted_workspace' }
  if (!reqCwd || !String(reqCwd).trim()) return { ok: true, cwd: trusted }
  const a = resolve(trusted)
  const b = resolve(normalizeWorkspaceCwd(String(reqCwd)))
  if (a !== b) return { ok: false, error: 'cwd_not_trusted' }
  return { ok: true, cwd: trusted }
}

type TrustedSessionFileResult =
  | { ok: true; cwd: string; sessionFile: string }
  | { ok: false; error: string }

function isPortableAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || isWslWindowsPath(value)
}

function comparableWorkspacePath(value: string): string {
  const normalized = posix.normalize(value.replace(/\\/g, '/'))
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

function workspacePathsEqual(a: string, b: string): boolean {
  const left = comparableWorkspacePath(a)
  const right = comparableWorkspacePath(b)
  const windowsPath = /^[a-zA-Z]:[\\/]/.test(a) || /^[a-zA-Z]:[\\/]/.test(b)
  return windowsPath ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isWorktreeOfTrustedProject(target: string, trustedRoots: readonly string[]): boolean {
  try {
    const dotGit = resolve(target, '.git')
    if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return false
    const content = readFileSync(dotGit, 'utf8')
    const match = content.match(/^gitdir:\s*(.+)$/m)
    if (!match) return false
    const rawGitDir = match[1].trim()
    const resolvedGitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(target, rawGitDir)
    const normalizedGitDir = comparableWorkspacePath(resolvedGitDir)
    const marker = '/.git/worktrees/'
    const idx = normalizedGitDir.toLowerCase().indexOf(marker)
    if (idx <= 0) return false
    const repoRoot = normalizedGitDir.slice(0, idx)
    return trustedRoots.some((root) => workspacePathsEqual(root, repoRoot))
  } catch {
    return false
  }
}

/** The active workspace, a recent project or a sandbox folder (renderer-chosen project paths). */
export function authorizeProjectCwd(reqCwd: string | undefined): { ok: true; cwd: string } | { ok: false; error: string } {
  const target = normalizeWorkspaceCwd(String(reqCwd || ''))
  if (!target) return authorizeTrustedCwd(reqCwd)
  const trustedList = [
    getTrustedWorkspaceRoot(),
    ...(configStore.get('recentProjects') || []),
  ]
    .map((workspace) => (workspace ? normalizeWorkspaceCwd(workspace) : null))
    .filter((workspace): workspace is string => !!workspace)
  const trusted = trustedList.find((workspace) => workspacePathsEqual(workspace, target))
  if (trusted) return { ok: true, cwd: trusted }
  if (isPortableAbsolutePath(target) && existsSync(target) && isWorktreeOfTrustedProject(target, trustedList)) {
    return { ok: true, cwd: target }
  }
  if (isPortableAbsolutePath(target) && isSandboxWorkspacePath(target) && existsSync(target)) {
    return { ok: true, cwd: target }
  }
  return { ok: false, error: 'cwd_not_trusted' }
}

function isRegisteredTeamSessionFile(workspaceRoot: string, sessionFile: string): boolean {
  try {
    const stateFile = join(workspaceRoot, '.文档', '开发规范', '协作', '团队.json')
    if (!existsSync(stateFile)) return false
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      runs?: Array<{ sessionFile?: unknown }>
      sessions?: Record<string, { sessionFile?: unknown } | undefined>
    }
    const candidates: string[] = []
    if (Array.isArray(parsed.runs)) {
      for (const run of parsed.runs) {
        if (typeof run?.sessionFile === 'string' && run.sessionFile) candidates.push(run.sessionFile)
      }
    }
    if (parsed.sessions && typeof parsed.sessions === 'object') {
      for (const entry of Object.values(parsed.sessions)) {
        if (typeof entry?.sessionFile === 'string' && entry.sessionFile) candidates.push(entry.sessionFile)
      }
    }
    return candidates.some((candidate) => workspacePathsEqual(candidate, sessionFile))
  } catch {
    return false
  }
}

/** Authorize a renderer-provided session path before opening it in the main process. */
export async function authorizeTrustedSessionFile(
  reqCwd: string | undefined,
  requestedSessionFile: string | undefined,
): Promise<TrustedSessionFileResult> {
  const authorizedCwd = authorizeProjectCwd(reqCwd)
  if (!authorizedCwd.ok) return authorizedCwd

  const sessionFile = String(requestedSessionFile || '').trim()
  if (!sessionFile || !isPortableAbsolutePath(sessionFile)) {
    return { ok: false, error: 'invalid_session_path' }
  }

  // 新会话在第一条会话落盘前没有 JSONL（SDK 只在有对话时才建文件）。
  // 读不到会话头时先分清"文件还不在"与"头部不对"：前者属于还没内容，
  // 上层当空树处理；后者才是伪造/损坏。
  const meta = await readSessionMetaFromFile(sessionFile)
  if (!meta?.cwd) {
    const missing = !existsSync(sessionFilePathForFs(sessionFile))
    return { ok: false, error: missing ? 'session_file_missing' : 'invalid_session' }
  }
  const fileDistro = wslWindowsPathDistro(sessionFile)
  const sessionCwd = fileDistro
    ? wslPathToWindows(fileDistro, meta.cwd)
    : meta.cwd
  const allowed =
    workspacePathsEqual(sessionCwd, authorizedCwd.cwd) ||
    isWorktreeOfTrustedProject(sessionCwd, [authorizedCwd.cwd]) ||
    isRegisteredTeamSessionFile(authorizedCwd.cwd, sessionFile)
  if (!allowed) {
    return { ok: false, error: 'session_workspace_mismatch' }
  }

  const workspaceDistro = wslWindowsPathDistro(authorizedCwd.cwd)
  const activeDistro = getAgentRuntimeConfig().distro
  const expectedDistro = workspaceDistro || activeDistro
  if (fileDistro && expectedDistro && fileDistro.toLowerCase() !== expectedDistro.toLowerCase()) {
    return { ok: false, error: 'session_workspace_mismatch' }
  }

  return { ok: true, cwd: authorizedCwd.cwd, sessionFile }
}
