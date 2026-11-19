/**
 * 工作团队看板（右侧栏 Team 面板）的共享契约。
 *
 * 数据真相仍是项目里的 `.文档/开发规范/看板/当前批次.md`（与 DSH flow-board
 * 插件同一套 markdown 格式）。这里只放纯函数：解析、状态写回、角色绑定归一化、
 * 派发提示词组装。主进程负责落盘，渲染层负责展示；shared 不许 import electron/node。
 *
 * 解析刻意不用正则模板拼接：字段按行读，标题按前缀判断。换行符（CRLF/LF）
 * 也用常量表示，避免转义层把 `\n` 吃成 `n`。
 */

export const TEAM_SPEC_RELATIVE_DIR = '.文档/开发规范'
export const TEAM_BOARD_RELATIVE_PATH = '看板/当前批次.md'
export const TEAM_ROLES_FILE = '角色配置.json'
export const TEAM_STATE_RELATIVE_PATH = '协作/团队.json'

export const TEAM_ROLES = ['Leader', '设计师', '前端', '后端', '质量测试'] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

/** 泳道顺序与 DSH flow-board 保持一致，避免同一个项目在两处看出不同顺序。 */
export const TEAM_STATUSES = ['待办', '进行中', '待审查', '阻塞', '实现完成', '已验收'] as const
export type TeamStatus = (typeof TEAM_STATUSES)[number]

/** 旧卡片/旧配置里的状态别名；看清是历史写法，不能当成新状态。 */
const STATUS_ALIASES: Record<string, TeamStatus> = {
  待认领: '待办',
  完成: '已验收',
  已实现: '实现完成',
  审查中: '待审查',
}

const ROLE_ALIASES: Record<string, TeamRole> = {
  产品经理: 'Leader',
  UI审查: '质量测试',
  测试: '质量测试',
  质量: '质量测试',
  设计: '设计师',
}

export const TEAM_BLOCK_TYPES = ['待用户确认', '缺环境/工具', '外部依赖', '执行失败'] as const
export type TeamBlockType = (typeof TEAM_BLOCK_TYPES)[number]

const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + LF

export function canonicalTeamRole(value: unknown): string {
  const role = String(value ?? '').trim()
  return ROLE_ALIASES[role] ?? role
}

export function normalizeTeamStatus(value: unknown): TeamStatus {
  const status = String(value ?? '').replace(/[（(].*$/, '').trim()
  const alias = STATUS_ALIASES[status]
  if (alias) return alias
  return (TEAM_STATUSES as readonly string[]).includes(status) ? (status as TeamStatus) : '待办'
}

export function isTeamRole(value: unknown): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(String(value ?? ''))
}

export function isTeamTaskId(value: unknown): boolean {
  const id = String(value ?? '')
  if (!id.startsWith('T-') || id.length < 3) return false
  for (const char of id.slice(2)) {
    if (char < '0' || char > '9') return false
  }
  return true
}

export type TeamAcceptanceItem = { text: string; done: boolean }

export type TeamTask = {
  id: string
  title: string
  role: string
  status: TeamStatus
  wave: string
  input: string
  output: string
  dependsOn: string[]
  note: string
  blockType: string
  /** 最近一次人工处理记录（`- 人工处理：`） */
  manualNote: string
  /** 最近一次宿主自动推进记录（`- 自动推进：`） */
  autoNote: string
  acceptance: TeamAcceptanceItem[]
  /** 卡片详情原文，用于复制派发包与「看板原文」 */
  raw: string
}

export type TeamBoard = {
  batch: string
  goal: string
  tasks: TeamTask[]
}

export type TeamProgress = {
  total: number
  accepted: number
  blocked: number
  inProgress: number
  review: number
}

export type TeamRoleBinding = {
  role: TeamRole
  /** `provider/modelId`；空串表示尚未绑定 */
  model: string
  /** 思考深度（off/minimal/low/medium/high/xhigh/max），空串表示用模型默认 */
  effort: string
  note: string
  enabled: boolean
  directEnabled: boolean
}

