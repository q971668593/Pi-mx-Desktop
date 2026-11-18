#!/usr/bin/env node
/**
 * IPC 契约生成器（事实源 = 主进程的真实注册点）
 *
 * 背景：同一份通道信息曾存在三处（手写接口 / 手写白名单 / registerHandler 字面量），
 * 靠 scripts/tests/ipc-channel-sync.test.mjs 的正则互检维持。本脚本把「白名单」和
 * 「文档」改成从注册点生成，白名单不再可能漏项，文档不再漂移。
 *
 * 产出：
 *   packages/shared/ipc-channels.generated.ts   （IPC_INVOKE_CHANNELS，preload 白名单来源）
 *   doc/IPC-CONTRACTS.generated.md              （按域分组的通道表 + main→renderer 事件表）
 *
 * 用法：
 *   node scripts/generate-ipc-channels.mjs           # 写入
 *   node scripts/generate-ipc-channels.mjs --check    # 只校验是否漂移（CI / 契约测试用）
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

const root = process.cwd()
const mainDir = join(root, 'src/main')
const outTs = join(root, 'packages/shared/ipc-channels.generated.ts')
const outMd = join(root, 'doc/IPC-CONTRACTS.generated.md')

const REGISTER_CALL = /registerHandler(?:WithSchema)?\s*\(/g
const SEND_CALL = /webContents\.send\s*\(\s*'([^']+)'/g

function walkTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walkTs(path, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

/** @returns {{kind:'invoke'|'register-schema', channel:string, file:string}[]} */
function scanInvokeChannels() {
  const found = []
  for (const file of walkTs(mainDir)) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(root, file).replaceAll('\\', '/')
    // 跳过注册器自身的定义（`export function registerHandler(channel, handler)`）。
    if (text.includes('export function registerHandler')) continue
    for (const match of text.matchAll(REGISTER_CALL)) {
      const at = match.index + match[0].length
      const head = text.slice(at, at + 300)
      const literal = head.match(/^\s*'([^']*)'/)
      if (!literal) {
        found.push({ kind: 'non-literal', channel: head.slice(0, 40).replace(/\s+/g, ' '), file: rel })
        continue
      }
      const kind = match[0].includes('WithSchema') ? 'register-schema' : 'invoke'
      found.push({ kind, channel: literal[1], file: rel })
    }
  }
  return found
}

/** @returns {{channel:string, file:string}[]} */
function scanEventChannels() {
  const found = []
  for (const file of walkTs(mainDir)) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(root, file).replaceAll('\\', '/')
    if (text.includes('export function registerHandler')) continue
    for (const match of text.matchAll(SEND_CALL)) {
      found.push({ channel: match[1], file: rel })
    }
  }
  return found
}

/**
 * 通道名不是字面量的发送点（`win.webContents.send(channel, …)`）。
 *
 * 这类通道**收不进**白名单/文档，但它们是合法的（包装器把通道名作参数传进来）。
 * 登记到文档里是为了让「事件通道 12 个」不被误读成全集，也方便 review 时一眼看到漏在哪。
 */
function scanDynamicEventSends() {
  const found = []
  for (const file of walkTs(mainDir)) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(root, file).replaceAll('\\', '/')
    if (text.includes('export function registerHandler')) continue
    for (const match of text.matchAll(/webContents\.send\s*\(\s*([^),\s]+)/g)) {
      const name = match[1]
      if (name.startsWith("'") || name.startsWith('"') || name.startsWith('`')) continue
      found.push({ channel: name, file: rel })
    }
  }
  return found
}

/** 通道域名：`ipc:dialog:openFiles` → dialog；`ipc:gitBoard.stage` → gitBoard */
function domainOf(channel) {
  const rest = channel.startsWith('ipc:') ? channel.slice(4) : channel
  const sep = rest.search(/[.:]/)
  return sep === -1 ? rest : rest.slice(0, sep)
}

const invoke = scanInvokeChannels()
const nonLiteral = invoke.filter((entry) => entry.kind !== 'invoke' && entry.kind !== 'register-schema')
const literal = invoke.filter((entry) => entry.kind === 'invoke' || entry.kind === 'register-schema')

