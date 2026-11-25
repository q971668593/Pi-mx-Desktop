import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { readGrowBinding } from './grow-bindings'
import { buildGrowPrdPreview } from './grow-prd-preview'
import { assertNoIncompleteGrowTransactionsLocked, commitGrowProjectTransactionLocked, recoverGrowProjectTransactionLocked, GROW_TRANSACTION_MAX_BYTES, withGrowProjectLock } from './grow-project-transaction'

const idPattern = /^[A-Za-z0-9_-]{1,64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export class GrowPrdProjectServiceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'GrowPrdProjectServiceError' }
}
function fail(code: string, message: string): never { throw new GrowPrdProjectServiceError(code, message) }

export interface GrowPrdProjectIdentity { workspace: string; sessionFile: string; treeSessionId: string }
type Candidate = ReturnType<typeof buildGrowPrdPreview>
type Stored = { identity: GrowPrdProjectIdentity; candidate: Candidate; planExists: boolean; hashes: { prd: { before: string; after: string }; tree: { before: string; after: string } } }

async function rootPath(workspace: string): Promise<string> {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || workspace.includes('\0')) fail('INVALID_INPUT', 'Workspace must be an absolute path')
  const root = await fs.realpath(workspace)
  if (!(await fs.stat(root)).isDirectory()) fail('INVALID_PATH', 'Workspace must be a directory')
  return root
}
async function safeFile(root: string, parts: string[]): Promise<string> {
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) fail('INVALID_PATH', 'Unsafe document path')
  }
  return current
}
async function readText(root: string, parts: string[]): Promise<string> {
  const file = await safeFile(root, parts)
  if ((await fs.stat(file)).size > GROW_TRANSACTION_MAX_BYTES) fail('INVALID_INPUT', 'Document exceeds size limit')
  const data = await fs.readFile(file)
  if (data.length > GROW_TRANSACTION_MAX_BYTES) fail('INVALID_INPUT', 'Document exceeds size limit')
  const text = data.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(data)) fail('CORRUPT', 'Document is not valid UTF-8')
  return text
}
async function identity(input: GrowPrdProjectIdentity): Promise<GrowPrdProjectIdentity> {
  if (!input || typeof input.sessionFile !== 'string' || !path.isAbsolute(input.sessionFile) || input.sessionFile.includes('\0') || typeof input.treeSessionId !== 'string' || !idPattern.test(input.treeSessionId)) fail('INVALID_INPUT', 'Expected explicit chat and tree identities')
  return { workspace: await rootPath(input.workspace), sessionFile: path.normalize(input.sessionFile), treeSessionId: input.treeSessionId }
}
async function hasPlan(value: GrowPrdProjectIdentity): Promise<boolean> {
  try {
    await safeFile(value.workspace, ['.文档', 'grow-me', value.treeSessionId, '方案.html'])
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
async function checkBinding(value: GrowPrdProjectIdentity): Promise<void> {
  if (await readGrowBinding(value.workspace, value.sessionFile) !== value.treeSessionId) fail('BINDING_CONFLICT', 'Chat binding differs from the requested tree')
}

/** In-memory candidates disappear on restart. */
export class GrowPrdProjectService {
  private readonly previews = new Map<string, Stored>()

  async preview(input: GrowPrdProjectIdentity & { proposal: unknown }) {
    const who = await identity(input)
    return withGrowProjectLock(who.workspace, async () => {
      await assertNoIncompleteGrowTransactionsLocked(who.workspace)
      await checkBinding(who)
      const [prd, tree] = await Promise.all([
        readText(who.workspace, ['.文档', '开发规范', 'PRD.md']),
        readText(who.workspace, ['.文档', 'grow-me', who.treeSessionId, 'tree.json']),
      ])
      const planExists = await hasPlan(who)
      const candidate = buildGrowPrdPreview({ proposal: input.proposal, sessionId: who.treeSessionId, basePrd: prd, treeJson: tree, planExists })
      await checkBinding(who)
      const hashes = { prd: { before: hash(prd), after: hash(candidate.comparison.prd.after) }, tree: { before: hash(tree), after: hash(candidate.comparison.tree.after) } }
      const previewId = randomUUID()
      this.previews.set(previewId, { identity: who, candidate: structuredClone(candidate), planExists, hashes: structuredClone(hashes) })
      return { previewId, candidate: structuredClone(candidate), hashes: structuredClone(hashes) }
    })
  }

  async confirm(input: GrowPrdProjectIdentity & { previewId: string }) {
    const who = await identity(input)
    return withGrowProjectLock(who.workspace, async () => {
      const stored = this.previews.get(input.previewId)
      if (!stored) fail('PREVIEW_NOT_FOUND', 'Preview does not exist')
      if (who.workspace !== stored.identity.workspace || who.sessionFile !== stored.identity.sessionFile || who.treeSessionId !== stored.identity.treeSessionId) fail('IDENTITY_CONFLICT', 'Preview identity differs')
      await checkBinding(who)
      if (await hasPlan(who) !== stored.planExists) fail('PLAN_CONFLICT', 'Plan changed since preview')
      return commitGrowProjectTransactionLocked({
        workspace: who.workspace, treeSessionId: who.treeSessionId, operationId: input.previewId,
        prd: { oldHash: stored.hashes.prd.before, newContent: stored.candidate.comparison.prd.after },
        tree: { oldHash: stored.hashes.tree.before, newContent: stored.candidate.comparison.tree.after },
      })
    })
  }

  /** List published transaction directories without making recovery writes. */
  async listIncomplete(workspace: string): Promise<Array<{ operationId: string; state: string }>> {
    const root = await rootPath(workspace)
    return withGrowProjectLock(root, async () => {
      let dir: string
      try {
        const probe = ['.文档', 'grow-me', 'project-transactions']
        dir = root
        for (const part of probe) {
          dir = path.join(dir, part)
          const stat = await fs.lstat(dir)
          if (stat.isSymbolicLink() || !stat.isDirectory()) fail('INVALID_PATH', 'Unsafe transaction directory')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      const result: Array<{ operationId: string; state: string }> = []
      for (const name of await fs.readdir(dir)) {
        if (name.startsWith('.stage-')) continue
        if (!uuidPattern.test(name)) fail('CORRUPT', 'Unexpected transaction entry')
        let state = 'invalid'
        try {
          const raw = await readText(root, ['.文档', 'grow-me', 'project-transactions', name, 'metadata.json'])
          const record = JSON.parse(raw)
          if (record.version === 1 && record.operationId === name && ['prepared', 'prd-written', 'tree-written', 'committed'].includes(record.state)) state = record.state
        } catch { /* Report invalid records for inspection. */ }
        if (state !== 'committed') result.push({ operationId: name, state })
      }
      return result.sort((a, b) => a.operationId.localeCompare(b.operationId))
    })
  }

  /** Complete a published transaction after verifying its binding and tree identity. */
  async recover(input: GrowPrdProjectIdentity & { operationId: string }) {
    const who = await identity(input)
    if (typeof input.operationId !== 'string' || !uuidPattern.test(input.operationId)) fail('INVALID_INPUT', 'Invalid operation ID')
    return withGrowProjectLock(who.workspace, async () => {
      await checkBinding(who)
      return recoverGrowProjectTransactionLocked(who.workspace, input.operationId, who.treeSessionId)
    })
  }
}