export type TeamRoleSession = {
  sessionFile: string
  sessionId?: string
  updatedAt: number
}

export type TeamSessionMap = Partial<Record<TeamRole, TeamRoleSession>>

export type TeamRunStatus = 'starting' | 'running' | 'done' | 'failed' | 'cancelled'

export type TeamRun = {
  id: string
  taskId: string
  role: string
  sessionFile: string
  sessionId?: string
  status: TeamRunStatus
  startedAt: number
  endedAt?: number
  /** 宿主在会话结束时把卡片推进到的状态 */
  settledTo?: TeamStatus
}

export type TeamState = {
  version: 1
  sessions: TeamSessionMap
  runs: TeamRun[]
}

export type TeamSnapshot = {
  workspaceId: string
  specPath: string
  boardFile: string
  /** 看板文件是否存在；false 时面板展示初始化入口 */
  exists: boolean
  batch: string
  goal: string
  tasks: TeamTask[]
  roles: TeamRoleBinding[]
  sessions: TeamSessionMap
  runs: TeamRun[]
}

export function emptyTeamState(): TeamState {
  return { version: 1, sessions: {}, runs: [] }
}

export function teamProgress(tasks: readonly TeamTask[]): TeamProgress {
  return {
    total: tasks.length,
    accepted: tasks.filter((task) => task.status === '已验收').length,
    blocked: tasks.filter((task) => task.status === '阻塞').length,
    inProgress: tasks.filter((task) => task.status === '进行中').length,
    review: tasks.filter((task) => task.status === '待审查').length,
  }
}

/* ---------------- 看板 markdown 解析 ---------------- */

type IndexRow = { id: string; title: string; role: string; status: string; summary: string }

/** 读取 `- 字段：值` 行的字段名；不是字段行返回 null。 */
function fieldNameOf(line: string): string | null {
  const text = line.trim()
  if (!text.startsWith('- ')) return null
  const rest = text.slice(2)
  const full = rest.indexOf('：')
  const half = rest.indexOf(':')
  const colon = full >= 0 ? full : half
  if (colon <= 0) return null
  return rest.slice(0, colon).trim()
}

function fieldValueOf(line: string): string {
  const text = line.trim()
  const rest = text.slice(2)
  const full = rest.indexOf('：')
  const half = rest.indexOf(':')
  const colon = full >= 0 ? full : half
  return colon < 0 ? '' : rest.slice(colon + 1).trim()
}

function fieldOf(text: string, label: string): string {
  for (const line of text.split(LF)) {
    if (fieldNameOf(line) !== label) continue
    return fieldValueOf(line)
  }
  return ''
}

function setField(section: string, label: string, nextLine: string, afterLabel?: string): string {
  const lines = section.split(LF)
  const index = lines.findIndex((line) => fieldNameOf(line) === label)
  if (index >= 0) {
    lines[index] = nextLine
    return lines.join(LF)
  }
  if (afterLabel) {
    const anchor = lines.findIndex((line) => fieldNameOf(line) === afterLabel)
    if (anchor >= 0) {
      lines.splice(anchor + 1, 0, nextLine)
      return lines.join(LF)
    }
  }
  return [...lines, nextLine].join(LF)
}

function removeField(section: string, label: string): string {
  return section
    .split(LF)
    .filter((line) => fieldNameOf(line) !== label)
    .join(LF)
}

function isAcceptanceLine(line: string): boolean {
  const text = line.trim()
  if (!text.startsWith('- [') && !text.startsWith('* [')) return false
  const box = text.charAt(3)
  return box === ' ' || box === 'x' || box === 'X'
}

