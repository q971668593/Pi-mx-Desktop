/**
 * 工作团队（右侧栏 Team 面板）IPC。
 *
 * 派发全部走 `workerManager.newSessionInBackground`：角色会话在独立 worker slot 里跑，
 * 不抢占用户当前对话的 foreground，也不会把工作区切走。需要模型/思考深度时先确认
 * 模型切换成功再发 prompt，避免「看起来派发了，其实用的是别的模型」。
 */
import { existsSync } from 'node:fs'
import { z } from 'zod'
import {
  TEAM_STATUSES,
  buildTeamPrompt,
  buildTeamRoleIntro,
  canonicalTeamRole,
  isTeamRole,
  splitTeamModel,
  type TeamRole,
  type TeamStatus,
} from '@shared/team-board'
import { authorizeProjectCwd } from '../../trusted-workspace'
import { setSessionDisplayName } from '../../session-display-names'
import { workerManager } from '../../worker-manager'
import {
  bindTeamSession,
  createTeamTask,
  initTeamProject,
  markTeamRunRunning,
  readTeamSnapshot,
  recordTeamDispatch,
  resolveTeamTaskApproval,
  saveTeamRoles,
  setTeamTaskStatus,
  settleTeamRun,
  sweepTeamRuns,
  teamSpecPath,
} from '../../team-board'
import { registerHandlerWithSchema } from '../registry'

const workspace = z.string().min(1).max(4096)
const statusEnum = z.enum([...TEAM_STATUSES] as [TeamStatus, ...TeamStatus[]])
const runOutcomes = z.enum(['success', 'failed', 'cancelled'])

function authorizedCwd(workspaceId: string): string {
  const authorized = authorizeProjectCwd(workspaceId)
  if (!authorized.ok) throw new Error(`工作区不可用或未受信任（${authorized.error}），请重新选择工作区`)
  return authorized.cwd
}

/**
 * 给后台角色会话一个可读标题（否则侧栏会显示提示词第一行 `# 角色：前端`）。
 * 用 app 私有显示名而不是改写 JSONL：会话正在跑，别在首轮中途追加 session_info。
 */
function titleRoleSession(sessionFile: string, title: string): void {
  try {
    setSessionDisplayName(sessionFile, title)
  } catch (error) {
    console.warn('[team-board] 设置角色会话标题失败：', error)
  }
}

function roleBinding(workspaceId: string, roleValue: string) {
  const snapshot = readTeamSnapshot(workspaceId)
  if (!snapshot.exists) throw new Error('当前项目还没有看板，请先初始化或接管老项目')
  const role = canonicalTeamRole(roleValue)
  const binding = snapshot.roles.find((item) => item.role === role)
  if (!binding) throw new Error(`未知角色：${roleValue}`)
  if (!binding.enabled) throw new Error(`角色「${role}」已停用，请先在团队设置里开启`)
  if (!splitTeamModel(binding.model)) throw new Error(`角色「${role}」还没有绑定模型，请先在团队设置里选择`)
  return { snapshot, role, binding }
}

/** 先确认模型切换成功，再按模型支持的档位设置思考深度。 */
async function applyRoleRoute(workspaceId: string, role: string, sessionFile: string): Promise<void> {
  const { binding } = roleBinding(workspaceId, role)
  const parts = splitTeamModel(binding.model)
  if (!parts) throw new Error(`角色「${role}」的模型绑定无效`)
  const expected = `${parts.provider}/${parts.modelId}`
  const result = await workerManager.setModelWithThinking(parts.provider, parts.modelId, sessionFile)
  if (result.modelId && result.modelId !== expected && result.modelId !== parts.modelId) {
    throw new Error(`模型切换未确认：期望 ${expected}，实际 ${result.modelId || '未知'}`)
  }
  if (!binding.effort) return
  const levels = result.availableThinkingLevels
  if (levels && !levels.includes(binding.effort)) {
    console.warn(`[team-board] 模型 ${expected} 不支持思考深度 ${binding.effort}，按模型默认执行`)
    return
  }
  try {
    await workerManager.setThinkingLevel(binding.effort, sessionFile)
  } catch (error) {
    console.warn('[team-board] 设置思考深度失败，按模型默认执行：', error)
  }
}

