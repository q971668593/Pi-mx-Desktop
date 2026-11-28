/**
 * `team_board` 工具的主进程侧桥。
 *
 * worker 里的工具不能直接读写项目文件，也不该自己起会话：它把动作发到这里，
 * 由主进程用与面板完全相同的函数执行（同一个看板文件、同一把锁、同一套派发逻辑）。
 */
import {
  canonicalTeamRole,
  isTeamRole,
  TEAM_BLOCK_TYPES,
  TEAM_ROLES,
  TEAM_STATUSES,
  type TeamStatus,
  type TeamTaskDraft,
} from '@shared/team-board'
import { listGitWorktrees } from './git-worktrees'
import { authorizeProjectCwd } from './trusted-workspace'
import {
  appendTeamMemory,
  createTeamTask,
  readTeamSnapshot,
  setTeamTaskStatus,
  teamSpecPath,
} from './team-board'
import { dispatchTeamReview, dispatchTeamTask, mergeTeamTaskWorktree, submitTeamReviewVerdict } from './team-board-ops'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

type TaskDraftInput = {
  title?: unknown
  role?: unknown
  acceptance?: unknown
  input?: unknown
  output?: unknown
  note?: unknown
  wave?: unknown
  dependsOn?: unknown
  ownedPaths?: unknown
  status?: unknown
}

type Args = {
  action?: unknown
  tasks?: unknown
  taskId?: unknown
  status?: unknown
  reason?: unknown
  blockType?: unknown
  note?: unknown
  verdict?: unknown
  summary?: unknown
  issues?: unknown
  memoryKind?: unknown
}

const MAX_BATCH_TASKS = 12

function str(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function lines(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => str(item, 300)).filter(Boolean).slice(0, max)
}

/** 给模型看的看板摘要：短、能直接定位下一张卡。 */
function summarizeBoard(cwd: string, sessionFile?: string | null): Record<string, unknown> {
  const snapshot = readTeamSnapshot(cwd, { sessionFile })
  return {
    exists: snapshot.exists,
    batch: snapshot.batch,
    goal: snapshot.goal,
    roles: snapshot.roles.map((role) => ({
      role: role.role,
      model: role.model || snapshot.defaultModel || null,
      effort: role.effort || null,
      enabled: role.enabled,
      dispatchable: role.enabled && !!(role.model || snapshot.defaultModel),
    })),
    tasks: snapshot.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      role: task.role,
      status: task.status,
      acceptance: `${task.acceptance.filter((item) => item.done).length}/${task.acceptance.length}`,
      dependsOn: task.dependsOn.length ? task.dependsOn : undefined,
      branch: task.branch || undefined,
      ownedPaths: task.ownedPaths.length ? task.ownedPaths : undefined,
      reworkCount: task.reworkCount || undefined,
      blockType: task.blockType || undefined,
      approval: task.approval || undefined,
    })),
    runs: snapshot.runs.slice(-8).map((run) => ({
      taskId: run.taskId,
      role: run.role,
      status: run.status,
      stale: !!run.staleAt,
      report: run.report?.kind,
      sessionFile: run.sessionFile,
    })),
  }
}

function normalizeDraft(raw: TaskDraftInput): TeamTaskDraft | string {
  const title = str(raw.title, 200)
  if (!title) return '每张卡都要有 title'
  const role = canonicalTeamRole(raw.role)
  if (!isTeamRole(role)) return `role 必须是 ${TEAM_ROLES.join(' / ')} 之一`
  const status = raw.status === undefined ? undefined : (String(raw.status) as TeamStatus)
  if (status && !TEAM_STATUSES.includes(status)) return `status 必须是 ${TEAM_STATUSES.join(' / ')} 之一`
  return {
    title,
    role,
    ...(status ? { status } : {}),
    ...(str(raw.wave, 80) ? { wave: str(raw.wave, 80) } : {}),
    ...(str(raw.input, 2000) ? { input: str(raw.input, 2000) } : {}),
    ...(str(raw.output, 2000) ? { output: str(raw.output, 2000) } : {}),
    ...(str(raw.note, 2000) ? { note: str(raw.note, 2000) } : {}),
    ...(lines(raw.dependsOn).length ? { dependsOn: lines(raw.dependsOn) } : {}),
    ...(lines(raw.ownedPaths, 30).length ? { ownedPaths: lines(raw.ownedPaths, 30) } : {}),
    ...(lines(raw.acceptance).length ? { acceptance: lines(raw.acceptance) } : {}),
  }
}

