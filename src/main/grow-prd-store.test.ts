import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { GrowPrdStore, PRD_MAX_BYTES } from './grow-prd-store'

let workspace: string
let store: GrowPrdStore
let prd: string
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'grow-prd-'))
  prd = join(workspace, '.文档', '开发规范', 'PRD.md')
  await mkdir(join(workspace, '.文档', '开发规范'), { recursive: true })
  await writeFile(prd, '# 原文\r\n手工内容\r\n')
  store = await GrowPrdStore.open(workspace)
})
afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

describe('GrowPrdStore', () => {
  it('creates the shared lock under grow-me without a root lock file', async () => {
    await store.read()
    expect(await readdir(join(workspace, '.文档', 'grow-me'))).toContain('.project-lock.sqlite')
    expect(await readdir(workspace)).toEqual(['.文档'])
  })
  it('persists a draft, snapshots, metadata and an idempotent receipt', async () => {
    const initial = await store.read()
    const draft = await store.createChange({ baseHash: initial.hash, content: '# 新内容\n', reason: '调整需求' })
    expect(JSON.parse(await readFile(join(workspace, '.文档', 'grow-me', 'changes', `${draft.id}.json`), 'utf8'))).toEqual(draft)
    const version = await store.commit(draft.id)
    const dir = join(workspace, '.文档', 'grow-me', 'versions', draft.id)
    expect(await readFile(join(dir, 'old.md'), 'utf8')).toBe(initial.content)
    expect(await readFile(join(dir, 'new.md'), 'utf8')).toBe('# 新内容\n')
    expect(JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8'))).toEqual(version)
    expect(await store.read()).toEqual({ content: '# 新内容\n', hash: version.newHash })
    await writeFile(prd, '后续人工修改')
    expect(await store.commit(draft.id)).toEqual(version)
    expect(await readFile(prd, 'utf8')).toBe('后续人工修改')
    expect(await store.listIncomplete()).toEqual([])
  })
  it('detects edits before draft creation and commit without overwriting them', async () => {
    const initial = await store.read()
    const draft = await store.createChange({ baseHash: initial.hash, content: 'new', reason: 'reason' })
    await writeFile(prd, '人工编辑')
    await expect(store.createChange({ baseHash: initial.hash, content: 'other', reason: 'reason' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(store.commit(draft.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(prd, 'utf8')).toBe('人工编辑')
    expect(await store.listIncomplete()).toEqual([])
  })
  it('serializes competing commits from different instances', async () => {
    const initial = await store.read()
    const a = await store.createChange({ baseHash: initial.hash, content: 'A', reason: 'A' })
    const b = await store.createChange({ baseHash: initial.hash, content: 'B', reason: 'B' })
    const other = await GrowPrdStore.open(workspace)
    const results = await Promise.allSettled([store.commit(a.id), other.commit(b.id)])
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((x) => x.status === 'rejected').map((x) => (x as PromiseRejectedResult).reason.code)).toEqual(['CONFLICT'])
  })
  it('serializes commits across separate processes', async () => {
    const initial = await store.read()
    const a = await store.createChange({ baseHash: initial.hash, content: 'A', reason: 'A' })
    const b = await store.createChange({ baseHash: initial.hash, content: 'B', reason: 'B' })
    const bundle = join(workspace, 'store.mjs')
    const source = await readFile(resolve('src/main/grow-prd-store.ts'), 'utf8')
    await writeFile(bundle, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
    const worker = `import { GrowPrdStore } from ${JSON.stringify(pathToFileURL(bundle).href)}; const s = await GrowPrdStore.open(process.argv[1]); try { await s.commit(process.argv[2]); console.log('ok') } catch (e) { console.log(e.code) }`
    const run = (id: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', worker, workspace, id])
      let output = ''
      let errors = ''
      child.stdout.on('data', (data) => { output += data })
      child.stderr.on('data', (data) => { errors += data })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)))
    })
    expect((await Promise.all([run(a.id), run(b.id)])).sort()).toEqual(['CONFLICT', 'ok'])
  })
  it('times out behind a live process and releases its lock after that process exits', async () => {
    const lock = join(workspace, '.文档', 'grow-me', '.project-lock.sqlite')
    await mkdir(join(workspace, '.文档', 'grow-me'), { recursive: true })
    const worker = `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); console.log('ready'); setInterval(() => {}, 1000)`
    const child = spawn(process.execPath, ['-e', worker, lock])
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once('data', () => resolve())
        child.once('error', reject)
        child.once('exit', (code) => reject(new Error(`Lock holder exited: ${code}`)))
      })
      await expect(store.read()).rejects.toMatchObject({ code: 'IO_ERROR', message: expect.stringContaining('timed out') })
    } finally {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.kill()
      await exited
    }
    expect((await store.read()).content).toContain('原文')
  }, 10000)
  it('recovers prepared transactions and retains cancelled evidence', async () => {
    const initial = await store.read()
    const draft = await store.createChange({ baseHash: initial.hash, content: 'new', reason: 'reason' })
    const committed = await store.commit(draft.id)
    const dir = join(workspace, '.文档', 'grow-me', 'versions', draft.id)
    const metadata = join(dir, 'metadata.json')
    const prepare = () => writeFile(metadata, JSON.stringify({ ...committed, state: 'prepared' }))
    await prepare()
    await expect(store.recover(draft.id, 'cancel')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await store.recover(draft.id, 'retry')).toEqual(committed)
    await prepare()
    await writeFile(prd, initial.content)
    expect(await store.recover(draft.id, 'retry')).toEqual(committed)
    expect(await readFile(prd, 'utf8')).toBe('new')
    await prepare()
    await writeFile(prd, 'external')
    await expect(store.recover(draft.id, 'retry')).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(store.recover(draft.id, 'cancel')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(prd, 'utf8')).toBe('external')
    await writeFile(prd, initial.content)
    expect(await store.recover(draft.id, 'cancel')).toBeNull()
    expect(await store.listIncomplete()).toEqual([])
    const archive = join(workspace, '.文档', 'grow-me', 'cancelled')
    const [entry] = await readdir(archive)
    expect(await readFile(join(archive, entry!, 'old.md'), 'utf8')).toBe(initial.content)
  })
  it('rejects damaged or missing snapshots for recovery and idempotent receipts', async () => {
    const initial = await store.read()
    const draft = await store.createChange({ baseHash: initial.hash, content: 'new', reason: 'reason' })
    const version = await store.commit(draft.id)
    const dir = join(workspace, '.文档', 'grow-me', 'versions', draft.id)
    await writeFile(join(dir, 'old.md'), 'damaged')
    await expect(store.commit(draft.id)).rejects.toMatchObject({ code: 'CORRUPT' })
    await writeFile(join(dir, 'metadata.json'), JSON.stringify({ ...version, state: 'prepared' }))
    await expect(store.recover(draft.id, 'retry')).rejects.toMatchObject({ code: 'CORRUPT' })
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(version))
    await writeFile(join(dir, 'old.md'), initial.content)
    await rm(join(dir, 'new.md'))
    await expect(store.commit(draft.id)).rejects.toMatchObject({ code: 'CORRUPT' })
    await writeFile(join(dir, 'metadata.json'), JSON.stringify({ ...version, state: 'prepared' }))
    await expect(store.recover(draft.id, 'retry')).rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(store.recover(draft.id, 'cancel')).rejects.toMatchObject({ code: 'CORRUPT' })
    expect(await store.listIncomplete()).toEqual([{ id: draft.id, state: 'prepared' }])
  })
  it('reports interrupted and malformed version directories and blocks further commits', async () => {
    const initial = await store.read()
    const draft = await store.createChange({ baseHash: initial.hash, content: 'A', reason: 'A' })
    const dir = join(workspace, '.文档', 'grow-me', 'versions', draft.id)
    await mkdir(dir, { recursive: true })
    expect(await store.listIncomplete()).toEqual([{ id: draft.id, state: 'invalid' }])
    await expect(store.commit(draft.id)).rejects.toMatchObject({ code: 'INCOMPLETE' })
    await writeFile(join(dir, 'metadata.json'), JSON.stringify({ id: draft.id, baseHash: initial.hash, newHash: initial.hash, reason: 'A', createdAt: 'now', committedAt: 'now', state: 'prepared' }))
    expect(await store.listIncomplete()).toEqual([{ id: draft.id, state: 'prepared' }])
    expect(await readFile(prd, 'utf8')).toBe(initial.content)
  })
  it('rejects missing PRD, invalid input, and traversal identifiers', async () => {
    const initial = await store.read()
    await expect(store.createChange({ baseHash: initial.hash, content: 'x'.repeat(PRD_MAX_BYTES + 1), reason: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(store.createChange({ baseHash: initial.hash, content: 'x', reason: ' ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(store.commit('../PRD')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const draft = await store.createChange({ baseHash: initial.hash, content: 'new', reason: 'x' })
    await rm(prd)
    await expect(store.commit(draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(store.read()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await store.listIncomplete()).toEqual([])
  })
  it('rejects symlinked PRD and storage paths', async () => {
    if (process.platform !== 'win32') {
      await rm(prd)
      await symlink(join(workspace, 'elsewhere'), prd, 'file')
      await expect(store.read()).rejects.toMatchObject({ code: 'INVALID_PATH' })
      await rm(prd)
      await writeFile(prd, 'original')
    }
    const initial = await store.read()
    await rm(join(workspace, '.文档', 'grow-me'), { recursive: true })
    await symlink(join(workspace, '.文档', '开发规范'), join(workspace, '.文档', 'grow-me'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store.createChange({ baseHash: initial.hash, content: 'new', reason: 'reason' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })
})
