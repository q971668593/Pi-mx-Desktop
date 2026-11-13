import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'path'
import { promisify } from 'util'
import type {
  WorkspaceFsSearchEntry,
  WorkspaceFsSearchRequest,
  WorkspaceFsSearchResponse,
} from '@shared/ipc-contract'
import { resolvePathUnderWorkspace } from './workspace-fs'
import { resolveActiveAgentDir } from './agent-dir'
import { workspacePathKey } from '@shared/workspace-path'

const execFileAsync = promisify(execFile)
const FD_ENUMERATION_LIMIT = 1000
const SEARCH_RESULT_LIMIT = 20
const SEARCH_RESULT_MAX = 200
const SEARCH_TIMEOUT_MS = 2500

let cachedFdExecutable: string | null | undefined
let warnedSearchFailure = false
const fileIndexes = new Map<string, { expires: number; pending: Promise<WorkspaceFsSearchEntry[] | null> }>()

export function invalidateWorkspaceFileSearchIndex(workspaceRoot: string): void {
  fileIndexes.delete(workspacePathKey(workspaceRoot))
}

export function clearWorkspaceFileSearchCaches(): void {
  cachedFdExecutable = undefined
  warnedSearchFailure = false
  fileIndexes.clear()
}

export interface WorkspaceFileSearchQuery {
  ok: true
  scopeAbs: string
  scopePrefix: string
  query: string
}

export async function buildWorkspaceFileSearchQuery(
  workspaceRoot: string,
  inputQuery: string,
): Promise<WorkspaceFileSearchQuery | { ok: false; error: 'missing_root' | 'outside_workspace' | 'search_failed' }> {
  if (!workspaceRoot.trim()) return { ok: false, error: 'missing_root' }
  const normalized = inputQuery.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return { ok: false, error: 'outside_workspace' }
  }
  const slash = normalized.lastIndexOf('/')
  const scope = slash >= 0 ? normalized.slice(0, slash) : ''
  const query = slash >= 0 ? normalized.slice(slash + 1) : normalized
  if (scope.split('/').some((part) => part === '..')) {
    return { ok: false, error: 'outside_workspace' }
  }
  const resolved = await resolvePathUnderWorkspace(workspaceRoot, scope || '.')
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error === 'missing_root' ? 'missing_root' : 'outside_workspace',
    }
  }
  try {
    if (!(await stat(resolved.abs)).isDirectory()) return { ok: false, error: 'search_failed' }
  } catch {
    return { ok: false, error: 'search_failed' }
  }
  const scopePrefix = scope ? `${scope.replace(/^\.\//, '').replace(/\/+$/, '')}/` : ''
  return { ok: true, scopeAbs: resolved.abs, scopePrefix, query }
}

export function scoreWorkspaceFileSearchEntry(entry: WorkspaceFsSearchEntry, query: string): number {
  if (!query) return entry.isDirectory ? 10 : 0
  const normalizedQuery = query.toLocaleLowerCase()
  const name = entry.name.toLocaleLowerCase()
  let score = 0
  if (name === normalizedQuery) score = 100
  else if (name.startsWith(normalizedQuery)) score = 80
  else if (name.includes(normalizedQuery)) score = 50
  return score > 0 && entry.isDirectory ? score + 10 : score
}

export function rankWorkspaceFileSearchEntries(
  entries: WorkspaceFsSearchEntry[],
  query: string,
  maxResults = SEARCH_RESULT_LIMIT,
): WorkspaceFsSearchEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, score: scoreWorkspaceFileSearchEntry(entry, query) }))
    .filter((item) => !query || item.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const pathOrder = a.entry.path.localeCompare(b.entry.path, undefined, { sensitivity: 'base' })
      return pathOrder || a.index - b.index
    })
    .slice(0, Math.min(Math.max(1, maxResults), SEARCH_RESULT_MAX))
    .map((item) => item.entry)
}

async function verifyFdExecutable(candidate: string): Promise<boolean> {
  try {
    await execFileAsync(candidate, ['--version'], {
      windowsHide: true,
      timeout: 1500,
    })
    return true
  } catch {
    return false
  }
}

