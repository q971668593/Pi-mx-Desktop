import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { GrowPendingBindings } from './grow-pending-bindings'
import { readGrowBinding, writeGrowBinding } from './grow-bindings'

const roots: string[] = []
async function workspace() { const root = await mkdtemp(path.join(tmpdir(), 'grow-pending-')); roots.push(root); return root }
const tree = (revision = 0) => ({ session_id: 'tree1', revision, nodes: [{ id: 'question' }] })
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('pending grow bindings', () => {
  it('restores separate drafts and their later registered chat identities', async () => {
    const root = await workspace(), store = new GrowPendingBindings(root)
    const a = await store.create(tree()), b = await store.create(tree())
    expect(a.draftId).not.toBe(b.draftId)
    const chat = path.join(root, 'chat.jsonl')
    await store.registerChat(a.draftId, chat, 'chat-1')
    await store.updateTree(a.draftId, 0, tree(1))
    const refreshed = new GrowPendingBindings(root)
    expect(await refreshed.read(a.draftId)).toMatchObject({ tree: tree(1), sessionFile: chat, sessionId: 'chat-1' })
    expect(await refreshed.read(b.draftId)).toMatchObject({ tree: tree(), sessionFile: null, sessionId: null })
    expect(await refreshed.registerChat(a.draftId, chat, 'chat-1')).toMatchObject({ draftId: a.draftId })
    await expect(refreshed.registerChat(a.draftId, chat, 'other')).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it('keeps incomplete sessions and existing bindings unchanged', async () => {
    const root = await workspace(), store = new GrowPendingBindings(root), chat = path.join(root, 'chat.jsonl')
    await mkdir(path.join(root, '.文档', 'grow-me', 'existing'), { recursive: true })
    await writeGrowBinding(root, chat, 'existing')
    const draft = await store.create(tree())
    for (const contents of ['', '{"type":"session"}\n', '{"type":"session"}\n{"type":"message"']) {
      await writeFile(chat, contents)
      await store.registerChat(draft.draftId, chat, 'chat-1')
      expect(await readGrowBinding(root, chat)).toBe('existing')
      expect(await store.read(draft.draftId)).toMatchObject({ tree: tree() })
    }
  })
  it('serializes simultaneous revision updates', async () => {
    const root = await workspace(), store = new GrowPendingBindings(root), draft = await store.create(tree())
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => store.updateTree(draft.draftId, 0, tree(1))))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(7)
    expect(await store.read(draft.draftId)).toMatchObject({ tree: tree(1) })
  })
  it('serializes draft updates across processes using the project lock', async () => {
    const root = await workspace(), store = new GrowPendingBindings(root), draft = await store.create(tree())
    const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
    const transaction = await readFile(path.join(process.cwd(), 'src/main/grow-project-transaction.ts'), 'utf8')
    const source = await readFile(path.join(process.cwd(), 'src/main/grow-pending-bindings.ts'), 'utf8')
    const bindings = await readFile(path.join(process.cwd(), 'src/main/grow-bindings.ts'), 'utf8')
    await writeFile(path.join(root, 'transaction.mjs'), ts.transpileModule(transaction, options).outputText)
    await writeFile(path.join(root, 'bindings.mjs'), ts.transpileModule(bindings, options).outputText.replace('./grow-project-transaction', './transaction.mjs'))
    await writeFile(path.join(root, 'pending.mjs'), ts.transpileModule(source, options).outputText.replace('./grow-project-transaction', './transaction.mjs').replace('./grow-bindings', './bindings.mjs'))
    const url = pathToFileURL(path.join(root, 'pending.mjs')).href
    const script = `const { GrowPendingBindings } = await import(process.argv[1]); const s = new GrowPendingBindings(process.argv[2]); try { await s.updateTree(process.argv[3], 0, { session_id: 'tree1', revision: 1, nodes: [] }); } catch (e) { if (e.code !== 'CONFLICT') throw e; }`
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, url, root, draft.draftId], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk.toString() })
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)))
    })
    await Promise.all(Array.from({ length: 4 }, run))
    expect((await store.read(draft.draftId))?.tree.revision).toBe(1)
  }, 30000)
})
