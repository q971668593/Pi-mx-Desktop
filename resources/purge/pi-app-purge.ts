/**
 * pi-app-purge —— Pi mx 内置的系统提示词开关扩展
 *
 * 机制移植自 ZiChuanLan/pi-purge（MIT）与 YuJunZhiXue/dsh-purge：
 * 宿主身份段不是被压住，而是被**清掉**。
 *
 * 与上游唯一的不同：状态不放内存、不靠命令，而是读
 *   <agentDir>/purge/config.json   { enabled, mode, source }
 * 桌面端设置页勾选就写这个文件，扩展每轮请求前 stat 一次，变了就重读 ——
 * 所以开关对「当前会话的下一句话」立刻生效，不用重启、不用敲 /purge。
 *
 * /purge 命令仍然保留，作用和设置页一样（直接改 config.json），方便终端 pi 用。
 */
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

type Mode = 'strict' | 'replace' | 'append'

interface PurgeConfig {
  enabled: boolean
  mode: Mode
  /** 人设文件绝对路径；空 = <agentDir>/purge/persona.md */
  source: string
}

const DEFAULT_CONFIG: PurgeConfig = { enabled: false, mode: 'strict', source: '' }

/** 与 SDK getAgentDir() 一致：PI_CODING_AGENT_DIR 优先，展开 ~，否则 ~/.pi/agent。 */
function agentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR?.trim()
  if (env) {
    if (env === '~') return homedir()
    if (env.startsWith('~/') || env.startsWith('~\\')) return join(homedir(), env.slice(2))
    return env
  }
  return join(homedir(), '.pi', 'agent')
}

function configPath(): string {
  return join(agentDir(), 'purge', 'config.json')
}

function personaPath(config: PurgeConfig): string {
  return config.source?.trim() || join(agentDir(), 'purge', 'persona.md')
}

function readConfig(): { config: PurgeConfig; error: string } {
  const file = configPath()
  try {
    if (!existsSync(file)) return { config: { ...DEFAULT_CONFIG }, error: '' }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<PurgeConfig>
    const mode = raw.mode === 'replace' || raw.mode === 'append' ? raw.mode : 'strict'
    return {
      config: { enabled: raw.enabled === true, mode, source: typeof raw.source === 'string' ? raw.source : '' },
      error: '',
    }
  } catch (error) {
    return { config: { ...DEFAULT_CONFIG }, error: error instanceof Error ? error.message : String(error) }
  }
}

function writeConfig(next: PurgeConfig): void {
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/** `{{cwd}}` 插值：人设里想点名工作目录时用。 */
function interpolate(text: string, cwd: string): string {
  if (!text.includes('{{cwd}}')) return text
  if (!cwd) return text.replace(/[ \t]*\{\{cwd\}\}[ \t]*/g, ' ').replace(/[ \t]+\n/g, '\n')
  return text.split('{{cwd}}').join(cwd)
}

/** pi 给 string，omp 给 string[]；统一成一块文本，避免 Array.toString() 插逗号。 */
function systemText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((block): block is string => typeof block === 'string').join('\n\n')
  return typeof value === 'string' ? value : ''
}

/** pi 默认提示词里的宿主身份句；措辞随版本变过，按「新在前」逐个试，最后走模板兜底。 */
const HOST_IDENTITY_LINES = [
  'You are a coding assistant running inside pi, a coding agent harness.',
  'You are an expert coding assistant operating inside pi, a coding agent harness.',
]
const HOST_IDENTITY_RE = /^You are an? \S[^\n]{0,160}?coding agent harness\./m

/** pi 文档段边界：≥1.5.2 走 <docs> 标签，更早的版本退回固定文案。 */
const HOST_DOCS_TAGS = ['<docs>', '</docs>']
const HOST_DOCS_START = 'Pi documentation (read only when the user asks about '
const HOST_DOCS_ENDS = ['following related cross-references.', '(e.g., tui.md for TUI API details)']

function dropThroughLine(text: string, startAt: number, endMarker: string, from: number): string | null {
  const endAt = text.indexOf(endMarker, from)
  if (endAt === -1) return null
  let start = startAt
  while (start > 0 && text[start - 1] === '\n') start -= 1
  const lineEnd = text.indexOf('\n', endAt + endMarker.length)
  const end = lineEnd === -1 ? text.length : lineEnd + 1
  return text.slice(0, start) + text.slice(end)
}

function stripIdentityLine(text: string): { text: string; found: boolean } {
  let at = -1
  for (const line of HOST_IDENTITY_LINES) {
    at = text.indexOf(line)
    if (at !== -1) break
  }
  if (at === -1) at = HOST_IDENTITY_RE.exec(text)?.index ?? -1
  if (at === -1) return { text, found: false }
  const lineEnd = text.indexOf('\n', at)
  const cutEnd = lineEnd === -1 ? text.length : lineEnd + 1
  return { text: text.slice(0, at) + text.slice(cutEnd), found: true }
}

function stripDocsBlock(text: string): { text: string; found: boolean } {
  const [open, close] = HOST_DOCS_TAGS
  const tagAt = text.indexOf(open)
  if (tagAt !== -1) {
    const cut = dropThroughLine(text, tagAt, close, tagAt + open.length)
    if (cut !== null) return { text: cut, found: true }
  }
  const docsAt = text.indexOf(HOST_DOCS_START)
  if (docsAt !== -1) {
    for (const endMarker of HOST_DOCS_ENDS) {
      const cut = dropThroughLine(text, docsAt, endMarker, docsAt + HOST_DOCS_START.length)
      if (cut !== null) return { text: cut, found: true }
    }
  }
  return { text, found: false }
}