const byChannel = new Map()
for (const entry of literal) {
  if (!byChannel.has(entry.channel)) byChannel.set(entry.channel, { channel: entry.channel, kind: entry.kind, files: new Set() })
  const row = byChannel.get(entry.channel)
  row.files.add(entry.file)
  if (entry.kind === 'register-schema') row.kind = 'register-schema'
}
const channels = [...byChannel.values()].sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0))

const events = new Map()
for (const entry of scanEventChannels()) {
  if (!events.has(entry.channel)) events.set(entry.channel, { channel: entry.channel, files: new Set() })
  events.get(entry.channel).files.add(entry.file)
}
const eventRows = [...events.values()].sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0))
const dynamicEventRows = scanDynamicEventSends().sort((a, b) =>
  a.file === b.file ? (a.channel < b.channel ? -1 : 1) : a.file < b.file ? -1 : 1,
)

// ── 生成 TS 白名单 ──
const ts = [
  '// AUTO-GENERATED FILE — 请勿手改。',
  '// 事实源：src/main/**/*.ts 里的 registerHandler / registerHandlerWithSchema 调用。',
  '// 重新生成：npm run gen:ipc   漂移检查：npm run test:scripts',
  '',
  'export const IPC_INVOKE_CHANNELS = [',
  ...channels.map((row) => `  '${row.channel}',`),
  '] as const',
  '',
].join('\n')

// ── 生成文档 ──
const byDomain = new Map()
for (const row of channels) {
  const domain = domainOf(row.channel)
  if (!byDomain.has(domain)) byDomain.set(domain, [])
  byDomain.get(domain).push(row)
}
const domains = [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))

const md = []
md.push('# IPC 契约（自动生成）')
md.push('')
md.push('> 本文件由 `scripts/generate-ipc-channels.mjs` 生成，**请勿手改**。运行 `npm run gen:ipc` 更新。')
md.push('> 事实源：`src/main/**/*.ts` 中的 `registerHandler` / `registerHandlerWithSchema` 调用。')
md.push('> 手写文档在 `doc/IPC-CONTRACTS.md`；本文件保证「代码里注册了什么」与「文档里写了什么」不会漂移。')
md.push('')
md.push(`- invoke 通道：**${channels.length}** 个（唯一）`)
md.push(`- main → renderer 事件通道：**${eventRows.length}** 个（唯一）`)
md.push(`- 非字面量注册：**${nonLiteral.length}** 处${nonLiteral.length === 0 ? '' : '（白名单会漏项，是硬性失败）'}`)
md.push(`- 动态事件通道（通道名非常量，未收录）：**${dynamicEventRows.length}** 处`)
md.push('')
md.push('> 事件表只收录字面量发送。`webContents.send(channel, …)` 这类包装器的通道名在运行时才确定，')
md.push('> 因此**不能**把下面的数字当成「主进程一共只发这么多事件」；新增包装器请同步登记到 `doc/IPC-CONTRACTS.md`。')
md.push('')
md.push('## 通道数量（按域）')
md.push('')
md.push('| 域 | 通道数 |')
md.push('| --- | ---: |')
for (const [domain, rows] of domains) md.push(`| \`${domain}\` | ${rows.length} |`)
md.push('')
md.push('## invoke 通道明细')
for (const [domain, rows] of domains) {
  md.push('')
  md.push(`### ${domain}（${rows.length}）`)
  md.push('')
  md.push('| 通道 | 注册方式 | 注册位置 |')
  md.push('| --- | --- | --- |')
  for (const row of rows) {
    const kind = row.kind === 'register-schema' ? 'registerHandlerWithSchema' : 'registerHandler'
    const files = [...row.files].sort().map((file) => `\`${file}\``).join('<br>')
    md.push(`| \`${row.channel}\` | ${kind} | ${files} |`)
  }
}
md.push('')
md.push('## main → renderer 事件通道')
md.push('')
if (eventRows.length === 0) md.push('（无）')
else {
  md.push('| 通道 | 发送位置 |')
  md.push('| --- | --- |')
  for (const row of eventRows) {
    md.push(`| \`${row.channel}\` | ${[...row.files].sort().map((file) => `\`${file}\``).join('<br>')} |`)
  }
}
if (nonLiteral.length > 0) {
  md.push('')
  md.push('## 非字面量注册（未收录，必须改为字面量）')
  md.push('')
  for (const row of nonLiteral) md.push(`- \`${row.file}\`：\`${row.channel}\``)
}
if (dynamicEventRows.length > 0) {
  md.push('')
  md.push('## 动态事件通道（未收录，仅登记位置）')
  md.push('')
  for (const row of dynamicEventRows) md.push(`- \`${row.file}\`：\`${row.channel}\``)
}
md.push('')

