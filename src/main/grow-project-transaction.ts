import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Process interruption recovery only. Directory fsync is unavailable on Windows;
// sudden power loss and uncooperative editors are outside the guarantees.
export const GROW_TRANSACTION_MAX_BYTES = 2 * 1024 * 1024
const idPattern = /^[A-Za-z0-9_-]{1,64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hashPattern = /^[0-9a-f]{64}$/
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

export class GrowTransactionError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'INVALID_PATH' | 'CONFLICT' | 'INCOMPLETE' | 'CORRUPT' | 'IO_ERROR', message: string) { super(message); this.name = 'GrowTransactionError' }
}
function fail(code: GrowTransactionError['code'], message: string): never { throw new GrowTransactionError(code, message) }
export interface GrowTransactionInput {
  workspace: string
  treeSessionId: string
  operationId: string
  prd: { oldHash: string; newContent: string }
  tree: { oldHash: string; newContent: string }
}
type Entry = { oldHash: string; newHash: string }
export interface GrowTransactionRecord {
  version: 1
  operationId: string
  treeSessionId: string
  prd: Entry
  tree: Entry
  state: 'prepared' | 'prd-written' | 'tree-written' | 'committed'
}
export type GrowTransactionHook = (point: string) => void | Promise<void>

async function rootOf(workspace: string): Promise<string> {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || workspace.includes('\0')) fail('INVALID_INPUT', 'Workspace must be an absolute path')
  const root = await fs.realpath(workspace)
  if (!(await fs.stat(root)).isDirectory()) fail('INVALID_PATH', 'Workspace is not a directory')
  return root
}
// Check every existing path component and its real path. Like other path-based
// Node APIs this does not prevent a concurrent directory replacement by outsiders.
async function checked(root: string, parts: string[], kind: 'file' | 'directory', create = false): Promise<string> {
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!)
    const directory = i < parts.length - 1 || kind === 'directory'
    let stat
    try { stat = await fs.lstat(current) } catch (e) {
      if (!missing(e)) throw e
      if (!directory || !create) throw e
      try { await fs.mkdir(current) } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err }
      stat = await fs.lstat(current)
    }
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('INVALID_PATH', `Unsafe path: ${current}`)
    const real = await fs.realpath(current)
    const rel = path.relative(root, real)
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('INVALID_PATH', `Path escapes workspace: ${current}`)
  }
  return current
}
async function bytes(file: string, max = GROW_TRANSACTION_MAX_BYTES): Promise<Buffer> {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('INVALID_PATH', `Unsafe file: ${file}`)
  if (stat.size > max) fail('INVALID_INPUT', `File too large: ${file}`)
  const data = await fs.readFile(file)
  if (data.length > max) fail('INVALID_INPUT', `File too large: ${file}`)
  return data
}
async function writeNew(file: string, data: Buffer | string, mode = 0o600): Promise<void> {
  const handle = await fs.open(file, 'wx', mode)
  try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
}
async function replace(file: string, data: Buffer | string, mode = 0o600): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
  try { await writeNew(tmp, data, mode); await fs.rename(tmp, file) } finally { await fs.unlink(tmp).catch(() => {}) }
}