export async function resolveFdExecutable(): Promise<string | null> {
  if (cachedFdExecutable !== undefined) return cachedFdExecutable
  const agentDir = process.env.PI_CODING_AGENT_DIR || resolveActiveAgentDir()
  const managed = join(agentDir, 'bin', process.platform === 'win32' ? 'fd.exe' : 'fd')
  if (existsSync(managed)) {
    cachedFdExecutable = managed
    return managed
  }
  for (const candidate of ['fd', 'fdfind']) {
    if (await verifyFdExecutable(candidate)) {
      cachedFdExecutable = candidate
      return candidate
    }
  }
  cachedFdExecutable = null
  return null
}

export function primeWorkspaceFileSearchIndex(workspaceRoot: string): Promise<WorkspaceFsSearchEntry[] | null> {
  const key = workspacePathKey(workspaceRoot)
  if (!key) return Promise.resolve(null)
  const cached = fileIndexes.get(key)
  if (cached && cached.expires > Date.now()) return cached.pending
  const entry = { expires: Number.POSITIVE_INFINITY, pending: Promise.resolve(null) as Promise<WorkspaceFsSearchEntry[] | null> }
  entry.pending = (async () => {
    const root = await buildWorkspaceFileSearchQuery(workspaceRoot, '')
    const fd = await resolveFdExecutable()
    if (!root.ok || !fd) return null
    const { stdout } = await execFileAsync(fd, ['--base-directory', root.scopeAbs, '--type', 'file', '--type', 'directory', '--follow', '--hidden', '--exclude', '.git', '--path-separator', '/', '--no-ignore', '.'], { cwd: root.scopeAbs, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 })
    return stdout.split(/\r?\n/).filter(Boolean).map((raw) => {
      const isDirectory = raw.endsWith('/')
      const path = raw.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/$/, '')
      return { path, name: basename(path), isDirectory }
    }).filter((item) => item.path && item.path !== '.git' && !item.path.startsWith('.git/'))
  })().catch(() => null).then((result) => {
    if (fileIndexes.get(key) === entry) {
      if (result) {
        entry.expires = Date.now() + 30_000
        const timer = setTimeout(() => { if (fileIndexes.get(key) === entry) fileIndexes.delete(key) }, 30_000)
        timer.unref()
      }
      else fileIndexes.delete(key)
    }
    return result
  })
  if (fileIndexes.size >= 1) fileIndexes.delete(fileIndexes.keys().next().value!)
  fileIndexes.set(key, entry)
  return entry.pending
}

