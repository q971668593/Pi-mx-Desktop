import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { readGrowBinding, writeGrowBinding } from './grow-bindings'

const workspaces: string[] = []
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'grow-bindings-'))
  workspaces.push(root)
  return root
}
async function tree(root: string, id: string) { await mkdir(path.join(root, '.文档', 'grow-me', id), { recursive: true }) }
async function childModule(root: string) {
  const source = await readFile(path.join(process.cwd(), 'src/main/grow-bindings.ts'), 'utf8')
  const transaction = await readFile(path.join(process.cwd(), 'src/main/grow-project-transaction.ts'), 'utf8')
  const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
  await writeFile(path.join(root, 'transaction.mjs'), ts.transpileModule(transaction, options).outputText)
  const js = ts.transpileModule(source, options).outputText.replace('./grow-project-transaction', './transaction.mjs')
  const file = path.join(root, 'bindings.mjs')
  await writeFile(file, js)
  return pathToFileURL(file).href
}
function child(script: string, args: string[]) {
  const proc = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  proc.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Child exited ${code ?? signal}: ${stderr}`)))
  })
  return { proc, done }
}
afterEach(async () => { await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('grow bindings', () => {
  it('stores only hashed paths, normalizes paths, preserves other entries and isolates workspaces', async () => {
    const a = await workspace(), b = await workspace()
    await Promise.all([tree(a, 'tree_1'), tree(a, 'tree-2'), tree(b, 'tree_1')])
    const chat = path.join(a, 'private', 'chat.jsonl')
    expect(await readGrowBinding(a, chat)).toBeNull()
    await writeGrowBinding(a, chat, 'tree_1')
    await writeGrowBinding(a, path.join(a, 'other.jsonl'), 'tree-2')
    expect(await readGrowBinding(a, path.join(a, 'private', 'x', '..', 'chat.jsonl'))).toBe('tree_1')
    expect(await readGrowBinding(b, chat)).toBeNull()
    const raw = await readFile(path.join(a, '.文档', 'grow-me', 'bindings.json'), 'utf8')
    expect(raw).not.toContain(chat)
    expect(Object.keys(JSON.parse(raw))).toEqual(expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)]))
    expect(Object.keys(JSON.parse(raw))).toHaveLength(2)
    await writeGrowBinding(a, chat, 'tree-2')
    expect(await readGrowBinding(a, path.join(a, 'other.jsonl'))).toBe('tree-2')
  })
  it('serializes concurrent updates without losing records', async () => {
    const root = await workspace()
    await tree(root, 'tree')
    await Promise.all(Array.from({ length: 40 }, (_, i) => writeGrowBinding(root, path.join(root, `${i}.jsonl`), 'tree')))
    const values = await Promise.all(Array.from({ length: 40 }, (_, i) => readGrowBinding(root, path.join(root, `${i}.jsonl`))))
    expect(values).toEqual(Array(40).fill('tree'))
  })
  it('preserves updates from separate processes', async () => {
    const root = await workspace()
    await tree(root, 'tree')
    const moduleUrl = await childModule(root)
    const script = `const { writeGrowBinding } = await import(process.argv[1]);
      const [root, index] = process.argv.slice(2);
      for (let i = 0; i < 10; i++) await writeGrowBinding(root, root + '/child-' + index + '-' + i, 'tree');`
    await Promise.all(Array.from({ length: 5 }, (_, i) => child(script, [moduleUrl, root, String(i)]).done))
    const values = await Promise.all(Array.from({ length: 50 }, (_, i) => readGrowBinding(root, path.join(root, `child-${Math.floor(i / 10)}-${i % 10}`))))
    expect(values).toEqual(Array(50).fill('tree'))
  }, 30000)
  it('reports a lock timeout and recovers after the lock owner dies', async () => {
    const root = await workspace()
    await tree(root, 'tree')
    const lock = path.join(root, '.文档', 'grow-me', '.bindings.lock.sqlite')
    const holder = child(`import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE');
      console.log('locked'); setInterval(() => {}, 1000);`, [lock])
    const exited = holder.done.catch(() => {})
    try {
      await new Promise<void>((resolve, reject) => {
        holder.proc.stdout.once('data', () => resolve())
        holder.proc.once('error', reject)
        holder.proc.once('exit', () => reject(new Error('Lock holder exited before acquiring lock')))
      })
      await expect(writeGrowBinding(root, path.join(root, 'chat'), 'tree')).rejects.toMatchObject({ code: 'IO_ERROR', message: 'Timed out waiting for bindings lock' })
    } finally {
      holder.proc.kill()
      await exited
    }
    await writeGrowBinding(root, path.join(root, 'chat'), 'tree')
    expect(await readGrowBinding(root, path.join(root, 'chat'))).toBe('tree')
  }, 15000)
  it('distinguishes missing data from corrupt records and preserves corrupt files', async () => {
    const root = await workspace(), chat = path.join(root, 'chat')
    expect(await readGrowBinding(root, chat)).toBeNull()
    await tree(root, 'tree')
    const file = path.join(root, '.文档', 'grow-me', 'bindings.json')
    for (const content of ['{', '[]', '{"bad":"tree"}', JSON.stringify({ ['a'.repeat(64)]: '../bad' })]) {
      await writeFile(file, content)
      await expect(readGrowBinding(root, chat)).rejects.toMatchObject({ code: 'CORRUPT' })
      await expect(writeGrowBinding(root, chat, 'tree')).rejects.toMatchObject({ code: 'CORRUPT' })
      expect(await readFile(file, 'utf8')).toBe(content)
    }
  })
  it('validates paths, IDs, tree existence and stale bindings', async () => {
    const root = await workspace(), chat = path.join(root, 'chat')
    await tree(root, 'tree')
    await expect(writeGrowBinding(root, 'relative', 'tree')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(writeGrowBinding(root, chat, '../tree')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(writeGrowBinding(root, chat, 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await writeGrowBinding(root, chat, 'tree')
    await rm(path.join(root, '.文档', 'grow-me', 'tree'), { recursive: true })
    await expect(readGrowBinding(root, chat)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it.skipIf(process.platform === 'win32')('rejects symlinked tree directories', async () => {
    const root = await workspace(), outside = await workspace()
    await tree(root, 'real')
    await symlink(outside, path.join(root, '.文档', 'grow-me', 'link'))
    await expect(writeGrowBinding(root, path.join(root, 'chat'), 'link')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })
})