/** 任一锚点匹配不到就原样返回 —— 升级换措辞时退化成 append，不会把提示词切坏。 */
function stripHostPersona(systemPrompt: string): { text: string; identity: boolean; docs: boolean } {
  const identity = stripIdentityLine(systemPrompt)
  const docs = stripDocsBlock(identity.text)
  return { text: docs.text, identity: identity.found, docs: docs.found }
}

/**
 * 变更检测：设置页刚写完立刻读，mtime 可能还是同一个 tick，所以 config.json 直接比内容
 * （几行小文件，读一次不心疼）；人设用 mtime + 字节数判断，避免每轮读 20KB。
 */
let cache = { configRaw: '\u0000', personaKey: '', config: { ...DEFAULT_CONFIG }, persona: '', error: '' }

function statKey(file: string): string {
  try {
    const st = statSync(file)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return ''
  }
}

function readRaw(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

function load(): { config: PurgeConfig; persona: string; error: string } {
  const raw = readRaw(configPath())
  const configChanged = raw !== cache.configRaw
  const parsed = configChanged ? readConfig() : { config: cache.config, error: cache.error }
  const file = personaPath(parsed.config)
  const personaKey = statKey(file)
  const personaChanged = personaKey !== cache.personaKey || configChanged
  let persona = cache.persona
  let error = parsed.error
  if (personaChanged) {
    try {
      persona = existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
      if (!persona) error = error || `人设文件为空或不存在: ${file}`
    } catch (readError) {
      persona = ''
      error = readError instanceof Error ? readError.message : String(readError)
    }
  }
  cache = { configRaw: raw, personaKey, config: parsed.config, persona, error }
  return { config: parsed.config, persona, error }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function piAppPurge(pi: any) {
  const paint = (ctx: { ui?: { setStatus?: (key: string, text?: string) => void } }, enabled: boolean) => {
    try {
      ctx.ui?.setStatus?.('pi-app-purge', enabled ? 'PURGE ON' : undefined)
    } catch {
      /* -p / json 模式没有 footer */
    }
  }

  pi.on('session_start', async (_event: unknown, ctx: { ui?: { setStatus?: (key: string, text?: string) => void } }) => {
    const { config } = load()
    paint(ctx, config.enabled)
  })

  pi.on('before_agent_start', async (event: { systemPrompt?: unknown; systemPromptOptions?: { cwd?: string } }) => {
    const { config, persona } = load()
    if (!config.enabled || !persona) return

    const cwd = String(event.systemPromptOptions?.cwd ?? process.cwd()).replace(/\\/g, '/')
    const composed = interpolate(persona, cwd)
    const hostText = systemText(event.systemPrompt)

    if (config.mode === 'strict') {
      // 工具 schema 走 API 的 tools 参数，不依赖这段文字
      return { systemPrompt: cwd ? `${composed}\n\nCurrent working directory: ${cwd}` : composed }
    }
    if (config.mode === 'replace') {
      const host = stripHostPersona(hostText).text
      return { systemPrompt: host.length > 0 ? `${composed}\n\n${host}` : composed }
    }
    return { systemPrompt: hostText.length > 0 ? `${composed}\n\n${hostText}` : composed }
  })

  // 终端 pi 也能用；写回 config.json，与设置页共用同一份状态
  pi.registerCommand('purge', {
    description: '破甲开关：读/写 <agentDir>/purge/config.json（设置页同源）',
    getArgumentCompletions: (prefix: string) =>
      ['on', 'off', 'status', 'mode', 'source', 'reload'].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
    handler: async (args: string, ctx: { ui?: { notify?: (text: string, level?: string) => void } }) => {
      const notify = (text: string, level: 'info' | 'error' = 'info') => ctx.ui?.notify?.(text, level)
      const { config } = load()
      const parts = String(args ?? '').trim().split(/\s+/).filter(Boolean)
      const cmd = (parts[0] ?? '').toLowerCase()
      const arg = parts.slice(1).join(' ').trim()

      const describe = (c: PurgeConfig) => {
        const loaded = load()
        return [
          `状态: ${c.enabled ? '开启' : '关闭'}（写入 config.json，跨会话保持）`,
          `模式: ${c.mode}`,
          `人设: ${personaPath(c)}${loaded.persona ? `  ${loaded.persona.length} 字符` : '  未加载'}`,
          `配置: ${configPath()}`,
        ].join('\n')
      }

      switch (cmd) {
        case 'on':
        case 'enable': {
          const next = { ...config, enabled: true }
          writeConfig(next)
          load()
          paint(ctx, true)
          return notify(`已开启。\n${describe(next)}`)
        }
        case 'off':
        case 'disable': {
          const next = { ...config, enabled: false }
          writeConfig(next)
          load()
          paint(ctx, false)
          return notify(`已关闭，恢复 pi 原始系统提示词。`)
        }
        case 'mode': {
          const wanted = arg.toLowerCase()
          if (wanted !== 'strict' && wanted !== 'replace' && wanted !== 'append') {
            return notify(`当前模式: ${config.mode}\n用法: /purge mode strict|replace|append`, 'error')
          }
          const next = { ...config, mode: wanted as Mode }
          writeConfig(next)
          load()
          return notify(`模式已切换为 ${wanted}。`)
        }
        case 'source': {
          if (!arg) return notify(`当前人设: ${personaPath(config)}\n用法: /purge source <绝对路径|default>`, 'error')
          const next = { ...config, source: arg.toLowerCase() === 'default' ? '' : arg.replace(/^["']|["']$/g, '') }
          writeConfig(next)
          load()
          return notify(`人设来源已更新。\n${describe(next)}`)
        }
        case 'reload':
          cache = { ...cache, configRaw: '\u0000', personaKey: '' }
          return notify(`已重新读取。\n${describe(load().config)}`)
        case '':
        case 'status':
        default:
          return notify(describe(config))
      }
    },
  })
}
