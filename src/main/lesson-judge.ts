import { app } from 'electron'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { resolveActiveAgentDir } from './agent-dir'
import { readPiAgentGlobalSettingsFromDisk } from './pi-agent-settings-read'
import { resolveActiveSdkRoot } from './sdk-loader'

/**
 * 一次性的模型调用（不进会话、不加载工具、不落盘）。
 *
 * 用的就是应用内置的那套 SDK：`--print --no-session --no-tools`，问完即退。
 * 教训档案的「值不值得留」判断和「总结成规则」都走这里，
 * 所以既不会打断当前对话，也不会往用户的会话文件里塞东西。
 */
function sdkCliPath(): { cli: string | null; error?: string } {
  try {
    const root = resolveActiveSdkRoot(app.getPath('userData'))
    if (!root) return { cli: null, error: 'sdk_root_missing' }
    const candidates = [join(root, 'dist', 'bundle', 'cli.js'), join(root, 'dist', 'cli.js')]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return { cli: candidate }
    }
    // 报错里带上找过的路径，否则日志里只看到 sdk_cli_missing 无从下手。
    return { cli: null, error: `sdk_cli_missing:${candidates.join('|')}` }
  } catch (error) {
    return { cli: null, error: `sdk_cli_missing:${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 并发闸门：判断/总结都只该是「顺手的一次调用」，不能把内置模型打满。
 * 超过上限直接返回 busy，调用方会把它当成软失败（条目留在待确认里）。
 */
const MAX_CONCURRENT_ONE_SHOTS = 2
let inFlightOneShots = 0

/** WSL 模式下 agent 目录是 UNC 形式（//wsl.localhost/...），spawn 同进程可执行文件必失败。 */
function isWslAgentDir(dir: string): boolean {
  return /^(\\\\|\/\/)wsl/i.test(dir) || /^\/mnt\/[a-z]\//i.test(dir)
}

/** 没指定模型时用 agent 设置里的默认模型。 */
export function defaultOneShotModel(): string | undefined {
  try {
    const settings = readPiAgentGlobalSettingsFromDisk()
    const provider = typeof settings?.defaultProvider === 'string' ? settings.defaultProvider : ''
    const model = typeof settings?.defaultModel === 'string' ? settings.defaultModel : ''
    if (!provider || !model) return undefined
    return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`
  } catch {
    return undefined
  }
}

