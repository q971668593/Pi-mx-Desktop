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
  sanitizeTeamText,
  splitTeamModel,
  type TeamRole,
  type TeamStatus,
} from '@shared/team-board'
import { authorizeProjectCwd } from '../../trusted-workspace'
import { workerManager } from '../../worker-manager'
import {
  bindTeamSession,
  createTeamTask,
  getTeamAutoMode,
  initTeamProject,
  readTeamSnapshot,
  resolveTeamTaskApproval,
  saveTeamRoles,
  setTeamAutoMode,
  setTeamTaskStatus,
  settleTeamRun,
  sweepTeamRuns,
  teamSpecPath,
} from '../../team-board'
import { applyRoleRoute, dispatchTeamTask, roleBinding, titleRoleSession } from '../../team-board-ops'
import { registerHandlerWithSchema } from '../registry'

const workspace = z.string().min(1).max(4096)
const statusEnum = z.enum([...TEAM_STATUSES] as [TeamStatus, ...TeamStatus[]])
const runOutcomes = z.enum(['success', 'failed', 'cancelled'])

function authorizedCwd(workspaceId: string): string {
  const authorized = authorizeProjectCwd(workspaceId)
  if (!authorized.ok) throw new Error(`工作区不可用或未受信任（${authorized.error}），请重新选择工作区`)
  return authorized.cwd
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
        defaultModel: z.string().max(200).optional(),
      })
      .strict(),
    async ({ workspaceId, mode, name, defaultModel }) => {
      const cwd = authorizedCwd(workspaceId)
      const preset = String(defaultModel || '').trim()
      // 只接受 provider/model 形态；形态不对就当没传（角色保持未绑定）。
      const snapshot = initTeamProject(cwd, { mode, name, ...(preset.includes('/') ? { defaultModel: preset } : {}) })
      return { ok: true, snapshot }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.autoMode.get',
    z.object({ workspaceId: workspace }).strict(),
    async ({ workspaceId }) => {
      const cwd = authorizedCwd(workspaceId)
      return { ok: true, autoTeam: getTeamAutoMode(cwd) }
    },
  )

  registerHandlerWithSchema(
    'ipc:teamBoard.autoMode.set',
    z.object({ workspaceId: workspace, autoTeam: z.boolean() }).strict(),
    async ({ workspaceId, autoTeam }) => {
      const cwd = authorizedCwd(workspaceId)
      const snapshot = setTeamAutoMode(cwd, autoTeam)
      return { ok: true, autoTeam: snapshot.autoTeam, snapshot }
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
      return dispatchTeamTask(cwd, taskId, { trigger: 'panel' })
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
      const guidance = sanitizeTeamText(text, 1500)
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
