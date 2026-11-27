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
import { configStore } from './config-store'
import { parseTeamState } from './team-board-state'
import { readPiAgentGlobalSettingsFromDisk } from './pi-agent-settings-read'
import {
  TEAM_BOARD_RELATIVE_PATH,
  TEAM_RUN_STALE_MS_DEFAULT,
  TEAM_SPEC_RELATIVE_DIR,
  TEAM_STATE_RELATIVE_PATH,
  canonicalTeamRole,
  clampTeamConcurrency,
  defaultTeamRoleBindings,
  isTeamRole,
  isTeamRunActive,
  normalizeTeamRoleBindings,
  appendTeamTask,
  parseTeamBoard,
  resolveTeamApproval,
  sanitizeTeamText,
  updateTeamTaskStatus,
  type TeamBoard,
  type TeamRole,
  type TeamRoleBinding,
  type TeamRun,
  type TeamRunReportKind,
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

export function readTeamState(spec: string): TeamState {
  return parseTeamState(textFile(join(spec, TEAM_STATE_RELATIVE_PATH)) ?? '')
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
  input: { taskId: string; role: string; sessionFile: string; sessionId?: string; worktreePath?: string; branch?: string },
): TeamRun {
  const role = canonicalTeamRole(input.role)
  const run: TeamRun = {
    id: randomUUID(),
    taskId: input.taskId,
    role,
    sessionFile: input.sessionFile,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.worktreePath ? { worktreePath: sanitizeTeamText(input.worktreePath, 500) } : {}),
    ...(input.branch ? { branch: sanitizeTeamText(input.branch, 120) } : {}),
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
  const defaultModelOverride = configStore.get('teamDefaultModel') || ''
  const settings = exists ? readPiAgentGlobalSettingsFromDisk() : null
  const provider = typeof settings?.defaultProvider === 'string' ? settings.defaultProvider.trim() : ''
  const model = typeof settings?.defaultModel === 'string' ? settings.defaultModel.trim() : ''
  const globalDefaultModel = provider && model ? `${provider}/${model}` : ''
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
    defaultModelOverride,
    globalDefaultModel,
    defaultModel: defaultModelOverride || globalDefaultModel,
    maxConcurrency: clampTeamConcurrency(configStore.get('teamMaxConcurrency')),
    autoReview: configStore.get('teamAutoReview') === true,
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

export type TeamSettleOptions = {
  /** 写进 report.text 的一句话回执 */
  note?: string
  /** 人工点「结束这次派发」还是宿主自动落账 */
  closedBy?: 'human' | 'host'
  /** 只关记录不动看板（例如被新派发替代时，卡片的说明已经由看门狗写过） */
  silent?: boolean
}

const SETTLE_REPORT: Record<'success' | 'failed' | 'cancelled', { kind: TeamRunReportKind; text: string }> = {
  success: { kind: 'ready', text: '会话已结束，等待审查' },
  failed: { kind: 'failed', text: '本轮执行失败/中止' },
  cancelled: { kind: 'blocked', text: '本轮被取消' },
}

/**
 * 会话结束落账：成功且卡片仍在「进行中」→「待审查」；失败/中止只记回执，
 * 不动状态（人要知道这轮没交付，不能假装有产物）。
 *
 * 落账只在 starting/running 上生效：重复事件（settled + completion）与看门狗后到的
 * 定时器都不能二次改写已结算的记录或已验证的卡片。
 */
export function settleTeamRun(
  spec: string,
  workspaceId: string,
  sessionFile: string,
  outcome: 'success' | 'failed' | 'cancelled',
  options: TeamSettleOptions = {},
): TeamSettleOutcome {
  const settledAt = Date.now()
  const settledRun = withTeamState(spec, (state) => {
    for (let i = state.runs.length - 1; i >= 0; i--) {
      const run = state.runs[i]
      if (run.sessionFile !== sessionFile) continue
      if (!isTeamRunActive(run)) continue
      run.status = outcome === 'success' ? 'done' : outcome
      run.endedAt = settledAt
      delete run.staleAt
      const fallback = SETTLE_REPORT[outcome]
      run.report = {
        kind: fallback.kind,
        text: sanitizeTeamText(options.note, 300) || fallback.text,
        at: settledAt,
        verdict: 'deliver',
      }
      if (options.closedBy) run.closedBy = options.closedBy
      return { ...run }
    }
    return null
  })
  if (!settledRun) return { settled: false }
  if (options.silent) return { settled: true, run: settledRun, movedTo: null }

  const board = parseTeamBoard(textFile(join(spec, TEAM_BOARD_RELATIVE_PATH)) ?? '')
  const task = board.tasks.find((item) => item.id === settledRun.taskId)
  if (!task) return { settled: true, run: settledRun, movedTo: null }
  // 已经有待批事项的卡不自动推进：人在等一个决定，不是等一次落账。
  if (task.approval) return { settled: true, run: settledRun, movedTo: null }

  if (canonicalTeamRole(settledRun.role) === 'Verifier') {
    if (outcome === 'success' && task.status === '待审查') {
      setTeamTaskStatusInSpec(spec, workspaceId, {
        id: settledRun.taskId,
        to: task.status,
        from: task.status,
        autoNote: 'Verifier 会话已结束但未提交裁决，请核对会话后手动裁决或重派审查',
      })
    }
    return { settled: true, run: settledRun, movedTo: null }
  }

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

/* ---------------- 看门狗：派发有没有死在半路 ---------------- */

export type TeamSweepOutcome = {
  /** 当前所有被判定超时的派发（含之前已经标过的） */
  stale: TeamRun[]
  /** 本次因此被移到「阻塞 / 待用户确认」的卡片 */
  blocked: string[]
  snapshot: TeamSnapshot
}

/** 会话文件最后写入时间与启动时间取大者：文件不再增长 = 这轮没人推进了。 */
function lastActivityOf(run: TeamRun): number {
  let last = Number.isFinite(run.startedAt) ? run.startedAt : 0
  try {
    const mtime = statSync(run.sessionFile).mtimeMs
    if (Number.isFinite(mtime) && mtime > last) last = mtime
  } catch {
    /* 会话文件不存在/不可读：退回启动时间，重启后的悬空记录靠这个收敛 */
  }
  return last
}

/**
 * 看门狗 tick：把「还在 starting/running、但超过 staleMs 没有任何活动」的派发标为超时，
 * 并把对应的「进行中」卡片移到「阻塞 / 待用户确认」，让人一眼看到哪一轮死在半路。
 *
 * 只标记一次（staleAt）；不伪造失败，不自动重派，不覆盖待批准或已收口的卡。
 */
export function sweepTeamRuns(
  spec: string,
  workspaceId: string,
  options: { staleMs?: number; now?: number } = {},
): TeamSweepOutcome {
  const now = options.now ?? Date.now()
  const staleMs = Math.max(60_000, options.staleMs ?? TEAM_RUN_STALE_MS_DEFAULT)
  const state = readTeamState(spec)
  const fresh = state.runs.filter((run) => isTeamRunActive(run) && !run.staleAt && now - lastActivityOf(run) > staleMs)
  const stale = state.runs.filter((run) => isTeamRunActive(run) && run.staleAt).map((run) => ({ ...run }))

  if (fresh.length) {
    const ids = new Set(fresh.map((run) => run.id))
    withTeamState(spec, (next) => {
      for (const run of next.runs) {
        if (!ids.has(run.id) || run.staleAt) continue
        run.staleAt = now
      }
    })
    stale.push(...fresh.map((run) => ({ ...run, staleAt: now })))
  }

  const blocked: string[] = []
  if (stale.length) {
    const board = parseTeamBoard(textFile(join(spec, TEAM_BOARD_RELATIVE_PATH)) ?? '')
    const minutes = Math.round(staleMs / 60_000)
    // 遍历所有超时记录而不是只遍历刚标记的：上一次看板写失败时（锁冲突）下一 tick 还能补上。
    // 已经在阻塞道的卡不会被再写一次。
    for (const run of stale) {
      const task = board.tasks.find((item) => item.id === run.taskId)
      if (!task || task.status !== '进行中' || task.approval) continue
      const result = setTeamTaskStatusInSpec(spec, workspaceId, {
        id: task.id,
        to: '阻塞',
        from: '进行中',
        blockType: '待用户确认',
        autoNote: `派发超过 ${minutes} 分钟没有结束事件（${run.role}），请核对会话后重新派发`,
      })
      if (result.ok) blocked.push(task.id)
    }
  }

  return { stale, blocked, snapshot: snapshotFor(spec, workspaceId) }
}

/* ---------------- 卡片级审批 ---------------- */

export type TeamApprovalOutcome =
  | { ok: true; from: TeamStatus; to: TeamStatus; request: string; snapshot: TeamSnapshot }
  | { ok: false; reason: 'task_not_found' | 'no_pending_approval' | 'status_mismatch'; current?: TeamStatus }

/**
 * 批准/驳回卡片上的 `- 待批准：`：和执行方申请共用同一份 markdown 字段，
 * 不另建一套数据库；批准后卡片回到「进行中」，驳回留在「阻塞 / 待用户确认」。
 */
export function resolveTeamTaskApproval(
  workspaceRoot: string,
  input: { taskId: string; decision: 'approve' | 'deny'; note?: string; from?: string | null },
): TeamApprovalOutcome {
  const spec = teamSpecPath(workspaceRoot)
  const boardFile = join(spec, TEAM_BOARD_RELATIVE_PATH)
  return withLock(boardLockRoot(spec), () => {
    const markdown = textFile(boardFile)
    if (markdown == null) return { ok: false as const, reason: 'task_not_found' as const }
    const result = resolveTeamApproval(markdown, {
      id: input.taskId,
      decision: input.decision,
      note: input.note,
      from: input.from,
    })
    if (!result.ok) return result
    writeAtomic(boardFile, result.markdown)
    return {
      ok: true as const,
      from: result.from,
      to: result.to,
      request: result.request,
      snapshot: snapshotFor(spec, workspaceRoot),
    }
  })
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

const CONSTITUTION_TEMPLATE = `# {项目名} · 项目宪法（00-宪法）

> 技术栈、目录红线、编码约定与全局硬门禁。长期稳定，不随单次批次频繁改动。

## 1. 技术栈与运行环境

- 前端：
- 后端：
- 数据库：
- 运行与部署：

## 2. 架构红线与代码约定

- 

## 3. 全局硬门禁

- 未通过验收命令与实测证据，禁止标为已通过。
- 禁止密钥或凭证入库。
`

const CONTRACT_TEMPLATE = `# 方案契约（02-方案契约）

> 状态：草稿（Leader 冻结技术方案、UI 模式、公共骨架与文件边界后改为「已冻结」再并发派发）

## 1. UI 准备模式（四选一）

- 当前选择：\`无 UI（跳过）\` / \`直接出设计稿\` / \`HTML 原型 → 设计稿\` / \`单页多版式比选\`
- 冻结产物路径（如有）：\`设计/\` 或 \`原型/\`

## 2. 开工决策与硬门禁

| # | 议题 / 门禁 | 决策 / 解锁条件 | 状态 |
|---|---|---|---|
| 1 | Wave 0 公共骨架（Schema / 共享类型 / 路由） | 先在主干落地再并发拆卡 | [ ] |

## 3. 接口、数据与目录边界（Owned Paths）

- 模块 A：\`src/...\`, 负责人：Builder（T-001）
`

const ENTRY_TEMPLATE = `# {项目名} · 开发总入口

> 团队开工先读这里，再按需读 \`00-宪法.md\`、\`PRD.md\`、\`02-方案契约.md\` 与看板；不要通读整套资料。

## 项目

- 名称：{项目名}
- 宪法：\`00-宪法.md\`
- 需求：\`PRD.md\`
- 契约：\`02-方案契约.md\`
- 看板：\`看板/当前批次.md\`
- 角色：\`角色配置.json\`（模型与思考深度在「工作团队」面板维护）

## 工作节奏（工作团队 2.0）

1. **Gate 0 分级路由**：S 级小活（小 Bug/文案/配置/单文件）由 Leader 在主工作区直接改完自检；M/L 级走协作流程。
2. **需求与 UI 准备**：确认 PRD；有 UI 时由 Designer 按需走「直出稿 / HTML 原型→设计稿 / 单页多版式」并定稿冻结。
3. **契约与底座**：冻结 \`02-方案契约.md\`（含公共骨架与每张卡的 \`文件边界\`），再按模块纵向拆卡。
4. **并发 Worktree 执行**：Leader 派发 \`Builder\` 卡时自动开独立 Git Worktree 并发执行（默认上限 3），卡结束进「待审查」。
5. **独立裁判与合并**：\`Verifier\` 隔离上下文审查后推进到「已通过」（解锁下游依赖，打回原地返工，满 3 轮熔断）；面板或 Leader 一键合并清理 Worktree；主人最终确认「已验收」。
6. 踩坑写 \`错题本.md\`；审美与取舍写 \`品味账本.md\`。

## 目录

- \`看板/\` 任务与轮次
- \`设计/\` 设计稿、原型与资源
- \`协作/\` 派发记录、验证证据

## 看板卡格式（写卡/改卡按这个来）

一张卡 = 索引行 + 详情段，两处一起写：

\`\`\`markdown
| T-004 | 标题 | Builder | 待办 | 一句话 |
\`\`\`

\`\`\`markdown
### T-004 标题

- 角色：Builder
- 状态：待办
- 输入：…
- 产出：…
- 依赖：T-001、T-002
- 文件边界：src/features/xxx/**

- [ ] 可验证的验收标准
\`\`\`

- 编号续写最大 T-xxx +1，不复用、不改旧卡编号。
- 状态只用：\`待办 / 进行中 / 待审查 / 已通过 / 阻塞 / 已验收\`。
- 改状态时索引行与详情段必须同时改，否则面板与看板会不一致。
- 阻塞要写 \`- 阻塞分型：\`（\`待用户确认 / 合并冲突 / 缺环境/工具 / 外部依赖 / 执行失败\`）。

### 需要主人批准时

不要自己决定外发、删数据、改权限、花钱或发布。把自己的卡改成：

\`\`\`markdown
- 状态：阻塞
- 阻塞分型：待用户确认
- 待批准：<一句话动作> · <为什么需要批准>
\`\`\`

然后停下等主人批准。批准后面板会把卡片放回「进行中」并给这轮会话发消息；驳回会留一行 \`- 驳回：\`。

### 收尾回执

派发结束前在回复末尾写两行：\`交付摘要：…\` 与 \`验证：…（实际命令/截图路径；没做就写 unverified）\`。
派发记录、回执与验收由面板统一写入，不要手改 \`协作/团队.json\`。
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
    [join(spec, '00-宪法.md')]: CONSTITUTION_TEMPLATE.replaceAll('{项目名}', name),
    [join(spec, 'PRD.md')]: legacy ? LEGACY_PRD_TEMPLATE : NEW_PRD_TEMPLATE,
    [join(spec, '02-方案契约.md')]: CONTRACT_TEMPLATE,
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

/* ---------------- 批次归档与记忆沉淀 ---------------- */

export function archiveTeamBatch(
  workspaceRoot: string,
  options: { nextBatch?: string; nextGoal?: string } = {},
): { ok: true; archivedTo: string; snapshot: TeamSnapshot } {
  const spec = teamSpecPath(workspaceRoot)
  const boardFile = join(spec, TEAM_BOARD_RELATIVE_PATH)
  const archiveDir = withLock(boardLockRoot(spec), () => {
    const markdown = textFile(boardFile)
    if (markdown == null) throw new Error('当前项目还没有看板，无法归档')
    const board = parseTeamBoard(markdown)
    const activeTasks = board.tasks.filter((task) => task.status === '进行中')
    if (activeTasks.length > 0) {
      throw new Error(`仍有 ${activeTasks.length} 张卡片处于「进行中」，请先收口后再归档`)
    }
    const unmerged = board.tasks.filter((task) => task.branch.trim())
    if (unmerged.length > 0) {
      throw new Error(`仍有 ${unmerged.length} 张卡片存在未合并分支（${unmerged.map((t) => t.id).join('、')}），请先合并或清理后再归档`)
    }

    const date = new Date().toISOString().slice(0, 10)
    const slug = sanitizeTeamText(board.batch || '批次', 60).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'batch'
    let dir = join(spec, '归档', `${date}-${slug}`)
    if (existsSync(dir)) {
      dir = join(spec, '归档', `${date}-${slug}-${Date.now().toString().slice(-4)}`)
    }
    mkdirSync(dir, { recursive: true })
    writeAtomic(join(dir, '当前批次.md'), markdown)

    const contractFile = join(spec, '02-方案契约.md')
    const contractText = textFile(contractFile)
    if (contractText != null) {
      writeAtomic(join(dir, '02-方案契约.md'), contractText)
    }

    const stateText = textFile(join(spec, TEAM_STATE_RELATIVE_PATH))
    if (stateText != null) {
      writeAtomic(join(dir, '团队.json'), stateText)
    }

    const nextBatch = sanitizeTeamText(options.nextBatch, 80) || '下一批次'
    const nextGoal = sanitizeTeamText(options.nextGoal, 300) || '确认本轮需求与契约后拆解并发开工。'
    const resetBoard = BOARD_TEMPLATE
      .replace('- 当前批次：需求梳理', `- 当前批次：${nextBatch}`)
      .replace('- 目标：先与 Leader 确认需求；PRD 确认后拆解任务并开工。', `- 目标：${nextGoal}`)
    writeAtomic(boardFile, resetBoard)
    return dir
  })

  withTeamState(spec, (state) => {
    state.runs = []
  })

  return {
    ok: true as const,
    archivedTo: archiveDir,
    snapshot: snapshotFor(spec, workspaceRoot),
  }
}

export function appendTeamMemory(
  workspaceRoot: string,
  input: { kind: 'lesson' | 'taste'; text: string; taskId?: string },
): { ok: true; file: string; snapshot: TeamSnapshot } {
  const spec = teamSpecPath(workspaceRoot)
  const text = sanitizeTeamText(input.text, 500)
  if (!text) throw new Error('记录内容不能为空')
  const isLesson = input.kind === 'lesson'
  const file = join(spec, isLesson ? '错题本.md' : '品味账本.md')
  const date = new Date().toISOString().slice(0, 10)
  const taskTag = sanitizeTeamText(input.taskId, 20)
  const entry = `- [${date}]${taskTag ? ` [${taskTag}]` : ''} ${text}`

  return withLock(join(spec, '协作'), () => {
    mkdirSync(spec, { recursive: true })
    const existing = textFile(file) ?? (isLesson ? LESSONS_TEMPLATE : TASTE_TEMPLATE)
    const eol = existing.includes('\r\n') ? '\r\n' : '\n'
    const trimmed = existing.replace(/[\r\n]+$/, '')
    writeAtomic(file, `${trimmed}${eol}${entry}${eol}`)
    return {
      ok: true as const,
      file,
      snapshot: snapshotFor(spec, workspaceRoot),
    }
  })
}
