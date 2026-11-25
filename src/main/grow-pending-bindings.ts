import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { bindGrowBindingIfAbsentLocked, GrowBindingError } from './grow-bindings'
import { withGrowProjectLock } from './grow-project-transaction'

export interface GrowPendingBinding {
  version: 1
  draftId: string
  tree: Record<string, unknown> & { session_id: string; revision: number; nodes: unknown[] }
  sessionFile: string | null
  sessionId: string | null
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const treeId = /^[A-Za-z0-9_-]{1,64}$/
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export class GrowPendingBindingError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'INVALID_PATH' | 'NOT_FOUND' | 'CONFLICT' | 'CORRUPT', message: string) { super(message); this.name = 'GrowPendingBindingError' }
}
function fail(code: GrowPendingBindingError['code'], message: string): never { throw new GrowPendingBindingError(code, message) }
function validateId(id: string): void { if (typeof id !== 'string' || !uuid.test(id)) fail('INVALID_INPUT', 'Invalid draft UUID') }
function validateTree(tree: GrowPendingBinding['tree']): void {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree) || typeof tree.session_id !== 'string' || !treeId.test(tree.session_id) || !Number.isSafeInteger(tree.revision) || tree.revision < 0 || !Array.isArray(tree.nodes)) fail('INVALID_INPUT', 'Invalid tree')
}
function validateSession(sessionFile: string, sessionId: string): void {
  if (typeof sessionFile !== 'string' || !path.isAbsolute(sessionFile) || sessionFile.includes('\0') || typeof sessionId !== 'string' || !sessionId.trim() || sessionId.includes('\0')) fail('INVALID_INPUT', 'Invalid chat identity')
}
async function directory(root: string): Promise<string> {
  const dir = path.join(root, '.文档', 'grow-me', 'pending-bindings')
  try { await fs.mkdir(dir) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
  const st = await fs.lstat(dir)
  if (!st.isDirectory() || st.isSymbolicLink()) fail('INVALID_PATH', 'Invalid pending bindings directory')
  return dir
}
async function readRecord(dir: string, id: string): Promise<GrowPendingBinding | null> {
  validateId(id)
  const file = path.join(dir, `${id}.json`)
  try {
    const st = await fs.lstat(file)
    if (!st.isFile() || st.isSymbolicLink() || st.size > 2 * 1024 * 1024) fail('CORRUPT', 'Invalid pending binding file')
    const bytes = await fs.readFile(file)
    if (bytes.length > 2 * 1024 * 1024 || !Buffer.from(bytes.toString('utf8')).equals(bytes)) fail('CORRUPT', 'Invalid pending binding encoding or size')
    let record: GrowPendingBinding
    try { record = JSON.parse(bytes.toString('utf8')) } catch { return fail('CORRUPT', 'Invalid pending binding JSON') }
    try {
      if (!record || record.version !== 1 || record.draftId !== id) fail('CORRUPT', 'Invalid pending binding')
      validateTree(record.tree)
      if (record.sessionFile !== null || record.sessionId !== null) validateSession(record.sessionFile!, record.sessionId!)
    } catch { return fail('CORRUPT', 'Invalid pending binding') }
    return record
  } catch (e) { if (missing(e)) return null; throw e }
}
async function save(dir: string, record: GrowPendingBinding): Promise<void> {
  let data: string
  try { data = JSON.stringify(record, null, 2) + '\n' } catch { return fail('INVALID_INPUT', 'Tree must be JSON serializable') }
  if (Buffer.byteLength(data) > 2 * 1024 * 1024) fail('INVALID_INPUT', 'Pending binding too large')
  // Validate the serialized tree before installing it.
  const decoded = JSON.parse(data) as GrowPendingBinding
  validateTree(decoded.tree)
  const temp = path.join(dir, `.pending-${randomUUID()}.tmp`)
  try { await fs.writeFile(temp, data, { flag: 'wx', mode: 0o600 }); await fs.rename(temp, path.join(dir, `${record.draftId}.json`)) } finally { await fs.unlink(temp).catch(() => {}) }
}

async function sessionReady(root: string, record: GrowPendingBinding): Promise<boolean> {
  if (!record.sessionFile || !record.sessionId) return false
  let bytes: Buffer
  try {
    const stat = await fs.lstat(record.sessionFile)
    if (!stat.isFile() || stat.isSymbolicLink()) return false
    bytes = await fs.readFile(record.sessionFile)
  } catch (error) { if (missing(error)) return false; throw error }
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes) || !text.endsWith('\n')) return false
  const lines = text.slice(0, -1).split('\n')
  let entries: unknown[]
  try { entries = lines.map(line => JSON.parse(line)) } catch { return false }
  if (entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) return false
  const header = entries[0] as Record<string, unknown>
  if (header.type !== 'session' || header.id !== record.sessionId || typeof header.cwd !== 'string' || !path.isAbsolute(header.cwd)) return false
  try {
    const cwd = await fs.realpath(header.cwd)
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    if (normalize(cwd) !== normalize(root)) return false
  } catch { return false }
  return entries.slice(1).some(entry => {
    const value = entry as Record<string, unknown>
    if (value.type !== 'message' || !value.message || typeof value.message !== 'object' || Array.isArray(value.message)) return false
    const message = value.message as Record<string, unknown>
    return message.role === 'user' && (typeof message.content === 'string' || (Array.isArray(message.content) && message.content.length > 0 && message.content.every(part => part && typeof part === 'object' && !Array.isArray(part) && typeof part.type === 'string')))
  })
}