export async function workspaceFsSearch(
  req: WorkspaceFsSearchRequest,
): Promise<WorkspaceFsSearchResponse> {
  const scoped = await buildWorkspaceFileSearchQuery(String(req.workspaceRoot || ''), String(req.query || ''))
  if (!scoped.ok) return { ok: false, entries: [], error: scoped.error }
  if (req.includeIgnored) {
    const index = await primeWorkspaceFileSearchIndex(req.workspaceRoot)
    if (index) {
      const scope = process.platform === 'win32' ? scoped.scopePrefix.toLowerCase() : scoped.scopePrefix
      const matches = index.filter((entry) => (process.platform === 'win32' ? entry.path.toLowerCase() : entry.path).startsWith(scope))
      const ranked = rankWorkspaceFileSearchEntries(matches, scoped.query, req.maxResults)
      const verified = await Promise.all(ranked.map(async (entry) => {
        const resolved = await resolvePathUnderWorkspace(req.workspaceRoot, entry.path)
        if (!resolved.ok) return null
        try { return { ...entry, isDirectory: (await stat(resolved.abs)).isDirectory() } } catch { return null }
      }))
      return { ok: true, entries: verified.filter((entry): entry is WorkspaceFsSearchEntry => entry !== null) }
    }
  }
  const fd = await resolveFdExecutable()
  if (!fd) {
    if (!req.includeIgnored) return { ok: false, entries: [], error: 'fd_unavailable' }
    return searchWithoutFd(scoped, req.maxResults)
  }

  const args = [
    '--base-directory',
    scoped.scopeAbs,
    '--max-results',
    String(FD_ENUMERATION_LIMIT),
    '--type',
    'file',
    '--type',
    'directory',
    '--follow',
    '--hidden',
    '--exclude',
    '.git',
    '--path-separator',
    '/',
  ]
  if (req.includeIgnored) args.push('--no-ignore')
  if (scoped.query) args.push('--fixed-strings', '--ignore-case', scoped.query)
  else args.push('.')

  try {
    const { stdout } = await execFileAsync(fd, args, {
      cwd: scoped.scopeAbs,
      encoding: 'utf8',
      windowsHide: true,
      timeout: SEARCH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })
    const rootResolved = await resolvePathUnderWorkspace(req.workspaceRoot, '.')
    if (!rootResolved.ok) {
      return {
        ok: false,
        entries: [],
        error: rootResolved.error === 'missing_root' ? 'missing_root' : 'outside_workspace',
      }
    }
    const candidates = stdout.split(/\r?\n/).filter(Boolean)
    const entries: WorkspaceFsSearchEntry[] = []
    for (let offset = 0; offset < candidates.length; offset += 32) {
      const batch = await Promise.all(candidates.slice(offset, offset + 32).map(async (raw): Promise<WorkspaceFsSearchEntry | null> => {
      const relativeFromScope = raw.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/$/, '')
      if (!relativeFromScope) return null
      const relativePath = `${scoped.scopePrefix}${relativeFromScope}`.replace(/^\.\//, '')
      if (relativePath === '.git' || relativePath.startsWith('.git/')) return null
      const resolved = await resolvePathUnderWorkspace(req.workspaceRoot, relativePath)
      if (!resolved.ok) return null
      try {
        const pathFromRoot = relative(rootResolved.abs, resolved.abs).split(sep).join('/')
        if (!pathFromRoot || pathFromRoot.startsWith('../')) return null
        const isDirectory = (await stat(resolved.abs)).isDirectory()
        return {
          path: relativePath,
          name: basename(relativePath),
          isDirectory,
        }
      } catch {
        return null
      }
      }))
      entries.push(...batch.filter((entry): entry is WorkspaceFsSearchEntry => entry !== null))
    }
    return {
      ok: true,
      entries: rankWorkspaceFileSearchEntries(entries, scoped.query, req.maxResults),
    }
  } catch (error) {
    if (!warnedSearchFailure) {
      warnedSearchFailure = true
      console.warn('[workspace.fs.search] fd search failed:', error)
    }
    if (req.includeIgnored) return searchWithoutFd(scoped, req.maxResults)
    return { ok: false, entries: [], error: 'search_failed' }
  }
}

async function searchWithoutFd(scoped: WorkspaceFileSearchQuery, maxResults?: number): Promise<WorkspaceFsSearchResponse> {
  const queue = [{ absolute: scoped.scopeAbs, relative: scoped.scopePrefix }]
  const entries: WorkspaceFsSearchEntry[] = []
  const needle = scoped.query.toLocaleLowerCase()
  let cursor = 0
  while (cursor < queue.length && entries.length < FD_ENUMERATION_LIMIT) {
    const directory = queue[cursor++]
    const children = await readdir(directory.absolute, { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      if (entries.length >= FD_ENUMERATION_LIMIT) break
      if (child.name === '.git' || child.isSymbolicLink()) continue
      const path = `${directory.relative}${child.name}`
      const isDirectory = child.isDirectory()
      if (isDirectory) queue.push({ absolute: join(directory.absolute, child.name), relative: `${path}/` })
      if ((!needle || child.name.toLocaleLowerCase().includes(needle)) && (isDirectory || child.isFile())) entries.push({ path, name: child.name, isDirectory })
    }
  }
  return { ok: true, entries: rankWorkspaceFileSearchEntries(entries, scoped.query, maxResults) }
}
