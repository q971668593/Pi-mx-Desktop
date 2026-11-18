import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function walkTsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walkTsFiles(p, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** 白名单本体来自生成文件（事实源 = src/main 的 registerHandler 注册点）。 */
function extractAllowlist() {
  const src = readFileSync(join(root, 'packages/shared/ipc-channels.generated.ts'), 'utf8')
  const m = src.match(/export const IPC_INVOKE_CHANNELS = \[([\s\S]*?)\] as const/)
  assert.ok(m, 'packages/shared/ipc-channels.generated.ts 应包含 IPC_INVOKE_CHANNELS 数组')
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function extractRegistered() {
  const dirs = [join(root, 'src/main'), join(root, 'src/main/ipc')]
  const files = []
  for (const d of dirs) {
    try {
      walkTsFiles(d, files)
    } catch {
      /* skip */
    }
  }
  const uniq = new Set()
  const reHandler = /registerHandler(?:WithSchema)?\(\s*'(ipc:[^']+)'/g
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (text.includes('export function registerHandler')) continue
    let match
    while ((match = reHandler.exec(text)) !== null) uniq.add(match[1])
  }
  return [...uniq].sort()
}

describe('IPC channel sync', () => {
  it('allowlist shell does not hardcode channel strings', () => {
    const shell = readFileSync(join(root, 'packages/shared/ipc-channels.ts'), 'utf8')
    assert.equal(
      /'ipc:/.test(shell),
      false,
      'ipc-channels.ts 不允许手写通道字符串；请在 src/main 注册并通过 `npm run gen:ipc` 生成',
    )
    assert.match(shell, /from '\.\/ipc-channels\.generated'/)
    assert.match(shell, /isAllowedIpcChannel/)
  })

  it('every allowlisted channel is registered in main', () => {
    const allow = extractAllowlist()
    const reg = new Set(extractRegistered())
    const missing = allow.filter((ch) => !reg.has(ch))
    assert.deepEqual(missing, [], `channels in allowlist but not registerHandler: ${missing.join(', ')}`)
  })

  it('every registerHandler channel is in allowlist', () => {
    const allow = new Set(extractAllowlist())
    const reg = extractRegistered()
    const extra = reg.filter((ch) => !allow.has(ch))
    assert.deepEqual(extra, [], `registerHandler without allowlist entry: ${extra.join(', ')}`)
  })

  it('allowlist has no duplicates', () => {
    const allow = extractAllowlist()
    const dupes = allow.filter((ch, index) => allow.indexOf(ch) !== index)
    assert.deepEqual(dupes, [], `duplicate channels in allowlist: ${dupes.join(', ')}`)
  })
})
