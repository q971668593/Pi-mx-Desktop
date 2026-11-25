import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const PRD_MAX_BYTES = 2 * 1024 * 1024
const REASON_MAX_BYTES = 8192
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/

export type PrdErrorCode = 'INVALID_INPUT' | 'INVALID_PATH' | 'NOT_FOUND' | 'CONFLICT' | 'INCOMPLETE' | 'CORRUPT' | 'IO_ERROR'
export class PrdStoreError extends Error {
  constructor(public readonly code: PrdErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PrdStoreError'
  }
}
export interface PrdDocument { content: string; hash: string }
export interface PrdChange { id: string; baseHash: string; content: string; reason: string; createdAt: string }
export interface PrdVersion { id: string; baseHash: string; newHash: string; reason: string; createdAt: string; committedAt: string; state: 'prepared' | 'committed' }
export interface PrdIncomplete { id: string; state: 'prepared' | 'invalid' }

// SQLite's OS-managed write lock is released on process exit, including unexpected exits.
// Never wait synchronously: another holder may be running on this event loop.
async function locked<T>(root: string, action: () => Promise<T>): Promise<T> {
  const file = await safePath(root, ['.文档', 'grow-me', '.project-lock.sqlite'], true)
  const db = new DatabaseSync(file, { timeout: 0 })
  let acquired = false
  try {
    const deadline = Date.now() + 5000
    while (!acquired) {
      try { db.exec('BEGIN IMMEDIATE'); acquired = true } catch (error) {
        if (!String((error as Error).message).includes('database is locked')) throw error
        if (Date.now() >= deadline) fail('IO_ERROR', 'PRD store lock timed out; retry later')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    return await action()
  } finally {
    try { if (acquired) db.exec('ROLLBACK') } finally { db.close() }
  }
}
function fail(code: PrdErrorCode, message: string): never { throw new PrdStoreError(code, message) }
function hash(content: Buffer | string): string { return createHash('sha256').update(content).digest('hex') }
function validateText(value: unknown, max: number, name: string, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > max || (nonempty && !value.trim()) || value.includes('\0')) fail('INVALID_INPUT', `Invalid ${name}`)
  if (Buffer.from(value, 'utf8').toString('utf8') !== value) fail('INVALID_INPUT', `Invalid UTF-8 in ${name}`)
}
function validateId(id: string): void { if (typeof id !== 'string' || !ID.test(id)) fail('INVALID_INPUT', 'Invalid change id') }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
async function safePath(root: string, parts: string[], createDirectories = false): Promise<string> {
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!)
    const directory = i < parts.length - 1
    try {
      const st = await fs.lstat(current)
      if (st.isSymbolicLink() || (directory && !st.isDirectory()) || (!directory && !st.isFile())) fail('INVALID_PATH', `Unsafe path: ${current}`)
    } catch (error) {
      if (!isMissing(error)) throw error
      if (directory && createDirectories) {
        try { await fs.mkdir(current) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
        const st = await fs.lstat(current)
        if (!st.isDirectory() || st.isSymbolicLink()) fail('INVALID_PATH', `Unsafe path: ${current}`)
      } else if (directory) throw error
    }
  }
  return current
}
async function atomicWrite(file: string, data: string | Buffer, mode = 0o600): Promise<void> {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temp, data, { flag: 'wx', mode })
    await fs.rename(temp, file)
  } finally { await fs.unlink(temp).catch(() => {}) }
}
async function jsonFile(file: string): Promise<unknown> {
  const st = await fs.lstat(file)
  if (!st.isFile() || st.isSymbolicLink() || st.size > PRD_MAX_BYTES * 7) fail('CORRUPT', `Invalid record: ${file}`)
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { throw new PrdStoreError('CORRUPT', `Invalid JSON: ${file}`, { cause: error }) }
}
function changeRecord(value: unknown, id: string): PrdChange {
  const v = value as PrdChange
  if (!v || typeof v !== 'object' || v.id !== id || typeof v.baseHash !== 'string' || !HASH.test(v.baseHash) || typeof v.createdAt !== 'string') fail('CORRUPT', 'Invalid change record')
  try { validateText(v.content, PRD_MAX_BYTES, 'content'); validateText(v.reason, REASON_MAX_BYTES, 'reason', true) } catch { fail('CORRUPT', 'Invalid change record') }
  return v
}
function versionRecord(value: unknown, id: string): PrdVersion {
  const v = value as PrdVersion
  if (!v || typeof v !== 'object' || v.id !== id || typeof v.baseHash !== 'string' || !HASH.test(v.baseHash) || typeof v.newHash !== 'string' || !HASH.test(v.newHash) || typeof v.reason !== 'string' || typeof v.createdAt !== 'string' || typeof v.committedAt !== 'string' || !['prepared', 'committed'].includes(v.state)) fail('CORRUPT', 'Invalid version record')
  return v
}