/** 卡片详情段 = `### T-xxx` 到下一个三级标题或二级标题（不含）。 */
function sectionRange(markdown: string, id: string): { start: number; end: number } | null {
  const lines = markdown.split(LF)
  const heading = `### ${id}`
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (start < 0) {
      if (line.startsWith(heading) && (line.length === heading.length || line.charAt(heading.length) === ' ' || line.charAt(heading.length) === String.fromCharCode(9))) start = i
      continue
    }
    if (line.startsWith('### ') || line.startsWith('## ')) return { start, end: i }
  }
  return start < 0 ? null : { start, end: lines.length }
}

function sectionOf(markdown: string, id: string): string | null {
  const range = sectionRange(markdown, id)
  if (!range) return null
  return markdown.split(LF).slice(range.start, range.end).join(LF)
}

function parseIndexLine(line: string): IndexRow | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  const cells = trimmed.split('|').map((cell) => cell.trim())
  // | 编号 | 标题 | 角色 | 状态 | 一句话 |
  const id = cells[1] ?? ''
  if (!isTeamTaskId(id)) return null
  return {
    id,
    title: cells[2] ?? '',
    role: cells[3] ?? '',
    status: cells[4] ?? '',
    summary: cells[5] ?? '',
  }
}

function parseIndexRows(markdown: string): Map<string, IndexRow> {
  const rows = new Map<string, IndexRow>()
  for (const line of markdown.split(LF)) {
    const row = parseIndexLine(line)
    if (!row || rows.has(row.id)) continue
    rows.set(row.id, row)
  }
  return rows
}

function parseCard(section: string, index: IndexRow | undefined): TeamTask | null {
  const firstLine = section.split(LF)[0] ?? ''
  if (!firstLine.startsWith('### ')) return null
  const rest = firstLine.slice(4).trim()
  const space = rest.indexOf(' ')
  const id = space < 0 ? rest : rest.slice(0, space)
  if (!isTeamTaskId(id)) return null
  const title = (space < 0 ? '' : rest.slice(space + 1).trim()) || index?.title || id
  const acceptance: TeamAcceptanceItem[] = []
  for (const line of section.split(LF)) {
    if (!isAcceptanceLine(line)) continue
    const text = line.trim().slice(5).trim()
    if (text) acceptance.push({ text, done: line.trim().charAt(3).toLowerCase() === 'x' })
  }
  const status = fieldOf(section, '状态') || index?.status || ''
  return {
    id,
    title,
    role: canonicalTeamRole(fieldOf(section, '角色') || index?.role || ''),
    status: normalizeTeamStatus(status),
    wave: fieldOf(section, '波次'),
    input: fieldOf(section, '输入'),
    output: fieldOf(section, '产出') || fieldOf(section, '输出'),
    dependsOn: fieldOf(section, '依赖')
      .split(/[、,，;； ]+/)
      .map((item) => item.trim())
      .filter(Boolean),
    note: fieldOf(section, '备注'),
    blockType: fieldOf(section, '阻塞分型'),
    manualNote: fieldOf(section, '人工处理'),
    autoNote: fieldOf(section, '自动推进'),
    acceptance,
    raw: section.trim(),
  }
}

/**
 * 解析 `看板/当前批次.md`。卡片详情是权威来源；只有索引行、没有详情段的老卡片
 * 也会被读出来（状态可改，详情为空），避免看板升级后老项目直接失明。
 */
