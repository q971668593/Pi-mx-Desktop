// 用 pi 自己的扩展加载器（不是手搓 mock）确认 ~/.pi/agent/extensions 里的 pi-purge 能装上。
//   node purge/probe-loader.mjs
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

const pkgIndex = join(process.cwd(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
const agentDir = process.env.PI_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent')
const { discoverAndLoadExtensions } = await import(pathToFileURL(pkgIndex).href)

const result = await discoverAndLoadExtensions([], process.cwd(), agentDir)
const purge = result.extensions.filter((e) => /pi-purge/i.test(e.path))
const commands = purge.flatMap((e) => [...e.commands.keys()])

console.log(`agent 目录: ${agentDir}`)
console.log(`加载到的扩展: ${result.extensions.map((e) => e.path).join('\n  ') || '(none)'}`)
console.log(`报错: ${result.errors?.length ? JSON.stringify(result.errors, null, 2) : '无'}`)
console.log(`pi-purge: ${purge.length ? '已加载' : '未加载'}${commands.length ? `，命令 ${commands.map((c) => '/' + c).join(' ')}` : ''}`)
process.exit(purge.length > 0 && commands.includes('purge') ? 0 : 1)