async function resolveBoardCwd(slotCwd: string): Promise<string | null> {
  const direct = authorizeProjectCwd(slotCwd)
  if (!direct.ok) return null
  const listing = await listGitWorktrees(direct.cwd).catch(() => null)
  if (listing?.ok && listing.repositoryPath) {
    const repo = authorizeProjectCwd(listing.repositoryPath)
    if (repo.ok) return repo.cwd
  }
  return direct.cwd
}

export async function handleTeamToolRequest(
  data: Record<string, unknown>,
  slot: { cwd: string; sessionFile?: string | null },
  post: (message: Record<string, unknown>) => void,
): Promise<void> {
  const callId = String(data.callId || '')
  if (!callId) return
  const reply = (payload: unknown, isError = false) =>
    post({
      type: 'team-tool-response',
      callId,
      result: {
        content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
        ...(isError ? { isError: true } : {}),
      } satisfies ToolResult,
    })

  try {
    const cwd = await resolveBoardCwd(slot.cwd)
    if (!cwd) return reply('工作区不可用或未受信任，先让主人在侧栏打开这个项目', true)
    const args = (data.args || {}) as Args
    const action = str(args.action, 40)
    const originSessionFile = slot.sessionFile || null

    if (action === 'snapshot') {
      const board = summarizeBoard(cwd, originSessionFile)
      if (!board.exists) return reply('这个项目还没有工作团队看板；先让主人在右侧「工作团队」里初始化或接管老项目', true)
      return reply(board)
    }

    if (action === 'create_task') {
      const rawTasks = Array.isArray(args.tasks) ? (args.tasks as TaskDraftInput[]) : []
      if (!rawTasks.length) return reply('actions=create_task 需要 tasks: [{ title, role, acceptance?, input?, output?, note?, wave?, dependsOn? }]', true)
      if (rawTasks.length > MAX_BATCH_TASKS) return reply(`一次最多建 ${MAX_BATCH_TASKS} 张卡；再多的分几批`, true)
      const drafts: TeamTaskDraft[] = []
      for (const raw of rawTasks) {
        const draft = normalizeDraft(raw)
        if (typeof draft === 'string') return reply(draft, true)
        drafts.push(draft)
      }
      const before = new Set(readTeamSnapshot(cwd, { sessionFile: originSessionFile }).tasks.map((task) => task.id))
      const created: string[] = []
      for (const draft of drafts) {
        const snapshot = createTeamTask(cwd, draft)
        for (const task of snapshot.tasks) {
          if (!before.has(task.id) && !created.includes(task.id)) created.push(task.id)
        }
      }
      return reply({ ok: true, created, board: summarizeBoard(cwd, originSessionFile) })
    }

    if (action === 'move_task') {
      const taskId = str(args.taskId, 20)
      if (!taskId) return reply('action=move_task 需要 taskId', true)
      const to = String(args.status || '') as TeamStatus
      if (!TEAM_STATUSES.includes(to)) return reply(`status 必须是 ${TEAM_STATUSES.join(' / ')} 之一`, true)
      // 人工闸门：验收只能由人点确认，模型不能自己把卡标成已验收。
      if (to === '已验收') return reply('「已验收」只能由主人在面板里人工确认；模型最多把卡推进到「待审查」', true)
      if (to === '阻塞') {
        const blockType = str(args.blockType, 40)
        if (!TEAM_BLOCK_TYPES.includes(blockType as (typeof TEAM_BLOCK_TYPES)[number])) {
          return reply(`移入「阻塞」需要 blockType：${TEAM_BLOCK_TYPES.join(' / ')}`, true)
        }
        const outcome = setTeamTaskStatus(cwd, { taskId, to, blockType, reason: str(args.reason, 1500) })
        if (!outcome.ok) return reply(`改状态失败：${outcome.reason}`, true)
        return reply({ ok: true, board: summarizeBoard(cwd, originSessionFile) })
      }
      const outcome = setTeamTaskStatus(cwd, {
        taskId,
        to,
        ...(str(args.note, 1500) ? { autoNote: str(args.note, 1500) } : {}),
      })
      if (!outcome.ok) return reply(`改状态失败：${outcome.reason}`, true)
      return reply({ ok: true, board: summarizeBoard(cwd, originSessionFile) })
    }

    if (action === 'dispatch') {
      const taskId = str(args.taskId, 20)
      if (!taskId) return reply('action=dispatch 需要 taskId', true)
      const result = await dispatchTeamTask(cwd, taskId, { trigger: 'agent', sessionFile: originSessionFile })
      return reply({
        ok: true,
        taskId: result.taskId,
        role: result.role,
        sessionFile: result.sessionFile,
        model: result.model,
        ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
        ...(result.branch ? { branch: result.branch } : {}),
        note: '已在后台开会话开工；它结束后看板会自动落到「待审查」，不用手动改状态',
        board: summarizeBoard(cwd, originSessionFile),
      })
    }

    if (action === 'merge_task') {
      const taskId = str(args.taskId, 20)
      if (!taskId) return reply('action=merge_task 需要 taskId', true)
      const result = await mergeTeamTaskWorktree(cwd, taskId)
      return reply({
        ok: true,
        taskId: result.taskId,
        branch: result.branch,
        note: `已合并分支 ${result.branch} 并清理独立工作区`,
        board: summarizeBoard(cwd, originSessionFile),
      })
    }

    if (action === 'dispatch_review') {
      const taskId = str(args.taskId, 20)
      if (!taskId) return reply('action=dispatch_review 需要 taskId', true)
      const result = await dispatchTeamReview(cwd, taskId, { sessionFile: originSessionFile })
      return reply({
        ok: true,
        taskId: result.taskId,
        sessionFile: result.sessionFile,
        model: result.model,
        note: '已派发 Verifier 在隔离上下文中独立审查，完成后将通过 review_verdict 提交裁决',
        board: summarizeBoard(cwd, originSessionFile),
      })
    }

    if (action === 'review_verdict') {
      const taskId = str(args.taskId, 20)
      const verdict = str(args.verdict, 20)
      const summary = str(args.summary, 600)
      if (!taskId) return reply('action=review_verdict 需要 taskId', true)
      if (verdict !== 'pass' && verdict !== 'reject') {
        return reply('action=review_verdict 的 verdict 必须是 pass 或 reject', true)
      }
      if (!summary) return reply('action=review_verdict 需要 summary（一句话结论）', true)
      const result = await submitTeamReviewVerdict(cwd, {
        taskId,
        verdict,
        summary,
        issues: lines(args.issues, 20),
      })
      return reply({
        ok: true,
        taskId: result.taskId,
        verdict: result.verdict,
        status: result.status,
        reworkCount: result.reworkCount,
        ...(result.circuitBroken ? { circuitBroken: true } : {}),
        ...(result.resumed !== undefined ? { resumed: result.resumed } : {}),
        board: summarizeBoard(cwd, originSessionFile),
      })
    }

    if (action === 'comment') {
      // 给卡片追加一条自动推进备注（不改状态），用于把结论留在看板上。
      const taskId = str(args.taskId, 20)
      const note = str(args.note, 1500)
      if (!taskId || !note) return reply('action=comment 需要 taskId 与 note', true)
      const snapshot = readTeamSnapshot(cwd, { sessionFile: originSessionFile })
      const task = snapshot.tasks.find((item) => item.id === taskId)
      if (!task) return reply(`找不到任务卡 ${taskId}`, true)
      const outcome = setTeamTaskStatus(cwd, { taskId, to: task.status, autoNote: note })
      if (!outcome.ok) return reply(`写备注失败：${outcome.reason}`, true)
      return reply({ ok: true, board: summarizeBoard(cwd, originSessionFile) })
    }

    if (action === 'append_memory') {
      const memoryKind = str(args.memoryKind, 20)
      const note = str(args.note, 500)
      const taskId = str(args.taskId, 20)
      if (memoryKind !== 'lesson' && memoryKind !== 'taste') {
        return reply('action=append_memory 的 memoryKind 必须是 lesson 或 taste', true)
      }
      if (!note) return reply('action=append_memory 需要 note（记录内容）', true)
      const result = appendTeamMemory(cwd, { kind: memoryKind, text: note, ...(taskId ? { taskId } : {}) })
      return reply({ ok: true, file: result.file })
    }

    return reply(
      'action 必须是 snapshot / create_task / move_task / dispatch / dispatch_review / review_verdict / merge_task / comment / append_memory；' +
        `看板文件：${teamSpecPath(cwd)}/看板/当前批次.md`,
      true,
    )
  } catch (error) {
    return reply(String((error as Error)?.message || error), true)
  }
}