export function parseTeamBoard(markdown: string): TeamBoard {
  const md = normalizeEol(String(markdown ?? ''))
  const batch = fieldOf(md, '当前批次') || fieldOf(md, '批次') || '当前批次'
  const goal = fieldOf(md, '目标')
  const index = parseIndexRows(md)
  const tasks: TeamTask[] = []
  const seen = new Set<string>()
  const lines = md.split(LF)

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('### ')) continue
    const headingRest = lines[i].slice(4).trim()
    const space = headingRest.indexOf(' ')
    const id = space < 0 ? headingRest : headingRest.slice(0, space)
    if (!isTeamTaskId(id) || seen.has(id)) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith('### ') || lines[j].startsWith('## ')) {
        end = j
        break
      }
    }
    const card = parseCard(lines.slice(i, end).join(LF), index.get(id))
    if (!card) continue
    seen.add(id)
    tasks.push(card)
    i = end - 1
  }

  for (const row of index.values()) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    tasks.push({
      id: row.id,
      title: row.title || row.id,
      role: canonicalTeamRole(row.role),
      status: normalizeTeamStatus(row.status),
      wave: '',
      input: '',
      output: '',
      dependsOn: [],
      note: row.summary,
      blockType: '',
      manualNote: '',
      autoNote: '',
      acceptance: [],
      raw: '',
    })
  }

  tasks.sort((a, b) => taskNumber(a.id) - taskNumber(b.id))
  return { batch, goal, tasks }
}

