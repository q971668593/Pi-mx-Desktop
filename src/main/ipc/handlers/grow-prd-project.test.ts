import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorizeSession: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
vi.mock('../../trusted-workspace', () => ({ authorizeProjectCwd: vi.fn(), authorizeTrustedSessionFile: mocks.authorizeSession }))
import { writeGrowBinding } from '../../grow-bindings'
import { commitGrowProjectTransaction } from '../../grow-project-transaction'
import { invokeHandler } from '../registry'
import { registerGrowPrdHandlers } from './grow-prd'

let workspace: string, sessionFile: string, prd: string, tree: string
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const treeContent = JSON.stringify({ session_id: 's1', revision: 1, nodes: [] })
const proposal = { basePrdHash: hash('old'), treeSessionId: 's1', baseTreeRevision: 1, reason: 'update', proposedPrd: 'new', nodeChanges: [], newQuestions: [] }
const identity = () => ({ workspaceId: workspace, sessionFile, treeSessionId: 's1' })
const invoke = (op: string, request: Record<string, unknown>) => invokeHandler<{ ok: boolean; error?: string; data: { previewId: string } }>(`ipc:grow-prd:project${op}`, request)

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'grow-project-ipc-'))
  sessionFile = join(workspace, 'chat.jsonl')
  prd = join(workspace, '.文档', '开发规范', 'PRD.md')
  tree = join(workspace, '.文档', 'grow-me', 's1', 'tree.json')
  await mkdir(join(workspace, '.文档', '开发规范'), { recursive: true })
  await mkdir(join(workspace, '.文档', 'grow-me', 's1'), { recursive: true })
  await writeFile(prd, 'old')
  await writeFile(tree, treeContent)
  await writeGrowBinding(workspace, sessionFile, 's1')
  mocks.authorizeSession.mockReset().mockResolvedValue({ ok: true, cwd: workspace, sessionFile })
  registerGrowPrdHandlers()
})
afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

describe('project PRD IPC', () => {
  it('previews without writes and confirms the stored candidate', async () => {
    const preview = await invoke('Preview', { ...identity(), proposal })
    expect(preview).toMatchObject({ ok: true, data: { candidate: { comparison: { prd: { before: 'old', after: 'new' } } } } })
    expect(await readFile(prd, 'utf8')).toBe('old')
    expect(await invoke('Confirm', { ...identity(), previewId: preview.data.previewId })).toMatchObject({ ok: false, error: 'INVALID_INPUT' })
    expect(await invoke('Confirm', { ...identity(), previewId: preview.data.previewId, confirmed: true })).toMatchObject({ ok: true, data: { state: 'committed' } })
    expect(await readFile(prd, 'utf8')).toBe('new')
    expect(mocks.authorizeSession).toHaveBeenCalledTimes(2)
  })
  it('validates proposals and all identities before service access', async () => {
    expect(await invoke('Preview', { ...identity(), proposal: { ...proposal, extra: 1 } })).toMatchObject({ ok: false, error: 'INVALID_INPUT' })
    expect(await invoke('Preview', { ...identity(), proposal: { ...proposal, proposedPrd: 'x'.repeat(2 * 1024 * 1024 + 1) } })).toMatchObject({ ok: false, error: 'INVALID_INPUT' })
    expect(await invoke('Recover', { ...identity(), operationId: '../x', confirmed: true })).toMatchObject({ ok: false, error: 'INVALID_INPUT' })
    expect(mocks.authorizeSession).not.toHaveBeenCalled()
    for (const [op, args] of [['Preview', { proposal }], ['Confirm', { previewId: randomUUID(), confirmed: true }], ['ListIncomplete', {}], ['Recover', { operationId: randomUUID(), confirmed: true }]] as const) {
      mocks.authorizeSession.mockResolvedValueOnce({ ok: false, error: 'session_workspace_mismatch' })
      expect(await invoke(op, { ...identity(), ...args })).toMatchObject({ ok: false, error: 'UNAUTHORIZED' })
    }
    expect(mocks.authorizeSession).toHaveBeenCalledTimes(4)
  })
  it('lists and recovers interrupted transactions and reports conflicts', async () => {
    const operationId = randomUUID()
    await expect(commitGrowProjectTransaction({ workspace, treeSessionId: 's1', operationId, prd: { oldHash: hash('old'), newContent: 'recovered' }, tree: { oldHash: hash(treeContent), newContent: 'tree' } }, point => { if (point === 'after-prd-rename') throw Error('stop') })).rejects.toThrow()
    expect(await invoke('ListIncomplete', identity())).toMatchObject({ ok: true, data: [{ operationId }] })
    expect(await invoke('Preview', { ...identity(), proposal })).toMatchObject({ ok: false, error: 'INCOMPLETE' })
    expect(await invoke('Recover', { ...identity(), operationId, confirmed: true })).toMatchObject({ ok: true, data: { state: 'committed' } })
    expect(await readFile(tree, 'utf8')).toBe('tree')
    expect(await invoke('ListIncomplete', identity())).toEqual({ ok: true, data: [] })
  })
})
