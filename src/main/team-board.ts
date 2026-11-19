/**
 * 工作团队看板的主进程数据层。
 *
 * 不碰 Electron、不起子进程、不复制第二份数据：
 *   - 看板：`<workspace>/.文档/开发规范/看板/当前批次.md`（与 DSH flow-board 同格式）
 *   - 角色：`<workspace>/.文档/开发规范/角色配置.json`（项目级，附 .md 人读镜像）
 *   - 派发记录：`<workspace>/.文档/开发规范/协作/团队.json`（会话映射 + 运行记录）
 *
 * 写看板时使用与 flow-board 相同的锁目录（`看板/轮次/.更新锁`，没有轮次目录时退回
 * `看板/.更新锁`），两个工具同时开着也不会互相覆盖；读-改-写全程同步，避免
 * await 之间拿到过期快照。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  TEAM_BOARD_RELATIVE_PATH,
  TEAM_SPEC_RELATIVE_DIR,
  TEAM_STATE_RELATIVE_PATH,
  canonicalTeamRole,
  defaultTeamRoleBindings,
  emptyTeamState,
  isTeamRole,
  normalizeTeamRoleBindings,
  appendTeamTask,
  parseTeamBoard,
  updateTeamTaskStatus,
  type TeamBoard,
  type TeamRole,
  type TeamRoleBinding,
  type TeamRun,
  type TeamRunStatus,
  type TeamSnapshot,
  type TeamState,
  type TeamStatus,
  type TeamStatusWriteInput,
  type TeamTaskDraft,
} from '@shared/team-board'

export function teamSpecPath(workspaceRoot: string): string {
  return join(String(workspaceRoot || '').trim(), TEAM_SPEC_RELATIVE_DIR)
}

export function teamBoardPath(workspaceRoot: string): string {
  return join(teamSpecPath(workspaceRoot), TEAM_BOARD_RELATIVE_PATH)
}

function textFile(path: string): string | null {
  try {
    if (statSync(path).size > 2 * 1024 * 1024) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function jsonFile<T>(path: string, fallback: T): T {
  const text = textFile(path)
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
  } finally {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp)
      } catch {
        /* noop */
      }
    }
  }
}

const sleepSync = (ms: number): void => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const end = Date.now() + ms
    while (Date.now() < end) {
      /* spin fallback */
    }
  }
}

/**
 * 跨进程文件锁（与 flow-board 的 locked() 同款）：目录锁 + 60s 过期 +
 * 同进程重入。只包住同步的读-改-写，不做跨 await 持锁。
 */
function withLock<T>(lockRoot: string, action: () => T): T {
  mkdirSync(lockRoot, { recursive: true })
  const lock = join(lockRoot, '.更新锁')
  const owner = join(lock, 'owner.json')
  let acquired = false
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      mkdirSync(lock)
      acquired = true
      break
    } catch {
      let stale = false
      let sameProcess = false
      try {
        const entry = JSON.parse(readFileSync(owner, 'utf8')) as { pid?: number; at?: number }
        if (entry.pid === process.pid) sameProcess = true
        if (entry.at && Date.now() - entry.at > 60_000) stale = true
        else if (entry.pid && entry.pid !== process.pid) {
          try {
            process.kill(entry.pid, 0)
          } catch (error) {
            stale = (error as NodeJS.ErrnoException).code === 'ESRCH'
          }
        }
      } catch {
        /* owner.json 正在写入或已释放 */
      }
      if (!stale) {
        try {
          stale = Date.now() - statSync(lock).mtimeMs > 60_000
        } catch {
          continue
        }
      }
      if (stale) {
        try {
          if (existsSync(owner)) unlinkSync(owner)
        } catch {
          /* noop */
        }
        try {
          rmdirSync(lock)
        } catch {
          /* noop */
        }
        continue
      }
      if (sameProcess) break
      sleepSync(20)
    }
  }
  if (!acquired) throw new Error('看板正在被另一个进程更新，请稍后重试')
  writeFileSync(owner, JSON.stringify({ pid: process.pid, at: Date.now() }))
  try {
    return action()
  } finally {
    try {
      unlinkSync(owner)
    } catch {
      /* noop */
    }
    try {
      rmdirSync(lock)
    } catch {
      /* noop */
    }
  }
}

/** 有轮次目录时用 flow-board 同一把锁，避免两个进程各锁各的。 */
function boardLockRoot(spec: string): string {
  const rounds = join(spec, '看板', '轮次')
  return existsSync(rounds) ? rounds : join(spec, '看板')
}

