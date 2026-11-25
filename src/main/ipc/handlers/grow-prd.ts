import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z, type ZodType } from 'zod'
import { GrowPrdStore, PRD_MAX_BYTES, PrdStoreError, type PrdErrorCode } from '../../grow-prd-store'
import { authorizeProjectCwd, authorizeTrustedSessionFile } from '../../trusted-workspace'
import { GrowPrdProjectService, GrowPrdProjectServiceError } from '../../grow-prd-project-service'
import { GrowPrdPreviewError } from '../../grow-prd-preview'
import { GrowTransactionError } from '../../grow-project-transaction'
import { growPrdProjectPreviewSchema, growPrdProjectConfirmSchema, growPrdProjectListSchema, growPrdProjectRecoverSchema, growPrdProjectContextSchema } from '../schemas'
import { registerHandler } from '../registry'

const workspaceId = z.string().min(1).max(4096).refine((value) => !value.includes('\0') && !!value.trim())
const id = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const text = (max: number) => z.string().refine((value) =>
  !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= max && Buffer.from(value, 'utf8').toString('utf8') === value,
)
const workspaceSchema = z.object({ workspaceId }).strict()
const changeSchema = workspaceSchema.extend({
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: text(PRD_MAX_BYTES),
  reason: text(8192).refine((value) => !!value.trim()),
}).strict()
const commitSchema = workspaceSchema.extend({ id, confirmed: z.literal(true) }).strict()

const messages: Record<PrdErrorCode, string> = {
  INVALID_INPUT: 'Invalid PRD input.',
  INVALID_PATH: 'The PRD storage path is unsafe.',
  NOT_FOUND: 'The requested PRD or record was not found.',
  CONFLICT: 'The PRD changed; refresh and review the draft.',
  INCOMPLETE: 'An incomplete version requires review before committing.',
  CORRUPT: 'A PRD record is invalid or corrupted.',
  IO_ERROR: 'The PRD operation failed.',
}

function handler<T extends { workspaceId: string }>(
  schema: ZodType<T>,
  action: (store: GrowPrdStore, request: T) => Promise<unknown>,
) {
  return async (request: unknown) => {
    const parsed = schema.safeParse(request)
    if (!parsed.success) return { ok: false, error: 'INVALID_INPUT', message: messages.INVALID_INPUT }
    try {
      const auth = authorizeProjectCwd(parsed.data.workspaceId)
      if (!auth.ok) return { ok: false, error: 'UNAUTHORIZED', message: 'Workspace access denied.' }
      const store = await GrowPrdStore.open(auth.cwd)
      return { ok: true, data: await action(store, parsed.data) }
    } catch (error) {
      const code = error instanceof PrdStoreError && Object.hasOwn(messages, error.code) ? error.code : 'IO_ERROR'
      return { ok: false, error: code, message: messages[code] }
    }
  }
}

const projectService = new GrowPrdProjectService()

function projectHandler<T extends { workspaceId: string; sessionFile: string; treeSessionId: string }>(
  schema: ZodType<T>,
  action: (identity: { workspace: string; sessionFile: string; treeSessionId: string }, request: T) => Promise<unknown>,
) {
  return async (request: unknown) => {
    const parsed = schema.safeParse(request)
    if (!parsed.success) return { ok: false, error: 'INVALID_INPUT', message: 'Invalid project PRD request or proposal.' }
    try {
      const auth = await authorizeTrustedSessionFile(parsed.data.workspaceId, parsed.data.sessionFile)
      if (!auth.ok) return { ok: false, error: 'UNAUTHORIZED', message: 'Workspace or session access denied.' }
      const identity = { workspace: auth.cwd, sessionFile: auth.sessionFile, treeSessionId: parsed.data.treeSessionId }
      return { ok: true, data: await action(identity, parsed.data) }
    } catch (error) {
      if (error instanceof GrowPrdProjectServiceError || error instanceof GrowPrdPreviewError || error instanceof GrowTransactionError) {
        return { ok: false, error: error.code, message: `Project PRD operation failed: ${error.code}.` }
      }
      const code = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR'
      return { ok: false, error: code, message: code === 'NOT_FOUND' ? 'A required project document was not found.' : 'The project PRD operation failed.' }
    }
  }
}

/** Commit must only be invoked from an explicit user confirmation in the UI. */
export function registerGrowPrdHandlers(): void {
  registerHandler('ipc:grow-prd:read', handler(workspaceSchema, (store) => store.read()))
  registerHandler('ipc:grow-prd:createChange', handler(changeSchema, (store, { baseHash, content, reason }) =>
    store.createChange({ baseHash, content, reason })))
  registerHandler('ipc:grow-prd:listIncomplete', handler(workspaceSchema, (store) => store.listIncomplete()))
  registerHandler('ipc:grow-prd:commit', handler(commitSchema, (store, { id: changeId }) => store.commit(changeId)))
  registerGrowPrdProjectHandlers()
}

/** Register the coordinated two-document flow in the app. */
export function registerGrowPrdProjectHandlers(): void {
  registerHandler('ipc:grow-prd:projectContext', async (request: unknown) => {
    const parsed = growPrdProjectContextSchema.safeParse(request)
    if (!parsed.success) return { ok: false, error: 'INVALID_INPUT', message: 'Invalid project PRD request.' }
    const auth = authorizeProjectCwd(parsed.data.workspaceId)
    if (!auth.ok) return { ok: false, error: 'UNAUTHORIZED', message: 'Workspace access denied.' }
    try {
      const store = await GrowPrdStore.open(auth.cwd)
      let prd: { hash: string; exists: boolean }
      try {
        prd = { ...(await store.read()), exists: true }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') prd = { hash: '', exists: false }
        else throw error
      }
      const base = join(auth.cwd, '.文档', 'grow-me')
      const entries = await readdir(base, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error?.code === 'ENOENT') return []
        throw error
      })
      const trees: Array<{ sessionId: string; revision: number }> = []
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.name)) continue
        try {
          const raw = JSON.parse((await readFile(join(base, entry.name, 'tree.json'), 'utf8')).replace(/^\uFEFF/, ''))
          if (raw && typeof raw === 'object' && raw.session_id === entry.name && Number.isSafeInteger(raw.revision)) {
            trees.push({ sessionId: entry.name, revision: raw.revision })
          }
        } catch { /* 跳过损坏的树，预览阶段再报 */ }
      }
      trees.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      return { ok: true, data: { prdHash: prd.hash, prdExists: prd.exists, trees } }
    } catch {
      return { ok: false, error: 'IO_ERROR', message: 'The project PRD operation failed.' }
    }
  })
  registerHandler('ipc:grow-prd:projectPreview', projectHandler(growPrdProjectPreviewSchema, (identity, { proposal }) => projectService.preview({ ...identity, proposal })))
  registerHandler('ipc:grow-prd:projectConfirm', projectHandler(growPrdProjectConfirmSchema, (identity, { previewId }) => projectService.confirm({ ...identity, previewId })))
  registerHandler('ipc:grow-prd:projectListIncomplete', projectHandler(growPrdProjectListSchema, (identity) => projectService.listIncomplete(identity.workspace)))
  registerHandler('ipc:grow-prd:projectRecover', projectHandler(growPrdProjectRecoverSchema, (identity, { operationId }) => projectService.recover({ ...identity, operationId })))
}
