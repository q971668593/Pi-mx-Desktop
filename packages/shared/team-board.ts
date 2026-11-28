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

export const TEAM_ROLES = ['Leader', 'Builder', 'Verifier', 'Designer'] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

export const TEAM_MAX_CONCURRENCY_DEFAULT = 3
export const TEAM_MAX_CONCURRENCY_MIN = 1
export const TEAM_MAX_CONCURRENCY_MAX = 6
export const TEAM_MAX_REWORK_ROUNDS = 3

export function clampTeamConcurrency(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return TEAM_MAX_CONCURRENCY_DEFAULT
  return Math.min(TEAM_MAX_CONCURRENCY_MAX, Math.max(TEAM_MAX_CONCURRENCY_MIN, Math.round(num)))
}

/** 泳道顺序：精简为 5 主泳道 + 阻塞侧挂道，已通过即解锁下游依赖。 */
export const TEAM_STATUSES = ['待办', '进行中', '待审查', '已通过', '阻塞', '已验收'] as const
export type TeamStatus = (typeof TEAM_STATUSES)[number]

/** 旧卡片/旧配置里的状态别名；看清是历史写法，不能当成新状态。 */
const STATUS_ALIASES: Record<string, TeamStatus> = {
  待认领: '待办',
  完成: '已验收',
  已实现: '已通过',
  实现完成: '已通过',
  审查中: '待审查',
}

const ROLE_ALIASES: Record<string, TeamRole> = {
  产品经理: 'Leader',
  前端: 'Builder',
  后端: 'Builder',
  全栈: 'Builder',
  开发: 'Builder',
  UI审查: 'Verifier',
  测试: 'Verifier',
  质量: 'Verifier',
  质检: 'Verifier',
  质量测试: 'Verifier',
  设计: 'Designer',
  设计师: 'Designer',
}

export const TEAM_BLOCK_TYPES = ['待用户确认', '合并冲突', '缺环境/工具', '外部依赖', '执行失败'] as const
export type TeamBlockType = (typeof TEAM_BLOCK_TYPES)[number]

/** 需要主人拍板的阻塞一律落到这个分型上，面板据此识别「待批准」。 */
export const TEAM_APPROVAL_BLOCK_TYPE: TeamBlockType = '待用户确认'

/** 卡片上的审批字段：`- 待批准：`（执行方申请）、`- 批准：` / `- 驳回：`（主人决定）。 */
export const TEAM_APPROVAL_REQUEST_LABEL = '待批准'
export const TEAM_APPROVAL_APPROVED_LABEL = '批准'
export const TEAM_APPROVAL_DENIED_LABEL = '驳回'

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

/**
 * 控制字符（含 NUL/ESC、DEL、双向文本标记）会进终端、日志和面板；一律清掉再落盘。
 * 与 dsh-super-agent 的 approval/team 标签清洗保持同一口径。
 */
