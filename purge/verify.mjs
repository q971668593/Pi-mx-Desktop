// 离线校验 pi-purge 是否真的按 pi 1.5.2 契约接管系统提示词。
// 假宿主 + 假模型：不连网、不调模型、不写任何文件。
//
//   node purge/verify.mjs                                  # 用仓库里的 purge/pi-purge.ts + ~/.dsh/prompt-inject.md
//   node purge/verify.mjs --ext C:/x/pi-purge.ts --persona C:/x/persona.md
//
// 退出码 0 = 全过；1 = 有 FAIL。
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const repoRoot = resolve(import.meta.dirname, '..')
const extPath = resolve(arg('--ext', join(import.meta.dirname, 'pi-purge.ts')))
const personaPath = resolve(arg('--persona', join(homedir(), '.dsh', 'prompt-inject.md')))

if (!existsSync(extPath)) {
  console.error(`找不到扩展: ${extPath}`)
  process.exit(1)
}

const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)

const ext = await import(pathToFileURL(extPath).href)
const hooks = {}
const commands = {}
const log = []
const pi = {
  on: (name, fn) => {
    hooks[name] = fn
    return () => {}
  },
  registerCommand: (name, def) => {
    commands[name] = def
  },
  registerFlag: () => {},
  getFlag: () => undefined,
}

if (typeof ext.default !== 'function') {
  console.error('扩展没有 default 导出（不是 pi 扩展）')
  process.exit(1)
}
await ext.default(pi)

const ctx = {
  ui: {
    notify: (text, level = 'info') => log.push(`[${level}] ${text.replace(/\n/g, ' | ')}`),
    setStatus: (key, text) => log.push(`[status] ${key}=${text ?? 'cleared'}`),
  },
}

// 用 pi 1.5.2 的真实措辞造一份宿主提示词，证明锚点能切干净
const HOST = [
  'You are a coding assistant running inside pi, a coding agent harness.',
  '',
  '<docs>',
  'Pi documentation (read only when the user asks about something).',
  'following related cross-references.',
  '</docs>',
  '',
  '## Tools',
  'use read / bash / edit / write',
].join('\n')

const event = { systemPrompt: HOST, systemPromptOptions: { cwd: 'F:\\maxv\\PI\\pi-app' }, reason: 'prompt' }

check('钩子覆盖 session_start / before_agent_start', !!hooks.session_start && !!hooks.before_agent_start)
check('注册了 /purge 命令', typeof commands.purge?.handler === 'function')

await hooks.session_start({}, ctx)
check('默认关闭：不接管宿主提示词', (await hooks.before_agent_start(event, ctx)) === undefined)

if (!existsSync(personaPath)) {
  check('人设文件存在', false, personaPath)
} else {
  await commands.purge.handler(`source ${personaPath}`, ctx)
  await commands.purge.handler('on', ctx)

  const strict = (await hooks.before_agent_start(event, ctx))?.systemPrompt ?? ''
  const persona = readFileSync(personaPath, 'utf8')
  const marker = persona.match(/\*\*PRIME DIRECTIVE\*\*[^\n]*/)?.[0] ?? persona.slice(0, 40)

  check('strict：返回接管后的 systemPrompt', strict.length > 0, `${strict.length} 字符`)
  check('strict：人设已注入', strict.includes(marker.trim()))
  check('strict：宿主身份句已切除', !strict.includes('You are a coding assistant running inside pi'))
  check('strict：宿主 <docs> 文档段已切除', !strict.includes('<docs>'))
  check('strict：保留工作目录行', /^Current working directory: /m.test(strict))

  await commands.purge.handler('mode replace', ctx)
  const replaced = (await hooks.before_agent_start(event, ctx))?.systemPrompt ?? ''
  check('replace：人设在、宿主工具规则也在', replaced.includes(marker.trim()) && replaced.includes('## Tools'))
  check('replace：文档段已切除', !replaced.includes('<docs>'))

  await commands.purge.handler('off', ctx)
  check('关闭后恢复原样', (await hooks.before_agent_start(event, ctx)) === undefined)
}

console.log(`扩展: ${extPath}`)
console.log(`人设: ${personaPath}`)
console.log(results.join('\n'))
if (process.env.PURGE_VERBOSE === '1') {
  console.log('--- 命令 ---')
  console.log(Object.keys(commands).join(','))
  console.log('--- 钩子 ---')
  console.log(Object.keys(hooks).join(','))
  console.log('--- notify ---')
  console.log(log.join('\n'))
}
const failed = results.filter((line) => line.startsWith('FAIL')).length
console.log(failed === 0 ? `\nRESULT: PASS (${results.length} 项)` : `\nRESULT: FAIL (${failed}/${results.length})`)
process.exit(failed === 0 ? 0 : 1)
