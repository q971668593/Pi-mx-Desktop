import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { commitGrowProjectTransaction as commit, recoverGrowProjectTransaction as recover, GROW_TRANSACTION_MAX_BYTES, type GrowTransactionInput } from './grow-project-transaction'
import { GrowPrdStore } from './grow-prd-store'

let workspace: string
let prd: string
let tree: string
let input: GrowTransactionInput
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const operationDir = () => join(workspace, '.文档', 'grow-me', 'project-transactions', input.operationId)
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'grow-transaction-'))
  prd = join(workspace, '.文档', '开发规范', 'PRD.md')
  tree = join(workspace, '.文档', 'grow-me', 'session', 'tree.json')
  await mkdir(join(workspace, '.文档', '开发规范'), { recursive: true })
  await mkdir(join(workspace, '.文档', 'grow-me', 'session'), { recursive: true })
  await writeFile(prd, 'old prd\r\n'); await writeFile(tree, '{"old":true}')
  input = { workspace, treeSessionId: 'session', operationId: randomUUID(), prd: { oldHash: hash('old prd\r\n'), newContent: 'new prd' }, tree: { oldHash: hash('{"old":true}'), newContent: '{"new":true}' } }
})
afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

async function bundle(): Promise<string> {
  const dest = join(workspace, 'transaction.mjs')
  const source = await readFile(resolve('src/main/grow-project-transaction.ts'), 'utf8')
  await writeFile(dest, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  return pathToFileURL(dest).href
}
function child(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', script, ...args])
    let out = ''; let err = ''
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('error', reject); p.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}: ${err}`)))
  })
}

describe('project transaction', () => {
  it('persists original bytes and a receipt; idempotency preserves subsequent edits', async () => {
    const result = await commit(input)
    expect(result.state).toBe('committed')
    expect(await readFile(join(operationDir(), 'prd.old'), 'utf8')).toBe('old prd\r\n')
    expect(await readFile(join(operationDir(), 'tree.new'), 'utf8')).toBe('{"new":true}')
    await writeFile(prd, 'later')
    expect(await commit(input)).toEqual(result)
    expect(await readFile(prd, 'utf8')).toBe('later')
    await expect(commit({ ...input, prd: { ...input.prd, newContent: 'different' } })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it.each(['after-snapshot-prd.old', 'after-snapshot-prd.new', 'after-snapshot-tree.old', 'after-snapshot-tree.new', 'before-prepared', 'after-prepared', 'before-prd-rename', 'after-prd-rename', 'after-prd-written', 'before-tree-rename', 'after-tree-rename', 'after-tree-written', 'after-committed'])('retries interruption at %s', async point => {
    await expect(commit(input, p => { if (p === point) throw new Error('injected') })).rejects.toThrow('injected')
    expect((await commit(input)).state).toBe('committed')
    expect(await readFile(prd, 'utf8')).toBe('new prd')
    expect(await readFile(tree, 'utf8')).toBe('{"new":true}')
  })
  it.each(['prd', 'tree'])('stops before any recovery write when %s contains third-party content', async which => {
    await expect(commit(input, p => { if (p === 'after-prepared') throw Error('stop') })).rejects.toThrow()
    await writeFile(which === 'prd' ? prd : tree, 'external')
    await expect(recover(workspace, input.operationId)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(which === 'prd' ? tree : prd, 'utf8')).toBe(which === 'prd' ? '{"old":true}' : 'old prd\r\n')
  })
  it.each([[false, false], [false, true], [true, false], [true, true]])('recovers independently observed old/new states (prd new=%s, tree new=%s)', async (newPrd, newTree) => {
    await expect(commit(input, p => { if (p === 'after-prepared') throw Error('stop') })).rejects.toThrow()
    if (newPrd) await writeFile(prd, 'new prd')
    if (newTree) await writeFile(tree, '{"new":true}')
    expect((await recover(workspace, input.operationId)).state).toBe('committed')
    expect(await readFile(prd, 'utf8')).toBe('new prd')
    expect(await readFile(tree, 'utf8')).toBe('{"new":true}')
  })
  it('detects an edit immediately before rename', async () => {
    await expect(commit(input, async p => { if (p === 'before-prd-rename') await writeFile(prd, 'external') })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(prd, 'utf8')).toBe('external')
  })
  it('blocks other operations while a prepared transaction exists and validates snapshots', async () => {
    await expect(commit(input, p => { if (p === 'after-prd-rename') throw Error('stop') })).rejects.toThrow()
    await expect(commit({ ...input, operationId: randomUUID() })).rejects.toMatchObject({ code: 'INCOMPLETE' })
    await writeFile(join(operationDir(), 'tree.new'), 'corrupt')
    await expect(recover(workspace, input.operationId)).rejects.toMatchObject({ code: 'CORRUPT' })
    expect(await readFile(tree, 'utf8')).toBe('{"old":true}')
  })
  it('rejects stale hashes, unsafe session ids, oversized content, and symlinks', async () => {
    await expect(commit({ ...input, tree: { ...input.tree, oldHash: hash('stale') } })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(commit({ ...input, treeSessionId: '../escape' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(commit({ ...input, prd: { ...input.prd, newContent: 'x'.repeat(GROW_TRANSACTION_MAX_BYTES + 1) } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await rm(tree); try { await symlink(prd, tree, 'file') } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') return; throw e }
    await expect(commit(input)).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })
  it('coordinates with the existing PRD store lock', async () => {
    const store = await GrowPrdStore.open(workspace)
    let release!: () => void
    let entered!: () => void
    const paused = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const committing = commit(input, async point => { if (point === 'after-prepared') { entered(); await gate } })
    await paused
    let finished = false
    const reading = store.read().then(value => { finished = true; return value })
    let observed = false
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      observed = finished
    } finally { release() }
    await committing
    const value = await reading
    expect(observed).toBe(false)
    expect(value.content).toBe('new prd')
  })
  it('serializes competing processes with the same project lock', async () => {
    const url = await bundle()
    const script = `import {commitGrowProjectTransaction as commit} from ${JSON.stringify(url)}; try { await commit(JSON.parse(process.argv[1])); console.log('ok') } catch(e) { console.log(e.code) }`
    const other = { ...input, operationId: randomUUID(), prd: { ...input.prd, newContent: 'other' } }
    expect((await Promise.all([child(script, [JSON.stringify(input)]), child(script, [JSON.stringify(other)])])).sort()).toEqual(['CONFLICT', 'ok'])
  })
  it('recovers after an actual process exits immediately following the first rename', async () => {
    const url = await bundle()
    const script = `import {commitGrowProjectTransaction as commit} from ${JSON.stringify(url)}; await commit(JSON.parse(process.argv[1]), p => { if(p === 'after-prd-rename') process.exit(0) })`
    await child(script, [JSON.stringify(input)])
    expect(await readFile(prd, 'utf8')).toBe('new prd')
    expect(await readFile(tree, 'utf8')).toBe('{"old":true}')
    expect((await recover(workspace, input.operationId)).state).toBe('committed')
    expect(await readFile(tree, 'utf8')).toBe('{"new":true}')
  })
})