/* ---------------- 角色配置 ---------------- */

export function readTeamRoles(spec: string): TeamRoleBinding[] {
  const parsed = jsonFile<{ roles?: unknown }>(join(spec, '角色配置.json'), {})
  return normalizeTeamRoleBindings(parsed.roles)
}

function rolesMarkdown(roles: TeamRoleBinding[]): string {
  return [
    '# 角色配置（角色 → 模型 / 思考深度）',
    '',
    '> 由 pi Desktop「工作团队」面板维护（仅影响本项目），本文件是同步出来的人读镜像。',
    '> 换模型 / 思考深度在面板上改即可，不用手改本文件。',
    '',
    '| 角色 | 模型 | 思考深度 | 自动派发 | 直接对话 | 汇报频率 | 说明 |',
    '|------|------|----------|----------|----------|----------|------|',
    ...roles.map(
      (role) =>
        `| ${role.role} | ${role.model || '未绑定'} | ${role.effort || '默认'} | ${role.enabled ? '开启' : '禁用'} | ${role.directEnabled ? '开启' : '禁用'} | meaningful | ${role.note} |`,
    ),
    '',
    '## 派发约定',
    '',
    '- 点角色头像进入对应角色会话；卡片上的「派发开工」会新建一个后台会话，不打断当前对话。',
    '- 模型与思考深度由面板统一维护；会话结束时面板把卡片推进到「待审查」。',
    '- 未实测、缺环境或需要用户决定的事项必须写清，不能用「应该可以」代替通过。',
    '',
  ].join('\n')
}

export function saveTeamRoles(spec: string, input: unknown): TeamRoleBinding[] {
  const roles = normalizeTeamRoleBindings(input)
  // 保留 flow-board 加的 refs/notifications 等面板不认识的字段：
  // 两个工具共用同一份项目配置，面板只改自己负责的列，不能把别人的设置抹掉。
  const existing = jsonFile<{ roles?: Array<Record<string, unknown>> }>(join(spec, '角色配置.json'), {})
  const previous = new Map<string, Record<string, unknown>>()
  for (const item of existing.roles ?? []) {
    if (!item || typeof item !== 'object') continue
    const role = canonicalTeamRole(item.role)
    if (role) previous.set(role, item)
  }
  const merged = roles.map((role) => ({ ...(previous.get(role.role) ?? {}), ...role }))
  mkdirSync(spec, { recursive: true })
  writeAtomic(join(spec, '角色配置.json'), `${JSON.stringify({ version: 2, scope: 'project', roles: merged }, null, 2)}\n`)
  try {
    writeAtomic(join(spec, '角色配置.md'), rolesMarkdown(roles))
  } catch {
    /* 镜像写失败不影响 JSON 真相 */
  }
  return roles
}

/* ---------------- 派发记录 ---------------- */

const RUN_STATUSES: TeamRunStatus[] = ['starting', 'running', 'done', 'failed', 'cancelled']

function normalizeRun(value: unknown): TeamRun | null {
  if (!value || typeof value !== 'object') return null
  const run = value as Record<string, unknown>
  if (typeof run.sessionFile !== 'string' || !run.sessionFile) return null
  const role = canonicalTeamRole(run.role)
  const status = String(run.status ?? '') as TeamRunStatus
  return {
    id: typeof run.id === 'string' && run.id ? run.id : randomUUID(),
    taskId: typeof run.taskId === 'string' ? run.taskId : '',
    role,
    sessionFile: run.sessionFile,
    ...(typeof run.sessionId === 'string' && run.sessionId ? { sessionId: run.sessionId } : {}),
    status: RUN_STATUSES.includes(status) ? status : 'done',
    startedAt: typeof run.startedAt === 'number' ? run.startedAt : 0,
    ...(typeof run.endedAt === 'number' ? { endedAt: run.endedAt } : {}),
    ...(typeof run.settledTo === 'string' ? { settledTo: run.settledTo as TeamStatus } : {}),
  }
}

export function readTeamState(spec: string): TeamState {
  const parsed = jsonFile<Partial<TeamState>>(join(spec, TEAM_STATE_RELATIVE_PATH), emptyTeamState())
  const sessions: TeamState['sessions'] = {}
  if (parsed.sessions && typeof parsed.sessions === 'object') {
    for (const [role, value] of Object.entries(parsed.sessions)) {
      const canonical = canonicalTeamRole(role)
      if (!isTeamRole(canonical) || !value || typeof value !== 'object') continue
      const entry = value as { sessionFile?: unknown; sessionId?: unknown; updatedAt?: unknown }
      if (typeof entry.sessionFile !== 'string' || !entry.sessionFile) continue
      sessions[canonical] = {
        sessionFile: entry.sessionFile,
        ...(typeof entry.sessionId === 'string' && entry.sessionId ? { sessionId: entry.sessionId } : {}),
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
      }
    }
  }
  const runs: TeamRun[] = Array.isArray(parsed.runs)
    ? parsed.runs.map(normalizeRun).filter((run): run is TeamRun => !!run).slice(-200)
    : []
  return { version: 1, sessions, runs }
}

