import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { withGrowProjectLock } from './grow-project-transaction'

export type GrowBindingErrorCode = 'INVALID_INPUT' | 'INVALID_PATH' | 'NOT_FOUND' | 'CORRUPT' | 'IO_ERROR' | 'CONFLICT'
export class GrowBindingError extends Error {
  constructor(public readonly code: GrowBindingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GrowBindingError'
  }
}

const idPattern = /^[A-Za-z0-9_-]{1,64}$/
const hashPattern = /^[a-f0-9]{64}$/
const locks = new Map<string, Promise<void>>()
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
function fail(code: GrowBindingErrorCode, message: string): never { throw new GrowBindingError(code, message) }
function validPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !path.isAbsolute(value) || Buffer.from(value, 'utf8').toString('utf8') !== value) fail('INVALID_INPUT', 'Expected an absolute path')
}
function sessionKey(sessionFile: string): string {
  validPath(sessionFile)
  let normalized = path.normalize(sessionFile)
  if (process.platform === 'win32') normalized = normalized.toLowerCase()
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}
async function rootPath(workspace: string): Promise<string> {
  validPath(workspace)
  const root = await fs.realpath(workspace)
  if (!(await fs.stat(root)).isDirectory()) fail('INVALID_PATH', 'Workspace is not a directory')
  return process.platform === 'win32' ? root.toLowerCase() : root
}
async function directory(parent: string, name: string): Promise<string> {
  const dir = path.join(parent, name)
  const stat = await fs.lstat(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_PATH', 'Expected a real directory')
  return dir
}
async function basePath(root: string): Promise<string> {
  return directory(await directory(root, '.文档'), 'grow-me')
}
async function validateTree(base: string, id: string): Promise<void> {
  if (typeof id !== 'string' || !idPattern.test(id)) fail('INVALID_INPUT', 'Invalid sessionId')
  await directory(base, id)
}
async function records(file: string): Promise<Record<string, string>> {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) fail('INVALID_PATH', 'Invalid bindings path')
    const bytes = await fs.readFile(file)
    const text = bytes.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail('CORRUPT', 'Invalid bindings encoding')
    let value: unknown
    try { value = JSON.parse(text) } catch { fail('CORRUPT', 'Invalid bindings JSON') }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, id]) => !hashPattern.test(key) || typeof id !== 'string' || !idPattern.test(id))) fail('CORRUPT', 'Invalid bindings records')
    return value as Record<string, string>
  } catch (error) {
    if (missing(error)) return {}
    throw error
  }
}
async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  locks.set(key, current)
  await previous
  try { return await action() } finally {
    if (locks.get(key) === current) locks.delete(key)
    release()
  }
}
// SQLite releases its OS lock when a process exits, including after a crash.
// All writers must cooperate; external editors that ignore this lock can still lose updates.
async function processLocked<T>(base: string, action: () => Promise<T>): Promise<T> {
  const lockFile = path.join(base, '.bindings.lock.sqlite')
  try {
    const handle = await fs.open(lockFile, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = await fs.lstat(lockFile)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('INVALID_PATH', 'Invalid bindings lock path')
  const db = new DatabaseSync(lockFile)
  let acquired = false
  try {
    const deadline = Date.now() + 5000
    for (;;) {
      try { db.exec('BEGIN IMMEDIATE'); acquired = true; break } catch (error) {
        if ((error as { errcode?: number }).errcode !== 5 && (error as { code?: string }).code !== 'SQLITE_BUSY') throw error
        if (Date.now() >= deadline) throw new GrowBindingError('IO_ERROR', 'Timed out waiting for bindings lock', { cause: error })
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    return await action()
  } finally {
    try { if (acquired) db.exec('ROLLBACK') } finally { db.close() }
  }
}

async function run<T>(action: () => Promise<T>): Promise<T> {
  try { return await action() } catch (error) {
    if (error instanceof GrowBindingError) throw error
    if (missing(error)) throw new GrowBindingError('NOT_FOUND', 'Required directory does not exist', { cause: error })
    throw new GrowBindingError('IO_ERROR', 'Bindings I/O failed', { cause: error })
  }
}

/** Read a workspace-scoped binding; null means no binding. Stale tree directories raise NOT_FOUND. */
export async function readGrowBinding(workspace: string, sessionFile: string): Promise<string | null> {
  return run(async () => {
    const key = sessionKey(sessionFile)
    const root = await rootPath(workspace)
    let base: string
    try { base = await basePath(root) } catch (error) { if (missing(error)) return null; throw error }
    const id = (await records(path.join(base, 'bindings.json')))[key]
    if (id === undefined) return null
    await validateTree(base, id)
    return id
  })
}

/** Caller must hold the workspace project lock. The preparation callback runs only when no binding exists. */
export async function bindGrowBindingIfAbsentLocked(workspace: string, sessionFile: string, sessionId: string, prepareTree?: () => Promise<void>): Promise<'created' | 'existing'> {
  return run(async () => {
    const key = sessionKey(sessionFile)
    if (typeof sessionId !== 'string' || !idPattern.test(sessionId)) fail('INVALID_INPUT', 'Invalid sessionId')
    const root = await rootPath(workspace)
    return locked(root, async () => {
      const base = await basePath(root)
      return processLocked(base, async () => {
        const file = path.join(base, 'bindings.json')
        const data = await records(file)
        const current = data[key]
        if (current !== undefined) {
          if (current !== sessionId) fail('CONFLICT', 'Chat is already bound to a different tree')
          await validateTree(base, current)
          return 'existing'
        }
        await prepareTree?.()
        await validateTree(base, sessionId)
        data[key] = sessionId
        const temp = path.join(base, `.bindings.${randomUUID()}.tmp`)
        try {
          await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
          await fs.rename(temp, file)
        } finally { await fs.unlink(temp).catch(() => {}) }
        return 'created'
      })
    })
  })
}

/** Atomically update one binding. External editors must cooperate with the lock. */
export async function writeGrowBinding(workspace: string, sessionFile: string, sessionId: string): Promise<void> {
  return run(async () => {
    const key = sessionKey(sessionFile)
    if (typeof sessionId !== 'string' || !idPattern.test(sessionId)) fail('INVALID_INPUT', 'Invalid sessionId')
    const root = await rootPath(workspace)
    await withGrowProjectLock(root, () => locked(root, async () => {
      const base = await basePath(root)
      await processLocked(base, async () => {
        await validateTree(base, sessionId)
        const file = path.join(base, 'bindings.json')
        const data = await records(file)
        data[key] = sessionId
        const temp = path.join(base, `.bindings.${randomUUID()}.tmp`)
        try {
          await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
          await fs.rename(temp, file)
        } finally { await fs.unlink(temp).catch(() => {}) }
      })
    }))
  })
}