export function runOneShotModel(input: {
  systemPrompt: string
  prompt: string
  model?: string
  timeoutMs?: number
}): Promise<{ ok: boolean; text: string; model?: string; error?: string }> {
  const resolved = sdkCliPath()
  const cli = resolved.cli
  const model = input.model?.trim() || defaultOneShotModel()
  if (!cli) return Promise.resolve({ ok: false, text: '', error: resolved.error || 'sdk_cli_missing' })
  if (!model) return Promise.resolve({ ok: false, text: '', error: 'no_model' })
  const agentDir = resolveActiveAgentDir()
  if (isWslAgentDir(agentDir)) {
    // 宁可明说「不支持」也不要每次静默等 60s 超时。
    return Promise.resolve({ ok: false, text: '', error: 'wsl_unsupported' })
  }
  if (inFlightOneShots >= MAX_CONCURRENT_ONE_SHOTS) {
    return Promise.resolve({ ok: false, text: '', error: 'busy' })
  }
  inFlightOneShots += 1
  const args = [
    cli,
    '--print',
    '--no-session',
    '--no-tools',
    '--no-extensions',
    '--no-mcp',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--model',
    model,
    '--system-prompt',
    input.systemPrompt,
    input.prompt,
  ]
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.execPath, args, {
        cwd: agentDir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PI_CODING_AGENT_DIR: agentDir, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      // spawn 同步抛（cwd 非法、stdio 失败等）：Promise 执行器抛异常会变成 reject，
      // 调用方按 resolve 写的会直接上抛。显式收敛成软失败，并把计数器还回去，
      // 否则攒两次就永久 busy。
      inFlightOneShots = Math.max(0, inFlightOneShots - 1)
      resolve({ ok: false, text: '', error: error instanceof Error ? error.message : String(error) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: { ok: boolean; text: string; error?: string }) => {
      if (settled) return
      settled = true
      inFlightOneShots = Math.max(0, inFlightOneShots - 1)
      clearTimeout(timer)
      try { child.kill() } catch { /* already gone */ }
      resolve({ ...result, model })
    }
    const timer = setTimeout(() => finish({ ok: false, text: stdout, error: 'timeout' }), input.timeoutMs ?? 60_000)
    // stdio 失败时 stdout/stderr 可能为 null：直接收敛成软失败，别抛 TypeError 让计数器泄漏。
    if (!child.stdout || !child.stderr) {
      finish({ ok: false, text: '', error: 'stdio_unavailable' })
      return
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', (error) => finish({ ok: false, text: '', error: error.message }))
    child.once('close', (code) => {
      if (code === 0 && stdout.trim()) finish({ ok: true, text: stdout.trim() })
      else {
        // 非 0 退出时把 argv 里的关键信息和 agentDir 一起带上，现场可查。
        const detail = (stderr || '').trim() || 'no stderr'
        finish({
          ok: false,
          text: stdout.trim(),
          error: `exit ${code ?? 'unknown'} · model=${model} · agentDir=${agentDir} · ${detail}`.slice(0, 500),
        })
      }
    })
  })
}

export type LessonVerdict = {
  /** 值不值得留下。 */
  worth: boolean
  polarity: 'negative' | 'positive'
  category: string
  reason: string
  /** 直接可用的规则草稿；worth=false 时为空。 */
  rule: string
  model?: string
  judgedAt: number
  /** 判断失败（没模型/超时/输出解析不了）时保留原因。 */
  error?: string
}

const JUDGE_SYSTEM_PROMPT = [
  '你是「工作习惯档案员」，负责判断一条用户反馈值不值得沉淀成长期规则。',
  '判断标准：',
  '1. 只有在能提炼出「可复用的做法/禁止项」时才值得留下（例如：改完必须自己先跑类型检查和测试；不要动用户没让动的文件；汇报别用行话）。',
  '2. 一次性的、纯情绪无信息量的、纯业务细节的、重复已知规则的，都不值得。',
  '3. 能归到「用户偏好」「流程纪律」「交付质量」「沟通方式」其中一类的，才算有价值。',
  '只输出一行 JSON，不要解释、不要代码块：',
  '{"worth":true|false,"polarity":"negative"|"positive","category":"用户偏好|流程纪律|交付质量|沟通方式|其他","reason":"一句话理由","rule":"worth 为 true 时给可直接写进规则的祈使句（不超过 60 字），否则空字符串"}',
].join('\n')

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function judgeLessonWithModel(input: {
  text: string
  context?: string
  model?: string
  timeoutMs?: number
}): Promise<LessonVerdict> {
  const prompt = [
    '用户刚说（可能是批评、驳回或纠正）：',
    input.text.slice(0, 4000),
    input.context ? `\n相关上下文：${input.context.slice(0, 800)}` : '',
    '\n按系统提示的格式只回一行 JSON。',
  ].join('\n')
  const result = await runOneShotModel({
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    prompt,
    model: input.model,
    timeoutMs: input.timeoutMs ?? 60_000,
  })
  const judgedAt = Date.now()
  const parsed = result.ok ? parseJsonObject(result.text) : null
  if (!parsed) {
    return {
      worth: false,
      polarity: 'negative',
      category: '其他',
      reason: '',
      rule: '',
      model: result.model,
      judgedAt,
      error: result.error || 'unparsable',
    }
  }
  const worth = parsed.worth === true || parsed.worth === 'true'
  return {
    worth,
    polarity: parsed.polarity === 'positive' ? 'positive' : 'negative',
    category: String(parsed.category || '其他').slice(0, 20),
    reason: String(parsed.reason || '').slice(0, 300),
    rule: worth ? String(parsed.rule || '').slice(0, 300) : '',
    model: result.model,
    judgedAt,
  }
}

export type LessonSummaryResult = {
  ok: boolean
  title: string
  body: string
  polarity: 'negative' | 'positive'
  model?: string
  error?: string
}

const SUMMARY_SYSTEM_PROMPT = [
  '你是「工作习惯编辑」，把用户攒下的零散反馈归纳成能直接写进系统提示词的规则。',
  '要求：',
  '1. 合并同类项，去掉重复和情绪化表述，最多 8 条；',
  '2. 每条以「必须/不要/先…再…」这类祈使句开头，一条一句，具体可执行；',
  '3. 不要编造用户没说过的事，不要输出寒暄。',
  '只输出一行 JSON，不要代码块：',
  '{"title":"规则标题（不超过 16 字）","polarity":"negative|positive","body":"1. …\\n2. …"}',
  'polarity：以「不要/禁止」为主的填 negative，以「应该/必须」为主的填 positive。',
].join('\n')

/** 把留下的教训（+ 用户临时补充的要求）总结成一条规则。 */
export async function summarizeLessonsWithModel(input: {
  lessons: string[]
  instruction?: string
  model?: string
  timeoutMs?: number
}): Promise<LessonSummaryResult> {
  const material = input.lessons.length
    ? input.lessons.map((text, index) => `${index + 1}. ${text}`).join('\n')
    : '（没有素材）'
  const prompt = [
    '零散反馈：',
    material.slice(0, 12_000),
    input.instruction?.trim() ? `\n用户这次额外补充的要求：${input.instruction.trim().slice(0, 2000)}` : '',
    '\n按系统提示的格式只回一行 JSON。',
  ].join('\n')
  const result = await runOneShotModel({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    prompt,
    model: input.model,
    timeoutMs: input.timeoutMs ?? 90_000,
  })
  const parsed = result.ok ? parseJsonObject(result.text) : null
  if (!parsed) {
    return {
      ok: false,
      title: '',
      body: '',
      polarity: 'negative',
      model: result.model,
      error: result.error || 'unparsable',
    }
  }
  return {
    ok: true,
    title: String(parsed.title || '工作习惯规则').slice(0, 60),
    body: String(parsed.body || '').slice(0, 4000),
    polarity: parsed.polarity === 'positive' ? 'positive' : 'negative',
    model: result.model,
  }
}