function writeTeamState(spec: string, state: TeamState): void {
  mkdirSync(join(spec, '协作'), { recursive: true })
  writeAtomic(join(spec, TEAM_STATE_RELATIVE_PATH), `${JSON.stringify(state, null, 2)}\n`)
}

function withTeamState<T>(spec: string, mutate: (state: TeamState) => T): T {
  return withLock(join(spec, '协作'), () => {
    const state = readTeamState(spec)
    const result = mutate(state)
    state.runs = state.runs.slice(-200)
    writeTeamState(spec, state)
    return result
  })
}

export function recordTeamDispatch(
  spec: string,
  input: { taskId: string; role: string; sessionFile: string; sessionId?: string },
): TeamRun {
  const role = canonicalTeamRole(input.role)
  const run: TeamRun = {
    id: randomUUID(),
    taskId: input.taskId,
    role,
    sessionFile: input.sessionFile,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    status: 'starting',
    startedAt: Date.now(),
  }
  // 派发是「一次性任务会话」，不要覆盖角色坞里的常驻角色会话；
  // 常驻会话只由 bindTeamSession 写入，点头像才能回到同一个对话。
  withTeamState(spec, (state) => {
    state.runs.push(run)
  })
  return run
}

/** 提示词已真正发出：把 starting 的派发记录转成 running。 */
export function markTeamRunRunning(spec: string, sessionFile: string): void {
  withTeamState(spec, (state) => {
    for (let i = state.runs.length - 1; i >= 0; i--) {
      const run = state.runs[i]
      if (run.sessionFile !== sessionFile) continue
      if (run.status !== 'starting') continue
      run.status = 'running'
      break
    }
  })
}

export function bindTeamSession(
  spec: string,
  roleValue: string,
  session: { sessionFile: string; sessionId?: string },
): TeamRole | null {
  const role = canonicalTeamRole(roleValue)
  if (!isTeamRole(role)) return null
  withTeamState(spec, (state) => {
    state.sessions[role] = {
      sessionFile: session.sessionFile,
      ...(session.sessionId ? { sessionId: session.sessionId } : {}),
      updatedAt: Date.now(),
    }
  })
  return role
}

/* ---------------- 看板读写 ---------------- */

export function snapshotFor(spec: string, workspaceId: string): TeamSnapshot {
  const boardFile = join(spec, TEAM_BOARD_RELATIVE_PATH)
  const exists = existsSync(boardFile)
  let board: TeamBoard = { batch: '当前批次', goal: '', tasks: [] }
  if (exists) {
    const markdown = textFile(boardFile) ?? ''
    board = parseTeamBoard(markdown)
  }
  const state = readTeamState(spec)
  return {
    workspaceId,
    specPath: spec,
    boardFile,
    exists,
    batch: board.batch,
    goal: board.goal,
    tasks: board.tasks,
    roles: readTeamRoles(spec),
    sessions: state.sessions,
    runs: state.runs,
  }
}

export function readTeamSnapshot(workspaceRoot: string): TeamSnapshot {
  return snapshotFor(teamSpecPath(workspaceRoot), workspaceRoot)
}

export type TeamStatusWriteOutcome =
  | { ok: true; from: TeamStatus; changed: boolean; snapshot: TeamSnapshot }
  | { ok: false; reason: 'status_mismatch'; current: TeamStatus }
  | { ok: false; reason: 'task_not_found' | 'index_row_missing' }

/**
 * 面板改状态：加锁读-改-写，`from` 不匹配就返回冲突让前端刷新，绝不静默覆盖。
 */
export type TeamTaskStatusRequest = Omit<TeamStatusWriteInput, 'id'> & { taskId: string }

export function setTeamTaskStatus(
  workspaceRoot: string,
  request: TeamTaskStatusRequest,
): TeamStatusWriteOutcome {
  const input: TeamStatusWriteInput = { ...request, id: request.taskId }
  return setTeamTaskStatusInSpec(teamSpecPath(workspaceRoot), workspaceRoot, input)
}

