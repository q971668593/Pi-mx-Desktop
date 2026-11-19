#!/usr/bin/env node
/**
 * 生成 resources/purge/persona.md —— 安装包里内置的那份破甲人设。
 *
 * 默认从 DSH 正在用的 ~/.dsh/prompt-inject.md 取，剥掉 <|im_start|>system: 这类
 * 聊天模板外壳。人设正文故意不进 git（.gitignore），只在打包机本地生成后再打进安装包：
 * 仓库是公开的，安装包才是发给自己的。
 *
 * 用法：
 *   node scripts/purge-persona.mjs                     # 默认源
 *   node scripts/purge-persona.mjs --from C:/x.md      # 指定源
 *   node scripts/purge-persona.mjs --check             # 只检查有没有，不写
 *
 * 源不存在时不报错：安装包少了人设也能装，设置页会提示「导入人设」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const outFile = resolve('resources/purge/persona.md')
const source = resolve(arg('--from', join(homedir(), '.dsh', 'prompt-inject.md')))
const checkOnly = argv.includes('--check')

if (checkOnly) {
  console.log(existsSync(outFile) ? `ok: ${outFile}` : `missing: ${outFile}（打包时人设不会内置）`)
  process.exit(0)
}

if (!existsSync(source)) {
  console.log(`[purge-persona] 跳过：找不到 ${source}`)
  console.log('[purge-persona] 安装包将不含人设，设置页里可用「导入人设」补一份。')
  process.exit(0)
}

const stripShell = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*<\|im_start\|>/.test(line) && line.trim() !== '</project_instructions>')
    .join('\n')
    .trim()

const persona = stripShell(readFileSync(source, 'utf8'))
if (!persona) {
  console.log(`[purge-persona] 跳过：${source} 剥壳后为空`)
  process.exit(0)
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${persona}\n`, 'utf8')
console.log(`[purge-persona] ${outFile}  ←  ${source}  (${persona.length} 字符)`)