const mdText = md.join('\n')

function readOrEmpty(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const currentTs = readOrEmpty(outTs)
const currentMd = readOrEmpty(outMd)

if (process.argv.includes('--check')) {
  const problems = []
  if (currentTs !== ts) problems.push('packages/shared/ipc-channels.generated.ts')
  if (currentMd !== mdText) problems.push('doc/IPC-CONTRACTS.generated.md')
  if (problems.length > 0) {
    console.error('[gen:ipc] 生成物已漂移，请运行 `npm run gen:ipc` 后提交：')
    for (const problem of problems) console.error(`  - ${problem}`)
    const known = new Set(channels.map((row) => row.channel))
    if (currentTs) {
      const previous = [...currentTs.matchAll(/'([^']+)'/g)].map((m) => m[1])
      const added = [...known].filter((ch) => !previous.includes(ch))
      const removed = previous.filter((ch) => !known.has(ch))
      if (added.length > 0) console.error(`  新增（代码里有、白名单里没有）：${added.join(', ')}`)
      if (removed.length > 0) console.error(`  移除（白名单里有、代码里已无）：${removed.join(', ')}`)
    }
    process.exit(1)
  }
  // 通道名不是字面量 → 生成器看不到它 → 白名单漏项 → preload 运行时拒掉该通道。
  // 以前只是「文档里提一句」，于是一个手滑就能把门禁变成无意义。现在硬失败。
  if (nonLiteral.length > 0) {
    console.error('[gen:ipc] registerHandler 的通道名必须是字面量（否则白名单会漏项）：')
    for (const row of nonLiteral) console.error(`  - ${row.file}: ${row.channel}`)
    process.exit(1)
  }
  console.log(`[gen:ipc] 无漂移（${channels.length} 个 invoke 通道 / ${eventRows.length} 个事件通道 / ${dynamicEventRows.length} 个动态事件通道未收录）`)
  process.exit(0)
}

if (currentTs === ts && currentMd === mdText) {
  if (nonLiteral.length > 0) {
    console.error('[gen:ipc] registerHandler 的通道名必须是字面量（否则白名单会漏项）：')
    for (const row of nonLiteral) console.error(`  - ${row.file}: ${row.channel}`)
    process.exit(1)
  }
  console.log(`[gen:ipc] 已是最新（${channels.length} 个 invoke 通道 / ${eventRows.length} 个事件通道）`)
  process.exit(0)
}

mkdirSync(dirname(outTs), { recursive: true })
mkdirSync(dirname(outMd), { recursive: true })
if (currentTs !== ts) writeFileSync(outTs, ts, 'utf8')
if (currentMd !== mdText) writeFileSync(outMd, mdText, 'utf8')

if (nonLiteral.length > 0) {
  console.error(`[gen:ipc] 有 ${nonLiteral.length} 处非字面量注册未被收录（白名单会漏项，必须改成字面量）：`)
  for (const row of nonLiteral) console.error(`  - ${row.file}: ${row.channel}`)
  process.exit(1)
}
console.log(
  `[gen:ipc] 已生成 ${channels.length} 个 invoke 通道、${eventRows.length} 个事件通道 → ${relative(root, outTs).replaceAll('\\', '/')}, ${relative(root, outMd).replaceAll('\\', '/')}`,
)