function setTeamTaskStatusInSpec(
  spec: string,
  workspaceId: string,
  input: TeamStatusWriteInput,
): TeamStatusWriteOutcome {
  const boardFile = join(spec, TEAM_BOARD_RELATIVE_PATH)
  return withLock(boardLockRoot(spec), () => {
    const markdown = textFile(boardFile)
    if (markdown == null) return { ok: false as const, reason: 'task_not_found' as const }
    const result = updateTeamTaskStatus(markdown, input)
    if (!result.ok) {
      return result.reason === 'status_mismatch'
        ? { ok: false as const, reason: 'status_mismatch' as const, current: result.current ?? ('待办' as TeamStatus) }
        : { ok: false as const, reason: result.reason }
    }
    if (result.changed) writeAtomic(boardFile, result.markdown)
    return {
      ok: true as const,
      from: result.from,
      changed: result.changed,
      snapshot: snapshotFor(spec, workspaceId),
    }
  })
}

export type TeamSettleOutcome = {
  settled: boolean
  run?: TeamRun
  movedTo?: TeamStatus | null
}

/**
 * 会话结束落账：成功且卡片仍在「进行中」→「待审查」；失败/中止只记回执，
 * 不动状态（人要知道这轮没交付，不能假装有产物）。
 */
export function settleTeamRun(
  spec: string,
  workspaceId: string,
  sessionFile: string,
  outcome: 'success' | 'failed' | 'cancelled',
): TeamSettleOutcome {
  const settledRun = withTeamState(spec, (state) => {
    for (let i = state.runs.length - 1; i >= 0; i--) {
      const run = state.runs[i]
      if (run.sessionFile !== sessionFile) continue
      if (run.status !== 'starting' && run.status !== 'running') continue
      run.status = outcome === 'success' ? 'done' : outcome
      run.endedAt = Date.now()
      return { ...run }
    }
    return null
  })
  if (!settledRun) return { settled: false }

  const board = parseTeamBoard(textFile(join(spec, TEAM_BOARD_RELATIVE_PATH)) ?? '')
  const task = board.tasks.find((item) => item.id === settledRun.taskId)
  if (!task) return { settled: true, run: settledRun, movedTo: null }

  if (outcome === 'success') {
    if (task.status !== '进行中') return { settled: true, run: settledRun, movedTo: null }
    const result = setTeamTaskStatusInSpec(spec, workspaceId, {
      id: settledRun.taskId,
      to: '待审查',
      from: '进行中',
      autoNote: `${settledRun.role} 会话已结束，等待审查`,
    })
    if (!result.ok) return { settled: true, run: settledRun, movedTo: null }
    withTeamState(spec, (state) => {
      const target = state.runs.find((item) => item.id === settledRun!.id)
      if (target) target.settledTo = '待审查'
    })
    return { settled: true, run: { ...settledRun, settledTo: '待审查' }, movedTo: '待审查' }
  }

  const label = outcome === 'failed' ? '本轮执行失败/中止' : '本轮被取消'
  setTeamTaskStatusInSpec(spec, workspaceId, {
    id: settledRun.taskId,
    to: task.status,
    from: task.status,
    autoNote: `${settledRun.role} ${label}，请核对产物后重试`,
  })
  return { settled: true, run: settledRun, movedTo: null }
}

/** 面板建卡：和状态写回共用同一把看板锁，编号按现有最大 T-xxx 递增。 */
export function createTeamTask(workspaceRoot: string, draft: TeamTaskDraft): TeamSnapshot {
  const spec = teamSpecPath(workspaceRoot)
  const boardFile = join(spec, TEAM_BOARD_RELATIVE_PATH)
  return withLock(boardLockRoot(spec), () => {
    const markdown = textFile(boardFile)
    if (markdown == null) throw new Error('当前项目还没有看板，请先初始化')
    const result = appendTeamTask(markdown, draft, parseTeamBoard(markdown).tasks)
    if (!result.ok) throw new Error('任务标题不能为空')
    writeAtomic(boardFile, result.markdown)
    return snapshotFor(spec, workspaceRoot)
  })
}

/* ---------------- 初始化 ---------------- */

const BOARD_TEMPLATE = `# 看板：当前批次

> 正式任务进度依据。任务和批次信息由团队维护；看板状态以本文件为准。

## 批次信息

- 当前批次：需求梳理
- 目标：先与 Leader 确认需求；PRD 确认后拆解任务并开工。

## 任务索引

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|------|------|------|------|--------|

---

## 卡片详情

暂无任务。PRD 确认后，由 Leader 拆解并创建真实任务卡。

---

## 归档规则

轮次完成后新建批次；完整报告与证据保留在 \`协作/\` 下，按需读取。
`