async function installTree(root: string, tree: GrowPendingBinding['tree']): Promise<void> {
  const dir = path.join(root, '.文档', 'grow-me', tree.session_id)
  try { await fs.mkdir(dir) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const stat = await fs.lstat(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_PATH', 'Invalid tree directory')
  const file = path.join(dir, 'tree.json')
  const temp = path.join(dir, `.tree-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temp, JSON.stringify(tree, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    try { await fs.link(temp, file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await fs.lstat(file)
      if (!existing.isFile() || existing.isSymbolicLink()) fail('INVALID_PATH', 'Invalid tree file')
      let value: unknown
      try { value = JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fail('CONFLICT', 'Existing tree differs') }
      if (!isDeepStrictEqual(value, tree)) fail('CONFLICT', 'Existing tree differs')
    }
  } finally { await fs.unlink(temp).catch(() => {}) }
}

/** Durable draft records. */
export class GrowPendingBindings {
  constructor(private readonly workspace: string) {}
  private async locked<T>(action: (dir: string) => Promise<T>): Promise<T> {
    return withGrowProjectLock(this.workspace, async () => action(await directory(await fs.realpath(this.workspace))))
  }
  async create(tree: GrowPendingBinding['tree']): Promise<GrowPendingBinding> {
    validateTree(tree)
    return this.locked(async dir => {
      const record: GrowPendingBinding = { version: 1, draftId: randomUUID(), tree, sessionFile: null, sessionId: null }
      await save(dir, record)
      return (await readRecord(dir, record.draftId))!
    })
  }
  async read(draftId: string): Promise<GrowPendingBinding | null> { return this.locked(dir => readRecord(dir, draftId)) }
  async updateTree(draftId: string, expectedRevision: number, tree: GrowPendingBinding['tree']): Promise<GrowPendingBinding> {
    validateTree(tree)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || tree.revision !== expectedRevision + 1) fail('INVALID_INPUT', 'Expected the next revision')
    return this.locked(async dir => {
      const record = await readRecord(dir, draftId)
      if (!record) return fail('NOT_FOUND', 'Draft not found')
      if (record.tree.revision !== expectedRevision || record.tree.session_id !== tree.session_id) fail('CONFLICT', 'Tree changed or identity differs')
      record.tree = tree
      await save(dir, record)
      return (await readRecord(dir, draftId))!
    })
  }
  /** Caller must ensure sessionFile belongs to a trusted session directory. Drafts are retained for crash retries. */
  async convert(draftId: string): Promise<'pending' | 'converted'> {
    return this.locked(async dir => {
      const record = await readRecord(dir, draftId)
      if (!record) return fail('NOT_FOUND', 'Draft not found')
      const root = await fs.realpath(this.workspace)
      if (!await sessionReady(root, record)) return 'pending'
      try {
        await bindGrowBindingIfAbsentLocked(root, record.sessionFile!, record.tree.session_id, () => installTree(root, record.tree))
      } catch (error) {
        if (error instanceof GrowBindingError && error.code === 'CONFLICT') fail('CONFLICT', error.message)
        throw error
      }
      return 'converted'
    })
  }
  async registerChat(draftId: string, sessionFile: string, sessionId: string): Promise<GrowPendingBinding> {
    validateSession(sessionFile, sessionId)
    sessionFile = path.normalize(sessionFile)
    return this.locked(async dir => {
      const record = await readRecord(dir, draftId)
      if (!record) return fail('NOT_FOUND', 'Draft not found')
      if (record.sessionFile !== null && (record.sessionFile !== sessionFile || record.sessionId !== sessionId)) fail('CONFLICT', 'Chat identity already registered')
      if (record.sessionFile === null) { record.sessionFile = sessionFile; record.sessionId = sessionId; await save(dir, record) }
      return record
    })
  }
}