const UNSAFE_TEAM_TEXT = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/** 单行化 + 去控制字符 + 截断。写看板/写派发记录的非结构化文本都走这里。 */
export function sanitizeTeamText(value: unknown, max = 300): string {
  return String(value ?? '')
    .replace(UNSAFE_TEAM_TEXT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
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
  /** 执行方申请的待批准动作（`- 待批准：`）；空串表示没有待批事项 */
  approval: string
  /** 最近一次批准/驳回记录（`- 批准：` / `- 驳回：`） */
  approvalNote: string
  /** 独立 Git Worktree 路径（`- 工作区：`） */
  worktreePath: string
  /** 独立任务分支名（`- 分支：`） */
  branch: string
  /** 卡片允许修改的目录/文件边界（`- 文件边界：`） */
  ownedPaths: string[]
  /** Verifier 打回返工计数（`- 返工次数：`） */
  reworkCount: number
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

/**
 * 派发结果的类型化说法：结束状态之外还要回答「这轮是交付、失败、还是等触发」。
 * 借鉴 dsh-super-agent 的 Assignment.report，避免只用一句 status 猜结论。
 */
export const TEAM_RUN_REPORT_KINDS = ['ready', 'failed', 'blocked', 'waiting', 'question'] as const
export type TeamRunReportKind = (typeof TEAM_RUN_REPORT_KINDS)[number]

export type TeamRunReport = {
  kind: TeamRunReportKind
  /** 一句话回执（不存长报告：证据留在会话与协作目录） */
  text?: string
  at: number
  /** deliver：值得给主人看；hold：压住（等批准/暂停）；discard：不值得发 */
  verdict?: 'deliver' | 'hold' | 'discard'
}

export type TeamRun = {
  id: string
  taskId: string
  role: string
  sessionFile: string
  sessionId?: string
  /** 本轮实际派发使用的 `provider/modelId` */
  model?: string
  /** 发起派发的父/Leader 会话文件，用于在子代理上下文中回查同对话配置 */
  originSessionFile?: string
  status: TeamRunStatus
  startedAt: number
  endedAt?: number
  /** 宿主在会话结束时把卡片推进到的状态 */
  settledTo?: TeamStatus
  /** 结束时写下的结构化回执 */
  report?: TeamRunReport
  /** 独立工作树路径与分支名 */
  worktreePath?: string
  branch?: string
  /** 看门狗判定「超时无结束事件」的时间；只标记一次，用于面板提示 */
  staleAt?: number
  /** 主人/宿主主动结束这次派发（覆盖看门狗结论，避免再被标记） */
  closedBy?: 'human' | 'host'
}

/** 默认超时：30 分钟没有结束事件且会话文件不再增长，就判定这轮卡住。 */
export const TEAM_RUN_STALE_MS_DEFAULT = 30 * 60 * 1000

export function isTeamRunActive(run: Pick<TeamRun, 'status'> | null | undefined): boolean {
  return !!run && (run.status === 'starting' || run.status === 'running')
}

/**
 * 面板展示用的阶段：从卡片状态 + 派发记录 + 审批字段推导，不由「模型最后一句话」决定。
 * 卡片状态（markdown）仍是唯一真相；这里只是给同一份事实一个更细的读法。
 */
export type TeamStage =
  | 'idle'
  | 'queued'
  | 'running'
  | 'stale'
  | 'awaiting-approval'
  | 'awaiting-review'
  | 'blocked'
  | 'failed'
  | 'passed'
  | 'accepted'

export function deriveTeamStage(input: { task: TeamTask; run?: TeamRun | null; now?: number }): TeamStage {
  const { task, run } = input
  if (task.status === '已验收') return 'accepted'
  if (task.approval) return 'awaiting-approval'
  if (task.status === '阻塞') {
    return task.blockType === TEAM_APPROVAL_BLOCK_TYPE ? 'awaiting-approval' : 'blocked'
  }
  if (task.status === '待审查') return 'awaiting-review'
  if (task.status === '已通过') return 'passed'
  if (isTeamRunActive(run)) {
    if (run?.staleAt) return 'stale'
    return run?.report?.kind === 'waiting' || run?.status === 'starting' ? 'queued' : 'running'
  }
  if (run?.status === 'failed' || run?.status === 'cancelled') return 'failed'
  if (run?.report?.kind === 'ready') return 'awaiting-review'
  return 'idle'
}

export type TeamState = {
  version: 1
  sessions: TeamSessionMap
  runs: TeamRun[]
  /** 对话级角色配置覆盖（按标准化 sessionFile 为键，不同对话互不影响） */
  sessionRoles?: Record<string, TeamRoleBinding[]>
  /** 对话级直聊角色会话映射 */
  sessionRoleSessions?: Record<string, TeamSessionMap>
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
  /** 当前生效的角色配置（优先取当前对话覆盖，否则继承项目默认） */
  roles: TeamRoleBinding[]
  /** 项目级默认角色配置 */
  projectRoles?: TeamRoleBinding[]
  /** 当前 `roles` 所属作用域 */
  roleScope?: 'session' | 'project'
  /** 解析该快照时使用的会话文件 */
  sessionFile?: string
  sessions: TeamSessionMap
  runs: TeamRun[]
  defaultModel?: string
  defaultModelOverride?: string
  globalDefaultModel?: string
  maxConcurrency: number
  autoReview: boolean
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
    approval: fieldOf(section, TEAM_APPROVAL_REQUEST_LABEL),
    approvalNote: fieldOf(section, TEAM_APPROVAL_APPROVED_LABEL) || fieldOf(section, TEAM_APPROVAL_DENIED_LABEL),
    worktreePath: fieldOf(section, '工作区'),
    branch: fieldOf(section, '分支'),
    ownedPaths: fieldOf(section, '文件边界')
      .split(/[、,，;； ]+/)
      .map((item) => item.trim())
      .filter(Boolean),
    reworkCount: (() => {
      const n = Number.parseInt(fieldOf(section, '返工次数'), 10)
      return Number.isFinite(n) && n > 0 ? n : 0
    })(),
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
      approval: '',
      approvalNote: '',
      worktreePath: '',
      branch: '',
      ownedPaths: [],
      reworkCount: 0,
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
  /** 独立 Worktree 路径与分支（传 null/空串表示清除） */
  worktreePath?: string | null
  branch?: string | null
  /** 返工次数（传 0 表示清除） */
  reworkCount?: number
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
  const autoNote = sanitizeTeamText(input.autoNote, 300)
  const reason = sanitizeTeamText(input.reason, 1500)
  const blockType = sanitizeTeamText(input.blockType, 40)

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
  if (input.worktreePath !== undefined) {
    const wt = sanitizeTeamText(input.worktreePath, 500)
    next = wt ? setField(next, '工作区', `- 工作区：${wt}`, '状态') : removeField(next, '工作区')
  }
  if (input.branch !== undefined) {
    const br = sanitizeTeamText(input.branch, 120)
    next = br ? setField(next, '分支', `- 分支：${br}`, '状态') : removeField(next, '分支')
  }
  if (input.reworkCount !== undefined) {
    const rc = Number.isFinite(input.reworkCount) && input.reworkCount > 0 ? Math.floor(input.reworkCount) : 0
    next = rc > 0 ? setField(next, '返工次数', `- 返工次数：${rc}`, '状态') : removeField(next, '返工次数')
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

  return {
    ok: true,
    markdown: md.split(LF).join(eol),
    from,
    changed:
      from !== to ||
      manual ||
      !!autoNote ||
      input.worktreePath !== undefined ||
      input.branch !== undefined ||
      input.reworkCount !== undefined,
  }
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
  const line = `- 自动推进：${at} · ${sanitizeTeamText(note, 300)}`
  const next = setField(section, '自动推进', line, '状态')
  const rebuilt = [...lines.slice(0, range.start), ...next.split(LF), ...lines.slice(range.end)].join(LF)
  return rebuilt.split(LF).join(eol)
}

/* ---------------- 审批（卡片级 hold） ---------------- */

export type TeamApprovalWriteInput = {
  id: string
  decision: 'approve' | 'deny'
  /** 主人备注（批准时作为放行条件写回卡片） */
  note?: string
  at?: string
  /** 乐观并发：写前要求卡片是这个状态 */
  from?: string | null
}

export type TeamApprovalWriteResult =
  | { ok: true; markdown: string; from: TeamStatus; to: TeamStatus; changed: boolean; request: string }
  | { ok: false; reason: 'task_not_found' | 'no_pending_approval' | 'status_mismatch'; current?: TeamStatus }

/**
 * 批准/驳回卡片上的 `- 待批准：` 事项。
 *
 * 批准：清掉待批准字段，落一行 `- 批准：`，卡片从「阻塞」回到「进行中」（其它状态不动）；
 * 驳回：落一行 `- 驳回：`，卡片留在/进入「阻塞」并标 `待用户确认`。
 * 状态与索引行同步写回，写回职责仍由主进程的锁包住。
 */
export function resolveTeamApproval(markdown: string, input: TeamApprovalWriteInput): TeamApprovalWriteResult {
  const raw = String(markdown ?? '')
  const eol = raw.includes(CRLF) ? CRLF : LF
  const md = normalizeEol(raw)
  const id = String(input.id ?? '').trim()
  const range = sectionRange(md, id)
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

  const request = fieldOf(section, TEAM_APPROVAL_REQUEST_LABEL).trim()
  if (!request) return { ok: false, reason: 'no_pending_approval', current: from }

  const at = input.at || new Date().toISOString()
  const note = sanitizeTeamText(input.note, 300)
  const approve = input.decision === 'approve'
  const to: TeamStatus = approve ? (from === '阻塞' ? '进行中' : from) : '阻塞'
  const decisionLine = approve
    ? `- ${TEAM_APPROVAL_APPROVED_LABEL}：${at} · ${note || `放行：${request}`}`
    : `- ${TEAM_APPROVAL_DENIED_LABEL}：${at} · ${note || `驳回：${request}`}`

  let next = removeField(section, TEAM_APPROVAL_REQUEST_LABEL)
  next = removeField(next, TEAM_APPROVAL_APPROVED_LABEL)
  next = removeField(next, TEAM_APPROVAL_DENIED_LABEL)
  next = setField(next, approve ? TEAM_APPROVAL_APPROVED_LABEL : TEAM_APPROVAL_DENIED_LABEL, decisionLine, '状态')
  if (to !== from) next = setField(next, '状态', `- 状态：${to}`)
  if (to === '阻塞') {
    next = setField(next, '阻塞分型', `- 阻塞分型：${TEAM_APPROVAL_BLOCK_TYPE}`, '状态')
  } else {
    next = removeField(next, '阻塞分型')
  }

  let rebuilt = [...lines.slice(0, range.start), ...next.split(LF), ...lines.slice(range.end)].join(LF)
  if (index && to !== from) {
    const updated = updateIndexRow(rebuilt, id, to)
    if (!updated.found) return { ok: false, reason: 'task_not_found', current: from }
    rebuilt = updated.markdown
  }
  return { ok: true, markdown: rebuilt.split(LF).join(eol), from, to, changed: true, request }
}

/* ---------------- 角色绑定 ---------------- */

const DEFAULT_ROLE_NOTES: Record<TeamRole, string> = {
  Leader: 'S级直干；M/L级定契约、并发拆卡、合并与收口',
  Builder: '1卡1Worktree并发全栈实现与S2自检',
  Verifier: '隔离上下文独立审查（Diff、契约、实测与视觉）',
  Designer: '前置设计：直出稿、HTML原型→设计稿或单页多版式',
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
    '先做 Gate 0 复杂度路由并一句话报备（主人可随时覆写）：S 级小活（小 Bug/文案/配置/单文件）直接在主工作区动手改完自检交付，不建卡不派发；M 级写一页轻契约后自干或拆 1~3 卡；L 级走完整团队流程。',
    'L 级先确认 PRD 与技术方案契约（含公共骨架、接口与并发目录边界 `ownedPaths`）；有 UI 时按需选「直出设计稿 / HTML 原型→设计稿 / 单页多版式」，由 Designer 定稿冻结后再并发派发。',
    '卡一旦派发给 Builder，不要自己抢写那张卡的业务代码；通过 `team_board action=merge_task` 合并「已通过」的分支。',
    '需要用户拍板时给出一句话选项与推荐值；「已验收」只能主人人工确认。',
  ],
  Builder: [
    '你在独立 Git Worktree 中纵向打通单张模块卡（数据库/接口/页面/单测）与 S2 自检。',
    '改动严格限定在任务卡 `文件边界（ownedPaths）` 与任务范围内；需要改公共文件或扩范围时先停下报告。',
    '按 PRD、方案契约、冻结的原型/设计稿实现，覆盖空态、加载、失败、禁用、重复提交与权限。',
    '交付前必须跑通实际构建/单测或截图自查，在当前任务分支 `git add` 并 `git commit` 改动，并在回执里给真实命令与证据路径；没跑的项标 `unverified`。',
  ],
  Verifier: [
    '你是独立裁判：隔离上下文，不读执行者的聊天记录，只看方案契约、冻结原型/设计稿、任务验收项、Worktree Diff 与实测证据。',
    '只做验证与审查，不改业务代码；代码质量、功能断言与视觉还原分开给结论，视觉项无截图证据只能标 `unverified`。',
    '一次集中列出所有阻断与非阻断问题；不要用「源码存在」「退出码 0」推断行为通过。',
  ],
  Designer: [
    '你是前置设计专才，支持三种工作流：直出大致设计稿、基于冻结 HTML 简易原型出精修设计稿、或维护期单页出 2~3 个版式供比选。',
    '先复用现有风格、组件与素材，再决定是否生图或画矢量；动态文案不烤进图，资源可直接被前端还原。',
    '方向未确认前不做全部页面；定稿冻结后即可退场，由 Builder 还原、Verifier 截图核对。',
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
  lessonsSnippet?: string
  tasteSnippet?: string
}

export type TeamGateResult =
  | { ok: true }
  | { ok: false; gate: 'gate1_prd' | 'gate2_contract' | 'gate2_hard_gate'; message: string }

function extractDocStatus(markdown: string): string | null {
  const match = markdown.match(/^>\s*状态[：:]\s*(.+)$/m)
  return match ? match[1].trim() : null
}

/**
 * Gate 1 / Gate 2 系统级硬门禁校验：仅在派发 `Builder` 编码卡前卡控。
 * 老项目缺少契约文件或 PRD 无状态行时默认放行，保持兼容。
 */
export function checkTeamDispatchGates(input: {
  role: string
  prdText?: string | null
  contractText?: string | null
}): TeamGateResult {
  if (canonicalTeamRole(input.role) !== 'Builder') return { ok: true }
  if (input.prdText) {
    const status = extractDocStatus(input.prdText)
    if (status && !status.startsWith('已确认')) {
      return {
        ok: false,
        gate: 'gate1_prd',
        message: `Gate 1 未通过：PRD.md 当前状态为「${status}」，需与主人确认并将状态改为「已确认」后再派发 Builder`,
      }
    }
  }
  if (input.contractText) {
    const status = extractDocStatus(input.contractText)
    if (status && !status.startsWith('已冻结')) {
      return {
        ok: false,
        gate: 'gate2_contract',
        message: `Gate 2 未通过：02-方案契约.md 当前状态为「${status}」，需冻结并将状态改为「已冻结」后再派发 Builder`,
      }
    }
    const secMatch = input.contractText.match(/^##\s*2\.[^\r\n]*([\s\S]*?)(?=\r?\n##\s|$)/m)
    if (secMatch) {
      const unchecked = (secMatch[1].match(/(?:\|\s*\[\s*\]\s*\||^\s*[-*]\s*\[\s*\])/gm) ?? []).length
      if (unchecked > 0) {
        return {
          ok: false,
          gate: 'gate2_hard_gate',
          message: `Gate 2 未通过：02-方案契约.md 中仍有 ${unchecked} 项开工硬门禁未勾选（[ ]）`,
        }
      }
    }
  }
  return { ok: true }
}

/**
 * 从错题本 / 品味账本截取最近有效记录，注入到派发提示词中。
 */
export function extractRecentMemorySnippet(
  markdown: string | null | undefined,
  maxLines = 12,
  maxChars = 1200,
): string {
  const raw = normalizeEol(String(markdown ?? '')).trim()
  if (!raw) return ''
  const marker = raw.indexOf(`${LF}## 记录`)
  const body = marker >= 0 ? raw.slice(marker + `${LF}## 记录`.length) : raw
  const lines = body
    .split(LF)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('>'))
  if (!lines.length) return ''
  const selected = lines.slice(-maxLines).join(LF)
  return selected.length > maxChars ? selected.slice(-maxChars) : selected
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
    if (input.task.branch || input.task.worktreePath || input.task.ownedPaths.length) {
      lines.push('', '## 执行隔离与边界')
      if (input.task.branch) lines.push(`- 独立分支：\`${input.task.branch}\``)
      if (input.task.worktreePath) lines.push(`- 独立工作区：\`${input.task.worktreePath}\``)
      if (input.task.ownedPaths.length) lines.push(`- 允许修改的文件边界：${input.task.ownedPaths.map((p) => `\`${p}\``).join('、')}`)
    }
    if (input.task.acceptance.length) {
      lines.push('', '## 验收标准（逐项给实际结果与证据）', '')
      for (const item of input.task.acceptance) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`)
    }
  }
  if (input.lessonsSnippet) {
    lines.push('', '## 历史错题提醒（来自错题本，避免再踩坑）', '', input.lessonsSnippet)
  }
  if (input.tasteSnippet && (role === 'Builder' || role === 'Designer' || role === 'Verifier')) {
    lines.push('', '## 主人审美与品味偏好（来自品味账本）', '', input.tasteSnippet)
  }
  lines.push(
    '',
    '## 工作约定（硬规则）',
    '',
    '- 只做这张卡/这段对话的范围；需要扩大范围、改需求、动权限或数据规则时，先停下说明，等确认。',
    '- 看板用 `team_board` 工具写（`action=move_task` 改状态、`action=comment` 留回执）：只动自己这张卡；不要手改 `看板/当前批次.md`，不要动其它卡或 `角色配置.json`，派发与落账由宿主写入。',
    '- 需要主人拍板才能做的动作（外发消息、删数据、改权限、花钱、发布）：`team_board action=move_task status=阻塞 blockType=待用户确认`，再 `action=comment` 写明「<一句话动作> · <为什么需要批准>」，然后停下等批准；不要自己代主人决定。',
    '- 结束时在回复末尾写两行：`交付摘要：…` 与 `验证：…（实际命令/截图路径；没做就写 unverified）`。',
    '- 缺环境、缺工具、需要用户决定时直接说清阻塞点和下一步，不要用「应该可以」代替实际验证。',
  )
  return lines.join(LF)
}

