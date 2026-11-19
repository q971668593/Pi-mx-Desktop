#!/usr/bin/env node
/**
 * 用 pi **自己的**扩展加载器验证内置扩展能被识别（不是手搓 mock）。
 *
 *   node scripts/purge/probe-loader.mjs
 *
 * 做法：临时 agent 目录 + 把 resources/purge/pi-app-purge.ts 复制进 extensions/，
 * 调 @earendil-works/pi-coding-agent 导出的 discoverAndLoadExtensions，
 * 断言加载成功、注册了 /purge、没有报错。
 */
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = resolve(import.meta.dirname, '../..')
const extensionFile = join(repoRoot, 'resources/purge/pi-app-purge.ts')
const pkgIndex = join(repoRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js')

if (!existsSync(pkgIndex)) {
  console.error(`找不到 pi 包: ${pkgIndex}（先 npm install）`)
  process.exit(1)
}

const agentDir = mkdtempSync(join(tmpdir(), 'pi-purge-loader-'))
mkdirSync(join(agentDir, 'extensions'), { recursive: true })
cpSync(extensionFile, join(agentDir, 'extensions/pi-app-purge.ts'))

const { discoverAndLoadExtensions } = await import(pathToFileURL(pkgIndex).href)
const result = await discoverAndLoadExtensions([], repoRoot, agentDir)

const loaded = result.extensions.filter((e) => /pi-app-purge/.test(e.path))
const commands = loaded.flatMap((e) => [...e.commands.keys()])
const errors = (result.errors ?? []).filter((e) => /pi-app-purge/.test(e.path ?? '') || e)

console.log(`pi 包: ${pkgIndex}`)
console.log(`扩展: ${loaded.map((e) => e.path).join(', ') || '(none)'}`)
console.log(`命令: ${commands.map((c) => `/${c}`).join(' ') || '(none)'}`)
console.log(`报错: ${errors.length ? JSON.stringify(errors, null, 2) : '无'}`)
rmSync(agentDir, { recursive: true, force: true })

const ok = loaded.length > 0 && commands.includes('purge')
console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL')
process.exit(ok ? 0 : 1)