export function registerTeamBoardHandlers(): void {
  registerHandlerWithSchema('ipc:teamBoard.snapshot', z.object({ workspaceId: workspace }).strict(), async ({ workspaceId }) => {
    const cwd = authorizedCwd(workspaceId)
    return { ok: true, snapshot: readTeamSnapshot(cwd) }
  })

  registerHandlerWithSchema(
    'ipc:teamBoard.init',
    z
      .object({
        workspaceId: workspace,
        mode: z.enum(['new', 'legacy']).optional(),
        name: z.string().max(80).optional(),
      })
      .strict(),
    async ({ workspaceId, mode, name }) => {
      const cwd = authorizedCwd(workspaceId)
      const snapshot = initTeamProject(cwd, { mode, name })
      return { ok: true, snapshot }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.roles.save',
    z
      .object({
        workspaceId: workspace,
        roles: z
          .array(
            z
              .object({
                role: z.string().min(1).max(40),
                model: z.string().max(200).optional(),
                effort: z.string().max(20).optional(),
                note: z.string().max(200).optional(),
                enabled: z.boolean().optional(),
                directEnabled: z.boolean().optional(),
              })
              .passthrough(),
          )
          .max(10),
      })
      .strict(),
    async ({ workspaceId, roles }) => {
      const cwd = authorizedCwd(workspaceId)
      const spec = teamSpecPath(cwd)
      const saved = saveTeamRoles(spec, roles)
      return { ok: true, roles: saved, snapshot: readTeamSnapshot(cwd) }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.taskStatus',
    z
      .object({
        workspaceId: workspace,
        taskId: z.string().min(1).max(20),
        to: statusEnum,
        from: z.string().max(40).optional(),
        reason: z.string().max(1500).optional(),
        manualConfirmed: z.boolean().optional(),
        blockType: z.string().max(40).optional(),
      })
      .strict(),
    async ({ workspaceId, taskId, to, from, reason, manualConfirmed, blockType }) => {
      const cwd = authorizedCwd(workspaceId)
      if (to === '已验收') {
        if (manualConfirmed !== true) throw new Error('移入「已验收」需要先勾选人工验证确认')
        if (!String(reason || '').trim()) throw new Error('请写清人工验证方式与覆盖边界')
      }
      return setTeamTaskStatus(cwd, {
        taskId,
        to,
        from,
        reason,
        manual: true,
        blockType,
      })
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.task.create',
    z
      .object({
        workspaceId: workspace,
        title: z.string().min(1).max(200),
        role: z.string().min(1).max(40),
        status: statusEnum.optional(),
        wave: z.string().max(80).optional(),
        input: z.string().max(2000).optional(),
        output: z.string().max(2000).optional(),
        note: z.string().max(2000).optional(),
        dependsOn: z.array(z.string().max(20)).max(20).optional(),
        acceptance: z.array(z.string().max(300)).max(20).optional(),
      })
      .strict(),
    async ({ workspaceId, title, role, status, wave, input, output, note, dependsOn, acceptance }) => {
      const cwd = authorizedCwd(workspaceId)
      const canonical = canonicalTeamRole(role)
      if (!isTeamRole(canonical)) throw new Error(`任务卡角色无效：${role}`)
      const snapshot = createTeamTask(cwd, {
        title,
        role: canonical,
        status,
        wave,
        input,
        output,
        note,
        dependsOn,
        acceptance,
      })
      return { ok: true, snapshot }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.prompt',
    z.object({ workspaceId: workspace, taskId: z.string().min(1).max(20) }).strict(),
    async ({ workspaceId, taskId }) => {
      const cwd = authorizedCwd(workspaceId)
      const snapshot = readTeamSnapshot(cwd)
      const task = snapshot.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error(`找不到任务卡 ${taskId}，请刷新看板`)
      return {
        ok: true,
        role: task.role,
        prompt: buildTeamPrompt({ role: task.role, batch: snapshot.batch, goal: snapshot.goal, task }),
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.dispatch',
    z
      .object({
        workspaceId: workspace,
        taskId: z.string().min(1).max(20),
      })
      .strict(),
    async ({ workspaceId, taskId }) => {
      const cwd = authorizedCwd(workspaceId)
      const snapshot = readTeamSnapshot(cwd)
      if (!snapshot.exists) throw new Error('当前项目还没有看板，请先初始化或接管老项目')
      const task = snapshot.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error(`找不到任务卡 ${taskId}，请刷新看板`)
      if (task.status === '已验收') throw new Error('这张卡已验收；要返工请先把它移回「进行中」')
      const role = canonicalTeamRole(task.role)
      if (!isTeamRole(role)) throw new Error(`任务卡的角色「${task.role || '未填写'}」无效`)
      const { binding } = roleBinding(cwd, role)

      for (const depId of task.dependsOn) {
        const dep = snapshot.tasks.find((item) => item.id === depId)
        if (!dep) throw new Error(`前置依赖 ${depId} 不在当前看板，请先修复依赖`)
        if (dep.status !== '已验收') throw new Error(`前置依赖 ${depId} 尚未验收（当前：${dep.status}），不能抢跑`)
      }

      const active = snapshot.runs.find((run) => run.taskId === taskId && (run.status === 'starting' || run.status === 'running'))
      if (active) {
        // 看门狗已经判定超时的记录不再挡路：关掉旧的再开新的，人不用先去手动收尾。
        if (!active.staleAt) {
          throw new Error(`这张卡已有运行中的派发（${active.role}），等它结束或先核对会话状态`)
        }
        settleTeamRun(teamSpecPath(cwd), cwd, active.sessionFile, 'cancelled', {
          note: '超时未落账，已被新的派发替代',
          closedBy: 'human',
          silent: true,
        })
      }

      const prompt = buildTeamPrompt({ role, batch: snapshot.batch, goal: snapshot.goal, task })
      const session = await workerManager.newSessionInBackground(cwd)
      if (!session.sessionFile) throw new Error('后台会话创建失败：没有拿到 sessionFile')
      const sessionFile = session.sessionFile
      titleRoleSession(sessionFile, `${role} · ${taskId}`)
      recordTeamDispatch(teamSpecPath(cwd), { taskId, role, sessionFile, sessionId: session.sessionId })

      try {
        await applyRoleRoute(cwd, role, sessionFile)
        await workerManager.sendPrompt(prompt, sessionFile)
        markTeamRunRunning(teamSpecPath(cwd), sessionFile)
      } catch (error) {
        // 会话已建但开工失败：留一条失败回执，卡片保持原状态，人能看到这轮没交付。
        settleTeamRun(teamSpecPath(cwd), cwd, sessionFile, 'failed')
        throw error
      }

      if (task.status !== '进行中') {
        setTeamTaskStatus(cwd, {
          taskId,
          to: '进行中',
          from: task.status,
          autoNote: `已派发给 ${role}`,
        })
      }

      return {
        ok: true,
        sessionId: session.sessionId,
        sessionFile,
        role,
        taskId,
        model: binding.model,
        snapshot: readTeamSnapshot(cwd),
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.roleSession',
    z.object({ workspaceId: workspace, role: z.string().min(1).max(40) }).strict(),
    async ({ workspaceId, role: roleValue }) => {
      const cwd = authorizedCwd(workspaceId)
      const { snapshot, role, binding } = roleBinding(cwd, roleValue)
      if (!binding.directEnabled) throw new Error(`角色「${role}」不允许直接对话，请先在团队设置里开启`)
      const existing = snapshot.sessions[role as TeamRole]
      if (existing && existsSync(existing.sessionFile)) {
        return { ok: true, opened: false, role, sessionId: existing.sessionId ?? null, sessionFile: existing.sessionFile, snapshot }
      }

      const prompt = buildTeamRoleIntro({ role, batch: snapshot.batch, goal: snapshot.goal })
      const session = await workerManager.newSessionInBackground(cwd)
      if (!session.sessionFile) throw new Error('角色会话创建失败：没有拿到 sessionFile')
      const sessionFile = session.sessionFile
      titleRoleSession(sessionFile, `${role} · ${snapshot.batch || '工作团队'}`)
      try {
        await applyRoleRoute(cwd, role, sessionFile)
        await workerManager.sendPrompt(prompt, sessionFile)
      } catch (error) {
        void workerManager.abort(sessionFile).catch(() => {})
        throw error
      }
      bindTeamSession(teamSpecPath(cwd), role, { sessionFile, sessionId: session.sessionId })
      return {
        ok: true,
        opened: true,
        role,
        sessionId: session.sessionId,
        sessionFile,
        model: binding.model,
        snapshot: readTeamSnapshot(cwd),
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.intervene',
    z.object({ workspaceId: workspace, taskId: z.string().min(1).max(20), text: z.string().min(1).max(1500) }).strict(),
    async ({ workspaceId, taskId, text }) => {
      const cwd = authorizedCwd(workspaceId)
      const snapshot = readTeamSnapshot(cwd)
      const task = snapshot.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error(`找不到任务卡 ${taskId}，请刷新看板`)
      const run = [...snapshot.runs].reverse().find((item) => item.taskId === taskId)
      if (!run) throw new Error('这张卡还没有派发记录，先在卡片里派发开工')
      if (!existsSync(run.sessionFile)) throw new Error('这次派发的会话文件已不存在，只能先结束这次派发')
      const guidance = text.replace(/\s+/g, ' ').trim()
      await workerManager.sendPrompt(
        `主人插话：${guidance}\n\n按这条指引继续这张卡；如果它改变了范围或验收标准，先说明影响再动手。`,
        run.sessionFile,
      )
      setTeamTaskStatus(cwd, {
        taskId,
        to: task.status,
        from: task.status,
        autoNote: `人工插话：${guidance}`,
      })
      return { ok: true, snapshot: readTeamSnapshot(cwd) }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.abortRun',
    z.object({ workspaceId: workspace, sessionFile: z.string().min(1).max(4096) }).strict(),
    async ({ workspaceId, sessionFile }) => {
      const cwd = authorizedCwd(workspaceId)
      const spec = teamSpecPath(cwd)
      const before = readTeamSnapshot(cwd)
      const run = [...before.runs].reverse().find((item) => item.sessionFile === sessionFile)
      try {
        await workerManager.abort(sessionFile)
      } catch (error) {
        console.warn('[team-board] 中止会话失败，继续收回派发记录：', error)
      }
      settleTeamRun(spec, cwd, sessionFile, 'cancelled', {
        note: '人工中止这次派发',
        closedBy: 'human',
        silent: true,
      })
      const task = run ? before.tasks.find((item) => item.id === run.taskId) : undefined
      if (task && task.status === '进行中' && !task.approval) {
        setTeamTaskStatus(cwd, {
          taskId: task.id,
          to: '阻塞',
          from: '进行中',
          blockType: '待用户确认',
          autoNote: '人工中止了这次派发，核对产物后重新派发',
        })
      }
      return { ok: true, snapshot: readTeamSnapshot(cwd) }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.settleRun',
    z
      .object({
        workspaceId: workspace,
        sessionFile: z.string().min(1).max(4096),
        outcome: runOutcomes,
        note: z.string().max(300).optional(),
        closedBy: z.enum(['human', 'host']).optional(),
      })
      .strict(),
    async ({ workspaceId, sessionFile, outcome, note, closedBy }) => {
      const cwd = authorizedCwd(workspaceId)
      const spec = teamSpecPath(cwd)
      const result = settleTeamRun(spec, cwd, sessionFile, outcome, { note, closedBy })
      return { ok: true, ...result, snapshot: readTeamSnapshot(cwd) }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.sweep',
    z.object({ workspaceId: workspace }).strict(),
    async ({ workspaceId }) => {
      const cwd = authorizedCwd(workspaceId)
      const result = sweepTeamRuns(teamSpecPath(cwd), cwd)
      return { ok: true, stale: result.stale, blocked: result.blocked, snapshot: result.snapshot }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.approval',
    z
      .object({
        workspaceId: workspace,
        taskId: z.string().min(1).max(20),
        decision: z.enum(['approve', 'deny']),
        note: z.string().max(300).optional(),
        from: z.string().max(40).optional(),
      })
      .strict(),
    async ({ workspaceId, taskId, decision, note, from }) => {
      const cwd = authorizedCwd(workspaceId)
      const result = resolveTeamTaskApproval(cwd, { taskId, decision, note, from })
      if (!result.ok) {
        const messages: Record<string, string> = {
          task_not_found: `找不到任务卡 ${taskId}，请刷新看板`,
          no_pending_approval: `${taskId} 没有待批准事项（可能已被别人处理）`,
          status_mismatch: `${taskId} 的状态已被改动，已刷新看板`,
        }
        throw new Error(messages[result.reason] ?? '审批失败')
      }
      // 批准后把这轮会话叫起来继续：审批的意义是「同意继续」，不是只改一行字。
      let resumed = false
      if (decision === 'approve') {
        const run = [...result.snapshot.runs].reverse().find((item) => item.taskId === taskId)
        if (run && existsSync(run.sessionFile)) {
          try {
            await workerManager.sendPrompt(
              `主人已批准：${result.request}\n\n继续完成任务卡 ${taskId}；结束后按约定给「交付摘要」与「验证」。`,
              run.sessionFile,
            )
            resumed = true
          } catch (error) {
            console.warn('[team-board] 批准后唤醒会话失败，卡片已放行：', error)
          }
        }
      }
      return { ok: true, from: result.from, to: result.to, request: result.request, resumed, snapshot: result.snapshot }
    },
  )

  registerHandlerWithSchema('ipc:teamBoard.activeRuns', z.object({ workspaceId: workspace }).strict(), async ({ workspaceId }) => {
    const cwd = authorizedCwd(workspaceId)
    const snapshot = readTeamSnapshot(cwd)
    return {
      ok: true,
      exists: snapshot.exists,
      sessions: snapshot.sessions,
      runs: snapshot.runs.filter((run) => run.status === 'starting' || run.status === 'running'),
    }
  })

}