/**
 * 独立 Verifier 审查提示词：隔离上下文，不看执行者聊天记录，
 * 只看方案契约、冻结原型/设计稿、任务验收项、Worktree Diff 与实测/截图证据，
 * 强制通过 `team_board action=review_verdict` 提交裁决。
 */
export function buildTeamReviewPrompt(input: {
  batch: string
  goal: string
  task: TeamTask
  specRelativeDir?: string
  lessonsSnippet?: string
  tasteSnippet?: string
}): string {
  const spec = input.specRelativeDir || TEAM_SPEC_RELATIVE_DIR
  const lines: string[] = [
    '# 角色：Verifier（独立质检裁判）',
    '',
    '## 你的核心规则',
    ...ROLE_CORE_RULES.Verifier.map((rule) => `- ${rule}`),
    '',
    '## 审查上下文',
    `- 项目规范目录：\`${spec}\``,
    `- 当前批次：${input.batch || '当前批次'}`,
  ]
  if (input.goal) lines.push(`- 本轮目标：${input.goal}`)
  lines.push(
    '- 请对照 `02-方案契约.md`、`PRD.md` 及 `设计/`（如有冻结原型或设计稿）独立验证本卡交付质量。',
    `- 当前返工轮次：${input.task.reworkCount}/${TEAM_MAX_REWORK_ROUNDS}（连续 ${TEAM_MAX_REWORK_ROUNDS} 轮不通过将自动熔断交主人拍板）。`,
    '',
    `# 待审查任务卡（${input.task.id}）`,
    '',
    '```markdown',
    input.task.raw.trim() || `${input.task.id} ${input.task.title}`,
    '```',
  )
  if (input.task.branch || input.task.worktreePath || input.task.ownedPaths.length) {
    lines.push('', '## 代码变更定位')
    if (input.task.branch) lines.push(`- 任务分支：\`${input.task.branch}\``)
    if (input.task.worktreePath) lines.push(`- 工作区路径：\`${input.task.worktreePath}\``)
    if (input.task.ownedPaths.length) {
      lines.push(`- 预期文件边界：${input.task.ownedPaths.map((p) => `\`${p}\``).join('、')}（检查是否有越界修改）`)
    }
  }
  if (input.task.acceptance.length) {
    lines.push('', '## 验收标准（逐项实测核对）')
    for (const item of input.task.acceptance) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`)
  }
  if (input.lessonsSnippet) {
    lines.push('', '## 历史错题提醒（重点检查是否复发）', '', input.lessonsSnippet)
  }
  if (input.tasteSnippet) {
    lines.push('', '## 主人审美与品味标准', '', input.tasteSnippet)
  }
  lines.push(
    '',
    '## 裁决要求（必做）',
    '- 先检查 `git diff` / `git status`、运行实际测试/构建命令，有 UI 时核对页面实际效果与截图。',
    '- 验证完成后，**必须**调用 `team_board` 提交裁决：',
    `  • 全部达标：\`action="review_verdict" taskId="${input.task.id}" verdict="pass" summary="一句话通过结论"\``,
    `  • 存在缺陷：\`action="review_verdict" taskId="${input.task.id}" verdict="reject" summary="核心问题概述" issues=["具体缺陷1（含文件/复现路径）", "具体缺陷2"]\``,
    '- 不要只口头回复，不调用 `review_verdict` 无法推进看板状态或触发自动返工。',
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
  ownedPaths?: string[]
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
  const title = sanitizeTeamText(draft.title, 200)
  if (!title) return { ok: false, reason: 'empty_title' }
  const raw = String(markdown ?? '')
  const eol = raw.includes(CRLF) ? CRLF : LF
  let md = normalizeEol(raw)
  const id = nextTeamTaskId(tasks)
  const status = normalizeTeamStatus(draft.status ?? '待办')
  const role = canonicalTeamRole(draft.role)
  const summary = sanitizeTeamText(draft.note, 300)
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

  const dependsOn = (draft.dependsOn ?? []).map((dep) => sanitizeTeamText(dep, 20)).filter(Boolean)
  const ownedPaths = (draft.ownedPaths ?? []).map((p) => sanitizeTeamText(p, 200)).filter(Boolean)
  const acceptance = (draft.acceptance ?? []).map((item) => sanitizeTeamText(item, 300)).filter(Boolean)
  const wave = sanitizeTeamText(draft.wave, 80)
  const input = sanitizeTeamText(draft.input, 2000)
  const output = sanitizeTeamText(draft.output, 2000)
  const card: string[] = [`### ${id} ${title}`, '', `- 角色：${role}`, `- 状态：${status}`]
  if (wave) card.push(`- 波次：${wave}`)
  if (input) card.push(`- 输入：${input}`)
  if (output) card.push(`- 产出：${output}`)
  if (dependsOn.length) card.push(`- 依赖：${dependsOn.join('、')}`)
  if (ownedPaths.length) card.push(`- 文件边界：${ownedPaths.join('、')}`)
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
  const head = [
    `你是本项目团队的${role}。`,
    `项目规范目录：${spec}（相对项目根目录）。当前批次：${input.batch || '当前批次'}${input.goal ? `；本轮目标：${input.goal}` : ''}。`,
    '先读 `00-总入口.md` 与 `PRD.md` 里与你职责相关的章节（存在才读），然后等待主人的具体指示。',
  ]
  // Leader 是总控与 S 级独行侠；M/L 级使用 team_board 拆卡并并发派发。
  const leader = [
    '先做 Gate 0 复杂度路由并一句话报备（主人可随时覆写）：',
    '• S 级（小 Bug、文案、配置、单文件改动）：直接自己在当前工作区修改并自检交付，不要建卡也不要派发。',
    '• M 级（小功能、单页维护、跨 2~5 文件）：先确认一页轻契约，可自己做或拆 1~3 张卡派发。',
    '• L 级（新项目/大模块/多模块并发）：确认 PRD（有 UI 时先走 Designer 出稿/HTML 原型→设计稿/多版式并冻结）→ 冻结技术契约与公共骨架 → 按模块纵向拆卡（带 `ownedPaths` 文件边界与可验证 `acceptance`）并用 `team_board action=dispatch` 并发派发给 `Builder`。',
    '卡一旦派发给 `Builder`，执行在独立 Worktree 进行，你不要自己抢写那张卡的业务代码；卡片进入 `已通过` 后可用 `team_board action=merge_task` 一键合并。',
    '动手前先 action=snapshot 看清现有卡与依赖；有依赖的卡等前置进入 `已通过` 或 `已验收` 再派。',
    '`已验收` 只能由主人人工确认；看板只通过 `team_board` 写，不要手改 `看板/当前批次.md` 或 `角色配置.json`。',
  ]
  const others = [
    '收到具体任务后先确认范围、契约与验收标准；需要扩范围、改需求或用户决定时停下说明。',
    '`team_board` 可以用来读自己的卡（action=snapshot）和写一句备注（action=comment）；改状态、派发与验收由主人和宿主完成，不要自己动。',
    '看板只通过 `team_board` 写，不要手改 `看板/当前批次.md` 或 `角色配置.json`。',
  ]
  return [...head, ...(role === 'Leader' ? leader : others)].join(LF)
}
