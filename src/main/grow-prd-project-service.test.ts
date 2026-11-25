import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeGrowBinding } from './grow-bindings'
import { GrowPrdProjectService } from './grow-prd-project-service'
import { commitGrowProjectTransaction, withGrowProjectLock } from './grow-project-transaction'

let workspace: string
let prd: string
let tree: string
let sessionFile: string
let service: GrowPrdProjectService
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const treeContent = JSON.stringify({ session_id: 's1', revision: 1, nodes: [{ id: 'a', answer: 'old', status: 'answered' }] })
const proposal = { basePrdHash: hash('old prd'), treeSessionId: 's1', baseTreeRevision: 1, reason: 'change', proposedPrd: 'new prd', nodeChanges: [{ nodeId: 'a', expectedOldAnswer: 'old', newAnswer: 'new' }], newQuestions: [] }
const args = () => ({ workspace, sessionFile, treeSessionId: 's1', proposal })

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'grow-service-'))
  prd = join(workspace, '.文档', '开发规范', 'PRD.md')
  tree = join(workspace, '.文档', 'grow-me', 's1', 'tree.json')
  sessionFile = join(workspace, 'chat.jsonl')
  await mkdir(join(workspace, '.文档', '开发规范'), { recursive: true })
  await mkdir(join(workspace, '.文档', 'grow-me', 's1'), { recursive: true })
  await writeFile(prd, 'old prd')
  await writeFile(tree, treeContent)
  await writeGrowBinding(workspace, sessionFile, 's1')
  service = new GrowPrdProjectService()
})
afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

describe('GrowPrdProjectService', () => {
  it('builds detached candidates with distinct identifiers and exact baseline hashes', async () => {
    const first = await service.preview(args())
    const second = await service.preview(args())
    expect(first.previewId).not.toBe(second.previewId)
    expect(first.hashes.prd).toEqual({ before: hash('old prd'), after: hash('new prd') })
    expect(first.hashes.tree.before).toBe(hash(treeContent))
    expect(first.candidate.comparison.prd).toEqual({ before: 'old prd', after: 'new prd' })
    first.candidate.comparison.prd.after = 'tampered'
    const [a, b] = await Promise.all([service.confirm({ ...args(), previewId: first.previewId }), service.confirm({ ...args(), previewId: first.previewId })])
    expect(a).toEqual(b)
    expect(a.state).toBe('committed')
    expect(await readFile(prd, 'utf8')).toBe('new prd')
    expect(JSON.parse(await readFile(tree, 'utf8')).nodes[0].answer).toBe('new')
    await writeFile(prd, 'later')
    await service.confirm({ ...args(), previewId: first.previewId })
    expect(await readFile(prd, 'utf8')).toBe('later')
  })
  it('checks the actual plan and rejects a plan created after preview', async () => {
    const preview = await service.preview(args())
    await writeFile(join(workspace, '.文档', 'grow-me', 's1', '方案.html'), '<p>plan</p>')
    await expect(service.confirm({ ...args(), previewId: preview.previewId })).rejects.toMatchObject({ code: 'PLAN_CONFLICT' })
    const updated = await service.preview(args())
    expect(JSON.parse(updated.candidate.newTreeJson).plan_stale).toBe(true)
  })
  it('rejects incorrect identities, changed bindings, and stale baselines', async () => {
    const preview = await service.preview(args())
    await expect(service.confirm({ ...args(), sessionFile: join(workspace, 'other'), previewId: preview.previewId })).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' })
    await mkdir(join(workspace, '.文档', 'grow-me', 's2'))
    await writeGrowBinding(workspace, sessionFile, 's2')
    await expect(service.confirm({ ...args(), previewId: preview.previewId })).rejects.toMatchObject({ code: 'BINDING_CONFLICT' })
    await expect(service.preview(args())).rejects.toMatchObject({ code: 'BINDING_CONFLICT' })
    await writeGrowBinding(workspace, sessionFile, 's1')
    await writeFile(prd, 'changed')
    await expect(service.confirm({ ...args(), previewId: preview.previewId })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(service.preview(args())).rejects.toMatchObject({ code: 'PRD_CONFLICT' })
  })
  it('lists malformed records and prevents recovery writes', async () => {
    expect(await service.listIncomplete(workspace)).toEqual([])
    const id = randomUUID()
    const dir = join(workspace, '.文档', 'grow-me', 'project-transactions', id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'metadata.json'), JSON.stringify({ version: 1, operationId: id, state: 'prd-written' }))
    expect(await service.listIncomplete(workspace)).toEqual([{ operationId: id, state: 'prd-written' }])
    await expect(service.recover({ ...args(), operationId: id })).rejects.toMatchObject({ code: 'CORRUPT' })
    await writeFile(join(dir, 'metadata.json'), '{')
    expect(await service.listIncomplete(workspace)).toEqual([{ operationId: id, state: 'invalid' }])
  })
  it('recovers an interrupted operation and blocks another confirmation while unfinished', async () => {
    const preview = await service.preview(args())
    const operationId = randomUUID()
    await expect(commitGrowProjectTransaction({ workspace, treeSessionId: 's1', operationId, prd: { oldHash: hash('old prd'), newContent: 'recovered' }, tree: { oldHash: hash(treeContent), newContent: 'recovered tree' } }, point => { if (point === 'after-prd-rename') throw Error('interrupted') })).rejects.toThrow('interrupted')
    await expect(service.confirm({ ...args(), previewId: preview.previewId })).rejects.toMatchObject({ code: 'INCOMPLETE' })
    await expect(service.preview(args())).rejects.toMatchObject({ code: 'INCOMPLETE' })
    expect(await service.listIncomplete(workspace)).toEqual([{ operationId, state: 'prepared' }])
    await mkdir(join(workspace, '.文档', 'grow-me', 's2'))
    await writeGrowBinding(workspace, sessionFile, 's2')
    await expect(service.recover({ workspace, sessionFile, treeSessionId: 's2', operationId })).rejects.toMatchObject({ code: 'CONFLICT' })
    await writeGrowBinding(workspace, sessionFile, 's1')
    expect((await service.recover({ ...args(), operationId })).state).toBe('committed')
    expect(await readFile(tree, 'utf8')).toBe('recovered tree')
    expect(await service.listIncomplete(workspace)).toEqual([])
  })
  it('holds the project lock against binding writes', async () => {
    await mkdir(join(workspace, '.文档', 'grow-me', 's2'))
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { entered = resolve })
    const holder = withGrowProjectLock(workspace, async () => { entered(); await gate })
    await ready
    let finished = false
    const writing = writeGrowBinding(workspace, sessionFile, 's2').then(() => { finished = true })
    try { await new Promise(resolve => setTimeout(resolve, 100)); expect(finished).toBe(false) } finally { release() }
    await Promise.all([holder, writing])
    expect(finished).toBe(true)
  })
})