function taskNumber(id: string): number {
  const value = Number(id.slice(2))
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function normalizeEol(text: string): string {
  return text.split(CRLF).join(LF).split(String.fromCharCode(13)).join(LF)
}

/* ---------------- 状态写回 ---------------- */

export type TeamStatusWriteInput = {
  id: string
  to: TeamStatus
  /** 期望的当前状态；传了就做乐观并发校验，避免覆盖别人刚改过的卡 */
  from?: string | null
  at?: string
  reason?: string
  /** 人工改卡：落一行「人工处理」记录 */
  manual?: boolean
  /** 宿主派发/会话结束自动推进：落一行「自动推进」记录 */
  autoNote?: string
  /** 移到阻塞时的分型 */
  blockType?: string
}

export type TeamStatusWriteResult =
  | { ok: true; markdown: string; from: TeamStatus; changed: boolean }
  | { ok: false; reason: 'task_not_found' | 'status_mismatch' | 'index_row_missing'; current?: TeamStatus }

/**
 * 改一张卡的状态：同时更新卡片详情与任务索引行，追加/替换人工处理或自动推进记录，
 * 并在进入/离开「已验收」时勾选/清空验收清单。返回新的 markdown（保留原文件换行风格），
 * 由主进程负责加锁落盘。
 */
export function updateTeamTaskStatus(markdown: string, input: TeamStatusWriteInput): TeamStatusWriteResult {
  const raw = String(markdown ?? '')
  const eol = raw.includes(CRLF) ? CRLF : LF
  let md = normalizeEol(raw)
  const id = String(input.id ?? '').trim()
  const to = normalizeTeamStatus(input.to)
  let range = sectionRange(md, id)
  if (!range) {
    // 老看板可能只有索引行、没有卡片详情段：就地补一段再改，别让卡片在面板里变成只读。
    const indexRow = parseIndexRows(md).get(id)
    if (!indexRow) return { ok: false, reason: 'task_not_found' }
    const synthetic = `### ${id} ${indexRow.title || id}${LF}${LF}- 角色：${canonicalTeamRole(indexRow.role) || '未分配'}${LF}- 状态：${normalizeTeamStatus(indexRow.status)}${LF}`
    const archiveAt = md.indexOf(`${LF}## 归档规则`)
    md = archiveAt >= 0 ? `${md.slice(0, archiveAt)}${LF}${synthetic}${md.slice(archiveAt)}` : `${md}${LF}${synthetic}`
    range = sectionRange(md, id)
  }
  if (!range) return { ok: false, reason: 'task_not_found' }

  const lines = md.split(LF)
  const section = lines.slice(range.start, range.end).join(LF)
  const index = parseIndexRows(md).get(id)
  const currentRaw = fieldOf(section, '状态') || index?.status || ''
  const from = currentRaw ? normalizeTeamStatus(currentRaw) : null
  if (!from) return { ok: false, reason: 'task_not_found' }
  if (input.from !== undefined && input.from !== null && String(input.from).trim()) {
    if (normalizeTeamStatus(input.from) !== from) return { ok: false, reason: 'status_mismatch', current: from }
  }

  const at = input.at || new Date().toISOString()
  const manual = input.manual === true
  const autoNote = String(input.autoNote ?? '').replace(/[\r\n]+/g, ' ').trim()
  const reason = String(input.reason ?? '').replace(/[\r\n]+/g, ' ').trim()
  const blockType = String(input.blockType ?? '').replace(/[\r\n]+/g, ' ').trim()

  let next = setField(section, '状态', `- 状态：${to}`)
  if (manual && from !== to) {
    const suffix = to === '已验收' ? '（人工验收，原自动报告保留）' : ''
    const note = `- 人工处理：${at} · ${from} → ${to} · ${reason || (to === '已验收' ? '用户在面板确认已人工验证' : '用户在面板调整状态')}${suffix}`
    next = setField(next, '人工处理', note, '状态')
  }
  if (autoNote) {
    next = setField(next, '自动推进', `- 自动推进：${at} · ${from} → ${to} · ${autoNote}`, '状态')
  }
  if (to === '阻塞' && blockType) {
    next = setField(next, '阻塞分型', `- 阻塞分型：${blockType}`, '状态')
  } else if (to !== '阻塞') {
    next = removeField(next, '阻塞分型')
  }

  next = next
    .split(LF)
    .map((line) => {
      if (!isAcceptanceLine(line)) return line
      if (to === '已验收') return line.replace('[ ]', '[x]')
      if (from === '已验收') return line.replace('[x]', '[ ]').replace('[X]', '[ ]')
      return line
    })
    .join(LF)

  md = [...lines.slice(0, range.start), ...next.split(LF), ...lines.slice(range.end)].join(LF)

  if (index) {
    const updated = updateIndexRow(md, id, to)
    if (!updated.found && normalizeTeamStatus(index.status) !== to) {
      return { ok: false, reason: 'index_row_missing', current: from }
    }
    md = updated.markdown
  }

  return { ok: true, markdown: md.split(LF).join(eol), from, changed: from !== to || manual || !!autoNote }
}

function updateIndexRow(markdown: string, id: string, status: TeamStatus): { markdown: string; found: boolean } {
  const lines = markdown.split(LF)
  for (let i = 0; i < lines.length; i++) {
    const row = parseIndexLine(lines[i])
    if (!row || row.id !== id) continue
    const cells = lines[i].split('|')
    // 末尾带不带 `|` 都要能改；状态列固定在第 4 个单元格（索引 4）。
    if (cells.length < 7) return { markdown, found: false }
    cells[4] = ` ${status} `
    lines[i] = cells.join('|')
    return { markdown: lines.join(LF), found: true }
  }
  return { markdown, found: false }
}

/** 只做一次自动回执（不改状态），供派发失败等场景追加记录。 */
export function appendTeamTaskAutoNote(markdown: string, id: string, note: string, at = new Date().toISOString()): string {
  const raw = String(markdown ?? '')
  const eol = raw.includes(CRLF) ? CRLF : LF
  const md = normalizeEol(raw)
  const range = sectionRange(md, id)
  if (!range) return markdown
  const lines = md.split(LF)
  const section = lines.slice(range.start, range.end).join(LF)
  const line = `- 自动推进：${at} · ${note.replace(/[\r\n]+/g, ' ').trim()}`
  const next = setField(section, '自动推进', line, '状态')
  const rebuilt = [...lines.slice(0, range.start), ...next.split(LF), ...lines.slice(range.end)].join(LF)
  return rebuilt.split(LF).join(eol)
}

/* ---------------- 角色绑定 ---------------- */

const DEFAULT_ROLE_NOTES: Record<TeamRole, string> = {
  Leader: '需求、拆解、派发与收口',
  设计师: '视觉方向、设计稿与配套资源',
  前端: '界面还原、交互与接口对接',
  后端: '接口、数据与服务行为',
  质量测试: '独立验证功能、交互与视觉还原',
}

export function defaultTeamRoleBindings(): TeamRoleBinding[] {
  return TEAM_ROLES.map((role) => ({
    role,
    model: '',
    effort: '',
    note: DEFAULT_ROLE_NOTES[role],
    enabled: true,
    directEnabled: true,
  }))
}

/**
 * 归一化成固定的五角色：旧七角色配置（产品经理/UI审查/测试）自动收敛，
 * 缺失角色补默认值；停用请用 enabled，不要删角色。
 */
export function normalizeTeamRoleBindings(value: unknown): TeamRoleBinding[] {
  const byRole = new Map<TeamRole, TeamRoleBinding>(defaultTeamRoleBindings().map((binding) => [binding.role, binding]))
  const input = Array.isArray(value) ? value : []
  const seen = new Set<TeamRole>()
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const role = canonicalTeamRole(record.role)
    if (!isTeamRole(role) || seen.has(role)) continue
    seen.add(role)
    const base = byRole.get(role)!
    const model = typeof record.model === 'string' ? record.model.trim() : ''
    const effort = typeof record.effort === 'string' ? record.effort.trim().toLowerCase() : ''
    const note = typeof record.note === 'string' ? record.note.trim() : ''
    byRole.set(role, {
      role,
      model,
      effort: /^[a-z][a-z0-9_-]*$/.test(effort) ? effort : '',
      note: note || base.note,
      enabled: record.enabled !== false,
      directEnabled: record.directEnabled !== false,
    })
  }
  return TEAM_ROLES.map((role) => byRole.get(role)!)
}

