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
  TEAM_STATUSES,
  type TeamStatus,
  type TeamTaskDraft,
} from '@shared/team-board'
import { authorizeProjectCwd } from './trusted-workspace'
import {
  createTeamTask,
  readTeamSnapshot,
  setTeamTaskStatus,
  teamSpecPath,
} from './team-board'
import { dispatchTeamTask } from './team-board-ops'

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
function summarizeBoard(cwd: string): Record<string, unknown> {
  const snapshot = readTeamSnapshot(cwd)
  return {
    exists: snapshot.exists,
    batch: snapshot.batch,
    goal: snapshot.goal,
    autoTeam: snapshot.autoTeam,
    autoHint: snapshot.autoTeam
      ? '自动模式已开启：用户让干活时主动拆卡并派发，不必等派发指令。'
      : '手动模式：只按显式拆卡/派发指令行动。',
    roles: snapshot.roles.map((role) => ({
      role: role.role,
      model: role.model || null,
      effort: role.effort || null,
      enabled: role.enabled,
      dispatchable: role.enabled && !!role.model,
    })),
    tasks: snapshot.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      role: task.role,
      status: task.status,
      acceptance: `${task.acceptance.filter((item) => item.done).length}/${task.acceptance.length}`,
      dependsOn: task.dependsOn.length ? task.dependsOn : undefined,
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
  if (!isTeamRole(role)) return `role 必须是 ${['Leader', '设计师', '前端', '后端', '质量测试'].join(' / ')} 之一`
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
    ...(lines(raw.acceptance).length ? { acceptance: lines(raw.acceptance) } : {}),
  }
}

export async function handleTeamToolRequest(
  data: Record<string, unknown>,
  slot: { cwd: string },
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
    const project = authorizeProjectCwd(slot.cwd)
    if (!project.ok) return reply(`工作区不可用（${project.error}），先让主人在侧栏打开这个项目`, true)
    const cwd = project.cwd
    const args = (data.args || {}) as Args
    const action = str(args.action, 40)

    if (action === 'snapshot') {
      const board = summarizeBoard(cwd)
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
      const before = new Set(readTeamSnapshot(cwd).tasks.map((task) => task.id))
      const created: string[] = []
      for (const draft of drafts) {
        const snapshot = createTeamTask(cwd, draft)
        for (const task of snapshot.tasks) {
          if (!before.has(task.id) && !created.includes(task.id)) created.push(task.id)
        }
      }
      return reply({ ok: true, created, board: summarizeBoard(cwd) })
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
        return reply({ ok: true, board: summarizeBoard(cwd) })
      }
      const outcome = setTeamTaskStatus(cwd, {
        taskId,
        to,
        ...(str(args.note, 1500) ? { autoNote: str(args.note, 1500) } : {}),
      })
      if (!outcome.ok) return reply(`改状态失败：${outcome.reason}`, true)
      return reply({ ok: true, board: summarizeBoard(cwd) })
    }

    if (action === 'dispatch') {
      const taskId = str(args.taskId, 20)
      if (!taskId) return reply('action=dispatch 需要 taskId', true)
      const result = await dispatchTeamTask(cwd, taskId, { trigger: 'agent' })
      return reply({
        ok: true,
        taskId: result.taskId,
        role: result.role,
        sessionFile: result.sessionFile,
        model: result.model,
        note: '已在后台开会话开工；它结束后看板会自动落到「待审查」，不用手动改状态',
        board: summarizeBoard(cwd),
      })
    }

    if (action === 'comment') {
      // 给卡片追加一条自动推进备注（不改状态），用于把结论留在看板上。
      const taskId = str(args.taskId, 20)
      const note = str(args.note, 1500)
      if (!taskId || !note) return reply('action=comment 需要 taskId 与 note', true)
      const snapshot = readTeamSnapshot(cwd)
      const task = snapshot.tasks.find((item) => item.id === taskId)
      if (!task) return reply(`找不到任务卡 ${taskId}`, true)
      const outcome = setTeamTaskStatus(cwd, { taskId, to: task.status, autoNote: note })
      if (!outcome.ok) return reply(`写备注失败：${outcome.reason}`, true)
      return reply({ ok: true, board: summarizeBoard(cwd) })
    }

    return reply(
      'action 必须是 snapshot / create_task / move_task / dispatch / comment；' +
        `看板文件：${teamSpecPath(cwd)}/看板/当前批次.md`,
      true,
    )
  } catch (error) {
    return reply(String((error as Error)?.message || error), true)
  }
}