/** Standalone store; workspace must exist. External writers do not participate in the lock. */
export class GrowPrdStore {
  private constructor(private readonly root: string) {}
  static async open(workspace: string): Promise<GrowPrdStore> {
    try {
      if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || workspace.includes('\0')) fail('INVALID_INPUT', 'Workspace must be an absolute path')
      const root = await fs.realpath(workspace)
      if (!(await fs.stat(root)).isDirectory()) fail('INVALID_PATH', 'Workspace is not a directory')
      return new GrowPrdStore(root)
    } catch (error) { return wrap(error) }
  }
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await locked(this.root, action) } catch (error) { return wrap(error) }
  }
  private async readCurrent(): Promise<PrdDocument> {
    const file = await safePath(this.root, ['.文档', '开发规范', 'PRD.md'])
    const st = await fs.lstat(file)
    if (!st.isFile() || st.isSymbolicLink()) fail('INVALID_PATH', 'PRD must be a regular file')
    if (st.size > PRD_MAX_BYTES) fail('INVALID_INPUT', 'PRD exceeds size limit')
    const bytes = await fs.readFile(file)
    if (bytes.length > PRD_MAX_BYTES) fail('INVALID_INPUT', 'PRD exceeds size limit')
    const content = bytes.toString('utf8')
    if (!Buffer.from(content, 'utf8').equals(bytes)) fail('CORRUPT', 'PRD is not valid UTF-8')
    return { content, hash: hash(bytes) }
  }
  async read(): Promise<PrdDocument> { return this.run(() => this.readCurrent()) }
  async createChange(input: { baseHash: string; content: string; reason: string }): Promise<PrdChange> {
    return this.run(async () => {
      if (!input || typeof input.baseHash !== 'string' || !HASH.test(input.baseHash)) fail('INVALID_INPUT', 'Invalid base hash')
      validateText(input.content, PRD_MAX_BYTES, 'content')
      validateText(input.reason, REASON_MAX_BYTES, 'reason', true)
      const current = await this.readCurrent()
      if (current.hash !== input.baseHash) fail('CONFLICT', 'PRD changed since it was read')
      const change: PrdChange = { id: randomUUID(), baseHash: input.baseHash, content: input.content, reason: input.reason, createdAt: new Date().toISOString() }
      const file = await safePath(this.root, ['.文档', 'grow-me', 'changes', `${change.id}.json`], true)
      await fs.writeFile(file, JSON.stringify(change, null, 2), { flag: 'wx', mode: 0o600 })
      return change
    })
  }
  async listIncomplete(): Promise<PrdIncomplete[]> {
    return this.run(() => this.incomplete())
  }
  private async incomplete(): Promise<PrdIncomplete[]> {
    let directory: string
    try { directory = await safePath(this.root, ['.文档', 'grow-me', 'versions', '.probe']) } catch (e) { if (isMissing(e)) return []; throw e }
    const entries = await fs.readdir(path.dirname(directory), { withFileTypes: true })
    const result: PrdIncomplete[] = []
    for (const entry of entries) {
      if (!ID.test(entry.name)) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) { result.push({ id: entry.name, state: 'invalid' }); continue }
      try {
        const file = await safePath(this.root, ['.文档', 'grow-me', 'versions', entry.name, 'metadata.json'])
        const record = versionRecord(await jsonFile(file), entry.name)
        if (record.state === 'prepared') result.push({ id: entry.name, state: 'prepared' })
      } catch (e) {
        if (e instanceof PrdStoreError && e.code === 'INVALID_PATH') throw e
        if (!isMissing(e) && !(e instanceof PrdStoreError && e.code === 'CORRUPT')) throw e
        result.push({ id: entry.name, state: 'invalid' })
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }
  private async snapshots(version: PrdVersion): Promise<{ old: Buffer; next: Buffer }> {
    const read = async (name: string, expected: string): Promise<Buffer> => {
      try {
        const file = await safePath(this.root, ['.文档', 'grow-me', 'versions', version.id, name])
        const st = await fs.lstat(file)
        if (st.size > PRD_MAX_BYTES) fail('CORRUPT', `Invalid snapshot: ${name}`)
        const data = await fs.readFile(file)
        if (data.length > PRD_MAX_BYTES || hash(data) !== expected) fail('CORRUPT', `Invalid snapshot: ${name}`)
        return data
      } catch (error) {
        if (isMissing(error)) fail('CORRUPT', `Missing snapshot: ${name}`)
        throw error
      }
    }
    return { old: await read('old.md', version.baseHash), next: await read('new.md', version.newHash) }
  }
  /** Recover a prepared transaction. Cancellation retains its directory as evidence. */
  async recover(id: string, action: 'cancel' | 'retry'): Promise<PrdVersion | null> {
    return this.run(async () => {
      validateId(id)
      if (action !== 'cancel' && action !== 'retry') fail('INVALID_INPUT', 'Invalid recovery action')
      const pending = await this.incomplete()
      if (pending.some((entry) => entry.id !== id)) fail('INCOMPLETE', 'Other unfinished versions require review')
      const metadataPath = await safePath(this.root, ['.文档', 'grow-me', 'versions', id, 'metadata.json'])
      const version = versionRecord(await jsonFile(metadataPath), id)
      if (version.state !== 'prepared') fail('CONFLICT', 'Version is not prepared')
      const snapshots = await this.snapshots(version)
      const current = await this.readCurrent()
      if (current.hash !== version.baseHash && current.hash !== version.newHash) fail('CONFLICT', 'PRD differs from both transaction snapshots')
      if (action === 'cancel') {
        if (current.hash !== version.baseHash) fail('CONFLICT', 'PRD already contains the new version')
        const archive = await safePath(this.root, ['.文档', 'grow-me', 'cancelled', `${id}-${randomUUID()}`, '.probe'], true)
        // The destination was created by safePath; remove the empty directory before rename.
        await fs.rmdir(path.dirname(archive))
        await fs.rename(path.dirname(metadataPath), path.dirname(archive))
        return null
      }
      if (current.hash === version.baseHash && current.hash !== version.newHash) {
        const prdPath = await safePath(this.root, ['.文档', '开发规范', 'PRD.md'])
        const mode = (await fs.stat(prdPath)).mode & 0o777
        if ((await this.readCurrent()).hash !== version.baseHash) fail('CONFLICT', 'PRD changed during recovery')
        await atomicWrite(prdPath, snapshots.next, mode)
      }
      version.state = 'committed'
      await atomicWrite(metadataPath, JSON.stringify(version, null, 2))
      return version
    })
  }
  async commit(id: string): Promise<PrdVersion> {
    return this.run(async () => {
      validateId(id)
      const incomplete = await this.incomplete()
      if (incomplete.length) fail('INCOMPLETE', `Unfinished version: ${incomplete.map((x) => x.id).join(', ')}`)
      let existingPath: string | undefined
      try { existingPath = await safePath(this.root, ['.文档', 'grow-me', 'versions', id, 'metadata.json']) } catch (e) { if (!isMissing(e)) throw e }
      // Existing committed metadata is the idempotency receipt, even if PRD changed later.
      if (existingPath) {
        try {
          const version = versionRecord(await jsonFile(existingPath), id)
          if (version.state !== 'committed') fail('INCOMPLETE', 'Version requires recovery')
          await this.snapshots(version)
          return version
        } catch (e) { if (!isMissing(e)) throw e }
      }
      const changePath = await safePath(this.root, ['.文档', 'grow-me', 'changes', `${id}.json`])
      const change = changeRecord(await jsonFile(changePath), id)
      const current = await this.readCurrent()
      if (current.hash !== change.baseHash) fail('CONFLICT', 'PRD changed since draft creation')
      const version: PrdVersion = { id, baseHash: change.baseHash, newHash: hash(change.content), reason: change.reason, createdAt: change.createdAt, committedAt: new Date().toISOString(), state: 'prepared' }
      const metadataPath = await safePath(this.root, ['.文档', 'grow-me', 'versions', id, 'metadata.json'], true)
      const dir = path.dirname(metadataPath)
      await atomicWrite(path.join(dir, 'old.md'), current.content)
      await atomicWrite(path.join(dir, 'new.md'), change.content)
      await atomicWrite(metadataPath, JSON.stringify(version, null, 2))
      const prdPath = await safePath(this.root, ['.文档', '开发规范', 'PRD.md'])
      const mode = (await fs.stat(prdPath)).mode & 0o777
      if ((await this.readCurrent()).hash !== change.baseHash) fail('CONFLICT', 'PRD changed during commit; prepared version requires review')
      await atomicWrite(prdPath, change.content, mode)
      version.state = 'committed'
      await atomicWrite(metadataPath, JSON.stringify(version, null, 2))
      return version
    })
  }
}
function wrap(error: unknown): never {
  if (error instanceof PrdStoreError) throw error
  if (isMissing(error)) throw new PrdStoreError('NOT_FOUND', 'Required file or directory does not exist', { cause: error })
  throw new PrdStoreError('IO_ERROR', 'PRD store operation failed', { cause: error })
}