/** `provider/modelId` → 可直接交给 pi 的两段；模型 id 本身允许带 `/`。 */
export function splitTeamModel(model: string): { provider: string; modelId: string } | null {
  const value = String(model ?? '').trim()
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return null
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) }
}

/* ---------------- 派发提示词 ---------------- */

const ROLE_CORE_RULES: Record<TeamRole, string[]> = {
  Leader: [
    '你负责需求澄清、拆解、派发与收口，不写业务代码。',
    '每张卡开工前确认输入、范围、交付标准与依赖；范围不清先问，不要自行扩范围。',
    '验收只认实际证据；没有实测不得声称通过。',
    '需要用户决定时，给出一句话选项与推荐值，不要替用户拍板。',
  ],
  设计师: [
    '先复用现有风格、组件与素材，再决定是否生图或画矢量；不重画品牌 Logo。',
    '设计稿必须能拆出前端真正需要的资源：真透明、主体完整、动态文案不烤进图。',
    '方向未确认前不做全部页面；新方向先给 1 个代表页的可比较版本。',
  ],
  前端: [
    '按 PRD、设计稿与接口契约实现；覆盖空态、加载、失败、禁用、重复提交与权限。',
    '改动严格限定在任务范围；范围外的问题只报告，不顺手改。',
    '交付前必须自己跑构建或截图自查，并给出证据路径；没跑的项标 unverified。',
  ],
  后端: [
    '先明确参数、错误码、权限、幂等与并发，再实现；契约变更要同步给前端。',
    '自测要核对实际断言与结果，不能把「退出码 0」「文件存在」当成通过。',
    '不擅自改业务规则与安全策略；发现缺口先报告。',
  ],
  质量测试: [
    '只读任务标准、实际产物和验证入口，不读执行方的聊天，不重复理解整个项目。',
    '代码质量与视觉还原分开给结论；视觉项没有截图证据只能标 unverified。',
    '一次集中报告问题；不要用源码存在推断行为通过。',
  ],
}

export type TeamPromptInput = {
  role: string
  batch: string
  goal: string
  specRelativeDir?: string
  task?: TeamTask | null
  /** 直接对话（头像进入角色会话）时的一句话引导 */
  topic?: string
}