const NEW_PRD_TEMPLATE = `# PRD

> 状态：草稿（Leader 与用户确认后把「状态」改为「已确认」再开工）

## 1. 背景与目标

- 要解决什么问题：
- 目标用户：
- 成功标准：

## 2. 用户与场景

## 3. 功能清单

- [ ] 功能一：
- [ ] 功能二：

## 4. 页面与交互

## 5. 数据与接口

## 6. 技术栈（四项缺一不可）

- 前端：
- 后端：
- 数据库：
- 服务器系统（含运行环境与部署方式）：

## 7. 权限与安全

## 8. 验收标准

- [ ] 可验证的验收项：

## 9. 不做的事

`

const LEGACY_PRD_TEMPLATE = `# PRD（老项目接管 · 待盘点）

> 状态：待盘点（Leader 完成代码盘点并补全下面四节后，才能进入开发）

## 现状盘点（待 Leader 按代码补全）

- 技术栈：
- 已有功能清单：
- 运行与部署方式：

## 技术栈（现状 + 本次确认，四项缺一不可）

- 前端：
- 后端：
- 数据库：
- 服务器系统（含运行环境与部署方式）：

## 本次优化目标与范围

- 目标：
- 改动范围（目录）：
- 不做的事：

## 验收标准

- [ ] （逐条可验证，例如：某页面在某操作下表现如何）
`

const ENTRY_TEMPLATE = `# {项目名} · 开发总入口

> 团队开工先读这里，再按需读 PRD、看板与清单；不要通读整套资料。

## 项目

- 名称：{项目名}
- 看板：\`看板/当前批次.md\`
- 需求：\`PRD.md\`
- 角色：\`角色配置.json\`（模型与思考深度在「工作团队」面板维护）

## 工作节奏

1. Leader 确认需求与技术栈，把 PRD 状态改为「已确认」。
2. 拆任务卡：一张卡只做一件事，写清输入、产出、依赖与验收标准。
3. 面板派发 → 角色在后台会话开工 → 会话结束卡片进「待审查」。
4. 质量测试独立验证；人工决定「实现完成 / 已验收」。
5. 出错写 \`错题本.md\`；审美与取舍写 \`品味账本.md\`。

## 目录

- \`看板/\` 任务与轮次
- \`设计/\` 设计稿与资源
- \`协作/\` 派发记录、验证证据
`

const LESSONS_TEMPLATE = `# 错题本

> 同一个坑不要踩两次。每次事故/返工写一条：现象 → 根因 → 修正 → 防再犯。

## 记录

`

const TASTE_TEMPLATE = `# 品味账本

> 记录用户明确表达过的审美与取舍：喜欢什么、不喜欢什么、为什么。

## 记录

`

export function initTeamProject(
  workspaceRoot: string,
  options: { mode?: 'new' | 'legacy'; name?: string } = {},
): TeamSnapshot {
  const root = String(workspaceRoot || '').trim()
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) throw new Error('当前工作区目录不可用，请重新选择工作区')
  const spec = teamSpecPath(root)
  const boardFile = join(spec, TEAM_BOARD_RELATIVE_PATH)
  if (existsSync(boardFile)) throw new Error('该项目已初始化看板；已有 PRD、任务与记录不会覆盖')
  mkdirSync(join(spec, '看板'), { recursive: true })
  mkdirSync(join(spec, '设计'), { recursive: true })
  mkdirSync(join(spec, '协作'), { recursive: true })
  const name = String(options.name || basename(root) || '项目').trim()
  const legacy = options.mode === 'legacy'
  const files: Record<string, string> = {
    [boardFile]: BOARD_TEMPLATE,
    [join(spec, '00-总入口.md')]: ENTRY_TEMPLATE.replaceAll('{项目名}', name),
    [join(spec, 'PRD.md')]: legacy ? LEGACY_PRD_TEMPLATE : NEW_PRD_TEMPLATE,
    [join(spec, '错题本.md')]: LESSONS_TEMPLATE,
    [join(spec, '品味账本.md')]: TASTE_TEMPLATE,
  }
  for (const [path, content] of Object.entries(files)) {
    if (existsSync(path)) continue
    writeAtomic(path, content)
  }
  if (!existsSync(join(spec, '角色配置.json'))) saveTeamRoles(spec, defaultTeamRoleBindings())
  return snapshotFor(spec, root)
}
