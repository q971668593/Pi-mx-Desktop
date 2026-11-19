// 把 purge/pi-purge.ts 装进 pi（pi-desktop / 终端 pi 共用同一套 agent 目录）。
//
//   node purge/install.mjs                # 全局：~/.pi/agent/extensions/pi-purge.ts + 人设 ~/.pi/agent/purge/persona.md
//   node purge/install.mjs --project      # 只当前项目：<cwd>/.pi/extensions/pi-purge.ts
//   node purge/install.mjs --uninstall    # 卸掉扩展与人设，恢复到没装过的状态
//   node purge/install.mjs --persona C:/x/my.md
//
// 只写两个位置：agent 目录的 extensions/ 与 purge/。不碰 pi-app 源码，不碰 node_modules。
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

const repoRoot = resolve(import.meta.dirname, '..')
const sourceExt = join(import.meta.dirname, 'pi-purge.ts')
const agentDir = process.env.PI_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent')
const projectMode = has('--project')
const targetDir = projectMode ? join(process.cwd(), '.pi', 'extensions') : join(agentDir, 'extensions')
const targetExt = join(targetDir, 'pi-purge.ts')
const personaDir = join(agentDir, 'purge')
const personaPath = join(personaDir, 'persona.md')
const sourcePersona = resolve(arg('--persona', join(homedir(), '.dsh', 'prompt-inject.md')))

if (!existsSync(sourceExt)) {
  console.error(`仓库里缺少 ${sourceExt}`)
  process.exit(1)
}

if (has('--uninstall')) {
  for (const target of [targetExt, personaPath]) {
    if (existsSync(target)) {
      rmSync(target, { force: true })
      console.log(`已删除 ${target}`)
    } else {
      console.log(`本来就没有 ${target}`)
    }
  }
  console.log('\n重启 pi-app（或新开一个会话）后生效。')
  process.exit(0)
}

mkdirSync(targetDir, { recursive: true })
copyFileSync(sourceExt, targetExt)
console.log(`扩展 → ${targetExt}`)

// 人设：从 dsh-purge 的注入文件里取，去掉 <|im_start|>system: 这类聊天模板外壳
if (existsSync(sourcePersona)) {
  const raw = readFileSync(sourcePersona, 'utf8').replace(/\r\n/g, '\n')
  const persona = raw
    .split('\n')
    .filter((line) => !/^<\|im_start\|>/.test(line.trim()) && line.trim() !== '</project_instructions>')
    .join('\n')
    .trim()
  mkdirSync(personaDir, { recursive: true })
  writeFileSync(personaPath, `${persona}\n`, 'utf8')
  console.log(`人设 → ${personaPath}（${persona.length} 字符，源 ${sourcePersona}）`)
} else {
  console.log(`跳过人设：找不到 ${sourcePersona}。用 /purge source <你的文件> 指定，或加 --persona <路径>。`)
}

console.log(`
下一步：
  1. 重启 pi-app（或新开会话）——扩展只在启动时扫描。
  2. 会话里输入：
       /purge source ${existsSync(personaPath) ? personaPath : '<你的提示词文件>'}
       /purge on
     想更彻底：/purge mode strict（默认就是 strict）
  3. /purge status 看当前状态；/purge off 随时关掉。
  4. 先自检：node purge/verify.mjs

状态只活在当前会话，退出即恢复，不落盘、不改 pi 源码。`)