/**
 * 组装派发/角色会话的提示词：角色核心规则 + 项目上下文 + 任务卡原文 + 工作约定。
 * 不内联整套规范文档，只给阅读路径——上下文要省，规则要硬。
 */
export function buildTeamPrompt(input: TeamPromptInput): string {
  const role = canonicalTeamRole(input.role)
  const rules = (ROLE_CORE_RULES as Record<string, string[] | undefined>)[role] ?? [
    '只完成被派发的范围；需要扩范围、需要用户决定或缺工具时，先停下说明。',
  ]
  const spec = input.specRelativeDir || TEAM_SPEC_RELATIVE_DIR
  const lines: string[] = []
  lines.push(`# 角色：${role}`, '')
  lines.push('## 你的核心规则', '')
  for (const rule of rules) lines.push(`- ${rule}`)
  lines.push('', '## 项目上下文', '')
  lines.push(`- 项目规范目录（相对项目根目录）：\`${spec}\``)
  lines.push(`- 当前批次：${input.batch || '当前批次'}`)
  if (input.goal) lines.push(`- 本轮目标：${input.goal}`)
  lines.push('- 开工先读 `00-总入口.md`；再读 `PRD.md` 里与你任务相关的章节。清单、协议与设计资料按需读取，存在才读，不通读整套。')
  if (input.topic) {
    lines.push('', '## 本次对话', '', input.topic)
  }
  if (input.task) {
    lines.push('', `# 你认领的任务卡（${input.task.id}）`, '', '```markdown', input.task.raw.trim() || `${input.task.id} ${input.task.title}`, '```')
    if (input.task.acceptance.length) {
      lines.push('', '## 验收标准（逐项给实际结果与证据）', '')
      for (const item of input.task.acceptance) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`)
    }
  }
  lines.push(
    '',
    '## 工作约定（硬规则）',
    '',
    '- 只做这张卡/这段对话的范围；需要扩大范围、改需求、动权限或数据规则时，先停下说明，等确认。',
    '- 不要修改 `看板/当前批次.md` 或 `角色配置.json`：看板由宿主记录派发与结果，手改会和面板状态打架。',
    '- 结束时在回复末尾写两行：`交付摘要：…` 与 `验证：…（实际命令/截图路径；没做就写 unverified）`。',
    '- 缺环境、缺工具、需要用户决定时直接说清阻塞点和下一步，不要用「应该可以」代替实际验证。',
  )
  return lines.join(LF)
}

/* ---------------- 新建任务卡 ---------------- */

export type TeamTaskDraft = {
  title: string
  role: string
  status?: TeamStatus
  wave?: string
  input?: string
  output?: string
  note?: string
  dependsOn?: string[]
  acceptance?: string[]
}

export function nextTeamTaskId(tasks: readonly TeamTask[]): string {
  let max = 0
  for (const task of tasks) {
    const value = Number(task.id.slice(2))
    if (Number.isFinite(value) && value > max) max = value
  }
  return `T-${String(max + 1).padStart(3, '0')}`
}

/**
 * 在 markdown 末尾追加一张任务卡与索引行。看板由人工/AI 共同维护时，面板也必须能
 * 建卡，否则「派发」之前还得让用户手改 markdown。返回新 markdown 与编号。
 */
export function appendTeamTask(
  markdown: string,
  draft: TeamTaskDraft,
  tasks: readonly TeamTask[] = parseTeamBoard(markdown).tasks,
): { ok: true; id: string; markdown: string } | { ok: false; reason: 'empty_title' } {
  const title = String(draft.title ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  if (!title) return { ok: false, reason: 'empty_title' }
  const raw = String(markdown ?? '')
  const eol = raw.includes(CRLF) ? CRLF : LF
  let md = normalizeEol(raw)
  const id = nextTeamTaskId(tasks)
  const status = normalizeTeamStatus(draft.status ?? '待办')
  const role = canonicalTeamRole(draft.role)
  const summary = String(draft.note ?? '').replace(/[\r\n]+/g, ' ').trim()
  const indexRow = `| ${id} | ${title} | ${role} | ${status} | ${summary} |`

  const lines = md.split(LF)
  let lastIndexRow = -1
  let separatorRow = -1
  for (let i = 0; i < lines.length; i++) {
    if (parseIndexLine(lines[i])) lastIndexRow = i
    if (separatorRow < 0 && lines[i].trim().startsWith('|--')) separatorRow = i
  }
  if (lastIndexRow >= 0) {
    lines.splice(lastIndexRow + 1, 0, indexRow)
  } else if (separatorRow >= 0) {
    lines.splice(separatorRow + 1, 0, indexRow)
  } else {
    lines.push('', '| 编号 | 标题 | 角色 | 状态 | 一句话 |', '|------|------|------|------|--------|', indexRow)
  }

  const dependsOn = (draft.dependsOn ?? []).map((dep) => String(dep).trim()).filter(Boolean)
  const acceptance = (draft.acceptance ?? []).map((item) => String(item).trim()).filter(Boolean)
  const card: string[] = [`### ${id} ${title}`, '', `- 角色：${role}`, `- 状态：${status}`]
  if (draft.wave?.trim()) card.push(`- 波次：${draft.wave.trim()}`)
  if (draft.input?.trim()) card.push(`- 输入：${draft.input.trim()}`)
  if (draft.output?.trim()) card.push(`- 产出：${draft.output.trim()}`)
  if (dependsOn.length) card.push(`- 依赖：${dependsOn.join('、')}`)
  if (summary) card.push(`- 备注：${summary}`)
  card.push('')
  if (acceptance.length) {
    for (const item of acceptance) card.push(`- [ ] ${item}`)
  } else {
    card.push('- [ ] （补充可验证的验收标准）')
  }

  const built = lines.join(LF)
  const cardText = card.join(LF)
  const archiveIndex = built.indexOf(`${LF}## 归档规则`)
  let insertAt = archiveIndex
  if (archiveIndex >= 0) {
    // 卡片详情在最后一个 `---` 之前结束：把新卡插在详情区末尾，而不是归档规则前。
    const separator = built.slice(0, archiveIndex).lastIndexOf(`${LF}---`)
    if (separator >= 0) insertAt = separator
  }
  const head = (insertAt >= 0 ? built.slice(0, insertAt) : built).replace(new RegExp(String.fromCharCode(10) + '+$'), '')
  const tail = insertAt >= 0 ? built.slice(insertAt).replace(new RegExp('^' + String.fromCharCode(10) + '+'), '') : ''
  md = `${head}${LF}${LF}${cardText}${LF}${tail ? `${LF}${tail}` : ''}`

  return { ok: true, id, markdown: md.split(LF).join(eol) }
}

/**
 * 角色坞「直接对话」的开场白：只交代身份、项目路径和等待任务，
 * 不把任务卡的硬规则整段倒进聊天（那些在派发提示词里）。
 */
export function buildTeamRoleIntro(input: { role: string; batch: string; goal: string; specRelativeDir?: string }): string {
  const role = canonicalTeamRole(input.role)
  const spec = input.specRelativeDir || TEAM_SPEC_RELATIVE_DIR
  return [
    `你是本项目团队的${role}。`,
    `项目规范目录：${spec}（相对项目根目录）。当前批次：${input.batch || '当前批次'}${input.goal ? `；本轮目标：${input.goal}` : ''}。`,
    '先读 `00-总入口.md` 与 `PRD.md` 里与你职责相关的章节（存在才读），然后等待用户的具体任务；不要主动改代码。',
    '用户给任务时，先确认范围与验收标准；需要扩范围、改需求或用户决定时停下说明。',
    '不要修改看板或角色配置：派发与结果由面板记录。',
  ].join(LF)
}