/** Shared protocol for future cooperating tree writers and the existing PRD store. */
export async function withGrowProjectLock<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  const root = await rootOf(workspace)
  const base = await checked(root, ['.文档', 'grow-me'], 'directory', true)
  const lock = path.join(base, '.project-lock.sqlite')
  try { const f = await fs.open(lock, 'wx', 0o600); await f.close() } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
  await checked(root, ['.文档', 'grow-me', '.project-lock.sqlite'], 'file')
  const db = new DatabaseSync(lock, { timeout: 0 })
  let acquired = false
  try {
    const deadline = Date.now() + 5000
    while (!acquired) {
      try { db.exec('BEGIN IMMEDIATE'); acquired = true } catch (e) {
        if (!String((e as Error).message).includes('database is locked')) throw e
        if (Date.now() >= deadline) fail('IO_ERROR', 'Project lock timed out')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    return await action()
  } finally { try { if (acquired) db.exec('ROLLBACK') } finally { db.close() } }
}
function validateId(id: unknown): asserts id is string { if (typeof id !== 'string' || !uuidPattern.test(id)) fail('INVALID_INPUT', 'Invalid operation UUID') }
function validateSession(id: unknown): asserts id is string { if (typeof id !== 'string' || !idPattern.test(id)) fail('INVALID_INPUT', 'Invalid tree session id') }
function inputEntry(value: GrowTransactionInput['prd']): Buffer {
  if (!value || typeof value.oldHash !== 'string' || !hashPattern.test(value.oldHash) || typeof value.newContent !== 'string') fail('INVALID_INPUT', 'Invalid document input')
  const result = Buffer.from(value.newContent, 'utf8')
  if (result.length > GROW_TRANSACTION_MAX_BYTES || result.toString('utf8') !== value.newContent) fail('INVALID_INPUT', 'Invalid document content')
  return result
}
const baseParts = ['.文档', 'grow-me', 'project-transactions']
async function targets(root: string, session: string): Promise<[string, string]> {
  return [await checked(root, ['.文档', '开发规范', 'PRD.md'], 'file'), await checked(root, ['.文档', 'grow-me', session, 'tree.json'], 'file')]
}
async function readRecord(root: string, id: string): Promise<GrowTransactionRecord> {
  const file = await checked(root, [...baseParts, id, 'metadata.json'], 'file')
  let v: GrowTransactionRecord
  try { v = JSON.parse((await bytes(file, 16384)).toString('utf8')) } catch { return fail('CORRUPT', 'Invalid transaction metadata') }
  if (!v || v.version !== 1 || v.operationId !== id || typeof v.treeSessionId !== 'string' || !idPattern.test(v.treeSessionId) || !['prepared', 'prd-written', 'tree-written', 'committed'].includes(v.state) || ![v.prd, v.tree].every((e) => e && typeof e.oldHash === 'string' && hashPattern.test(e.oldHash) && typeof e.newHash === 'string' && hashPattern.test(e.newHash))) fail('CORRUPT', 'Invalid transaction metadata')
  return v
}
async function snapshots(root: string, record: GrowTransactionRecord): Promise<[Buffer, Buffer, Buffer, Buffer]> {
  const result: Buffer[] = []
  for (const [name, expected] of [['prd.old', record.prd.oldHash], ['prd.new', record.prd.newHash], ['tree.old', record.tree.oldHash], ['tree.new', record.tree.newHash]] as const) {
    let data: Buffer
    try { data = await bytes(await checked(root, [...baseParts, record.operationId, name], 'file')) } catch { return fail('CORRUPT', `Missing or invalid snapshot: ${name}`) }
    if (digest(data) !== expected) fail('CORRUPT', `Snapshot hash mismatch: ${name}`)
    result.push(data)
  }
  return result as [Buffer, Buffer, Buffer, Buffer]
}
async function pending(root: string, except?: string): Promise<void> {
  let dir: string
  try { dir = await checked(root, baseParts, 'directory') } catch (e) { if (missing(e)) return; throw e }
  for (const name of await fs.readdir(dir)) {
    if (name.startsWith('.stage-')) continue // never published; no target was touched
    if (!uuidPattern.test(name)) fail('CORRUPT', `Unexpected transaction entry: ${name}`)
    if (name === except) continue
    let record: GrowTransactionRecord
    try { record = await readRecord(root, name) } catch { return fail('CORRUPT', `Invalid transaction: ${name}`) }
    if (record.state !== 'committed') fail('INCOMPLETE', `Unfinished transaction: ${name}`)
  }
}
/** Caller must hold the workspace project lock. */
export async function assertNoIncompleteGrowTransactionsLocked(workspace: string): Promise<void> {
  await pending(await rootOf(workspace))
}

async function progress(root: string, record: GrowTransactionRecord, hook?: GrowTransactionHook): Promise<GrowTransactionRecord> {
  const data = await snapshots(root, record)
  if (record.state === 'committed') return record
  const files = await targets(root, record.treeSessionId)
  const entries = [record.prd, record.tree]
  // Inspect both first: a third-party edit to either must stop before any write.
  for (let i = 0; i < 2; i++) {
    const h = digest(await bytes(files[i]!))
    if (h !== entries[i]!.oldHash && h !== entries[i]!.newHash) fail('CONFLICT', `Unexpected content: ${files[i]}`)
  }
  for (let i = 0; i < 2; i++) {
    const file = (await targets(root, record.treeSessionId))[i]!
    const h = digest(await bytes(file))
    const entry = entries[i]!
    if (h !== entry.oldHash && h !== entry.newHash) fail('CONFLICT', `Unexpected content: ${file}`)
    if (h !== entry.newHash) {
      const mode = (await fs.stat(file)).mode & 0o777
      // Recheck immediately before rename; external writers can still race this check.
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
      try {
        await writeNew(tmp, data[i === 0 ? 1 : 3]!, mode)
        await hook?.(`before-${i === 0 ? 'prd' : 'tree'}-rename`)
        const checkedFile = (await targets(root, record.treeSessionId))[i]!
        if (digest(await bytes(checkedFile)) !== entry.oldHash) fail('CONFLICT', `Changed before rename: ${file}`)
        await fs.rename(tmp, checkedFile)
      } finally { await fs.unlink(tmp).catch(() => {}) }
      await hook?.(`after-${i === 0 ? 'prd' : 'tree'}-rename`)
    }
    record.state = i === 0 ? 'prd-written' : 'tree-written'
    await replace(path.join(root, ...baseParts, record.operationId, 'metadata.json'), JSON.stringify(record))
    await hook?.(`after-${record.state}`)
  }
  // Detect external changes made while the other file was being installed.
  for (let i = 0; i < 2; i++) if (digest(await bytes((await targets(root, record.treeSessionId))[i]!)) !== entries[i]!.newHash) fail('CONFLICT', `Changed during commit: ${files[i]}`)
  record.state = 'committed'
  await replace(path.join(root, ...baseParts, record.operationId, 'metadata.json'), JSON.stringify(record))
  await hook?.('after-committed')
  return record
}

/** Commit or retry an operation. A receipt never overwrites later edits. */
export async function commitGrowProjectTransaction(input: GrowTransactionInput, hook?: GrowTransactionHook): Promise<GrowTransactionRecord> {
  return withGrowProjectLock(input.workspace, () => commitGrowProjectTransactionLocked(input, hook))
}

/** Caller must hold the workspace project lock. */
export async function commitGrowProjectTransactionLocked(input: GrowTransactionInput, hook?: GrowTransactionHook): Promise<GrowTransactionRecord> {
  validateId(input?.operationId); validateSession(input?.treeSessionId)
  const newPrd = inputEntry(input.prd); const newTree = inputEntry(input.tree)
  const root = await rootOf(input.workspace)
  {
    await pending(root, input.operationId)
    const dir = path.join(root, ...baseParts, input.operationId)
    let existing = false
    try { await checked(root, [...baseParts, input.operationId], 'directory'); existing = true } catch (e) { if (!missing(e)) throw e }
    if (existing) {
      const record = await readRecord(root, input.operationId)
      if (record.treeSessionId !== input.treeSessionId || record.prd.oldHash !== input.prd.oldHash || record.tree.oldHash !== input.tree.oldHash || record.prd.newHash !== digest(newPrd) || record.tree.newHash !== digest(newTree)) fail('CONFLICT', 'Operation UUID already used for different input')
      return progress(root, record, hook)
    }
    const files = await targets(root, input.treeSessionId)
    const oldPrd = await bytes(files[0]); const oldTree = await bytes(files[1])
    if (digest(oldPrd) !== input.prd.oldHash || digest(oldTree) !== input.tree.oldHash) fail('CONFLICT', 'Document changed since it was read')
    const base = await checked(root, baseParts, 'directory', true)
    const stage = path.join(base, `.stage-${randomUUID()}`)
    await fs.mkdir(stage)
    const record: GrowTransactionRecord = { version: 1, operationId: input.operationId, treeSessionId: input.treeSessionId, prd: { oldHash: input.prd.oldHash, newHash: digest(newPrd) }, tree: { oldHash: input.tree.oldHash, newHash: digest(newTree) }, state: 'prepared' }
    try {
      for (const [name, value] of [['prd.old', oldPrd], ['prd.new', newPrd], ['tree.old', oldTree], ['tree.new', newTree]] as const) { await writeNew(path.join(stage, name), value); await hook?.(`after-snapshot-${name}`) }
      await writeNew(path.join(stage, 'metadata.json'), JSON.stringify(record))
      await hook?.('before-prepared')
      await fs.rename(stage, dir)
      await hook?.('after-prepared')
    } finally { await fs.rm(stage, { recursive: true, force: true }) }
    return progress(root, record, hook)
  }
}
/** Recover only this published operation; hash comparison is authoritative over its log. */
export async function recoverGrowProjectTransaction(workspace: string, operationId: string, hook?: GrowTransactionHook): Promise<GrowTransactionRecord> {
  return withGrowProjectLock(workspace, () => recoverGrowProjectTransactionLocked(workspace, operationId, undefined, hook))
}

/** Caller must hold the workspace project lock. */
export async function recoverGrowProjectTransactionLocked(workspace: string, operationId: string, expectedSession?: string, hook?: GrowTransactionHook): Promise<GrowTransactionRecord> {
  validateId(operationId)
  if (expectedSession !== undefined) validateSession(expectedSession)
  const root = await rootOf(workspace)
  await pending(root, operationId)
  const record = await readRecord(root, operationId)
  if (expectedSession !== undefined && record.treeSessionId !== expectedSession) fail('CONFLICT', 'Transaction tree differs from requested tree')
  return progress(root, record, hook)
}
