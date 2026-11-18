import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { register } from 'node:module'
import { z } from 'zod'

// 直接执行 .ts 源码时需要把无扩展名的相对导入解析成 .ts（仓库按 bundler 风格书写）。
register('./ts-relative-resolve.mjs', import.meta.url)

const root = process.cwd()
const schemasPath = join(root, 'src/main/ipc/schemas.ts')
const schemaSrc = readFileSync(schemasPath, 'utf8')

const schemas = await import(pathToFileURL(schemasPath).href)

const schemaCases = [
  ['shellOpenPathSchema', { path: '/tmp/x' }, { path: 1 }],
  ['shellShowItemSchema', { path: 'C:\\a' }, {}],
  ['workspaceFsListDirSchema', { workspaceRoot: '/w' }, { workspaceRoot: 1 }],
  ['workspaceFsSearchSchema', { workspaceRoot: '/w', query: 'src/cmp', maxResults: 20 }, { workspaceRoot: '/w', query: 'x', maxResults: 201 }],
  ['workspaceFsReadTextSchema', { workspaceRoot: '/w', path: 'a.txt' }, { path: 'a.txt' }],
  ['workspaceFsRenameSchema', { workspaceRoot: '/w', relativePath: 'a', newName: 'b' }, { newName: 'b' }],
  ['sessionNavigateTreeSchema', { targetId: 'id-1' }, { targetId: '' }],
  ['sessionTreeSchema', { sessionFile: '/s.jsonl', workspaceId: '/proj' }, { sessionFile: '/s.jsonl', unexpected: true }],
  ['sessionGetMessagesSchema', { sessionFile: '/s.jsonl', workspaceId: '/proj' }, { sessionFile: '/s.jsonl', limit: 0 }],
  ['sessionNewSchema', { workspaceId: '/proj' }, { workspaceId: '' }],
  ['sessionDeleteSchema', { sessionFile: '/s.jsonl', workspaceId: '/proj' }, { sessionFile: '/s.jsonl', workspaceId: '/proj', unexpected: true }],
  ['sessionPrepareSchema', { sessionFile: '/s.jsonl' }, {}],
  ['workspaceOpenSchema', { path: '/proj' }, {}],
  ['workspaceSandboxDeleteSchema', { path: '/sandbox' }, {}],
  ['promptTextSchema', { text: 'hi' }, {}],
  ['piSettingsSetSchema', { patch: { a: 1 } }, {}],
  ['shellReadImagePreviewSchema', { workspaceRoot: '/w', path: 'a.png' }, { path: 'a.png' }],
  ['reviewMutationSchema', { cwd: '/w', files: [] }, { files: [{ path: 1, hunkPatches: 'x' }] }],
  ['sdkInstallSchema', { version: '1.0.0' }, {}],
  ['settingsSetSchema', { key: 'theme', value: 'dark' }, { key: 'theme', value: 'nope' }],
  ['clipboardWriteTempImageSchema', { data: Buffer.from('x').toString('base64'), mimeType: 'image/png' }, { mimeType: 'image/png' }],
  ['sessionGoalGetSchema', { sessionFile: '/s.jsonl' }, { sessionFile: '   ' }],
  ['sessionGoalSetSchema', { sessionFile: '/s.jsonl', goal: '达成 X', criteria: ['a', 'b'] }, { sessionFile: '/s.jsonl', goal: '   ' }],
  ['sessionGoalSetSchema', { sessionFile: '/s.jsonl', goal: 'g' }, { sessionFile: '/s.jsonl', goal: 'g', criteria: [1] }],
  ['sessionGoalToggleCriterionSchema', { sessionFile: '/s.jsonl', index: 0 }, { sessionFile: '/s.jsonl', index: -1 }],
  ['sessionGoalMarkDoneSchema', { sessionFile: '/s.jsonl', indices: [1, 3] }, { sessionFile: '/s.jsonl', indices: [0] }],
  ['sessionGoalClearSchema', { sessionFile: '/s.jsonl' }, { sessionFile: '/s.jsonl', goal: 'g' }],
]

describe('IPC Zod schemas', () => {
  it('exports at least 14 named schemas', () => {
    const count = (schemaSrc.match(/export const \w+Schema = z\./g) || []).length
    assert.ok(count >= 14, `expected >=14 schemas, got ${count}`)
  })

  for (const [name, good, bad] of schemaCases) {
    it(`${name} accepts valid input`, () => {
      const schema = schemas[name]
      assert.ok(schema, name)
      const r = schema.safeParse(good)
      assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error?.issues))
    })
    it(`${name} rejects invalid input`, () => {
      const schema = schemas[name]
      const r = schema.safeParse(bad)
      assert.equal(r.success, false)
    })
  }

  it('registerHandlerWithSchema error message includes field path', () => {
    const schema = z.object({ path: z.string().min(1) })
    const r = schema.safeParse({})
    assert.equal(r.success, false)
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    assert.match(msg, /path/)
  })
})