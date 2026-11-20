/**
 * 工作团队的可复用操作层。
 *
 * 面板 IPC 和 agent 侧 `team_board` 工具共用同一套逻辑：派发、模型路由、会话命名
 * 都只有一份实现，避免「面板派发」和「模型自己派发」长出两套行为。
 */
import {
  buildTeamPrompt,
  canonicalTeamRole,
  splitTeamModel,
  type TeamRoleBinding,
  type TeamSnapshot,
} from '@shared/team-board'
import { setSessionDisplayName } from './session-display-names'
import { workerManager } from './worker-manager'
import {
  markTeamRunRunning,
  readTeamSnapshot,
  recordTeamDispatch,
  setTeamTaskStatus,
  settleTeamRun,
  teamSpecPath,
} from './team-board'

/** 给后台角色会话一个可读标题（否则侧栏会显示提示词第一行 `# 角色：前端`）。 */
export function titleRoleSession(sessionFile: string, title: string): void {
  try {
    setSessionDisplayName(sessionFile, title)
  } catch (error) {
    console.warn('[team-board] 设置角色会话标题失败：', error)
  }
}

export function roleBinding(
  workspaceRoot: string,
  roleValue: string,
): { snapshot: TeamSnapshot; role: string; binding: TeamRoleBinding } {
  const snapshot = readTeamSnapshot(workspaceRoot)
  if (!snapshot.exists) throw new Error('当前项目还没有看板，请先初始化或接管老项目')
  const role = canonicalTeamRole(roleValue)
  const binding = snapshot.roles.find((item) => item.role === role)
  if (!binding) throw new Error(`未知角色：${roleValue}`)
  if (!binding.enabled) throw new Error(`角色「${role}」已停用，请先在团队设置里开启`)
  if (!splitTeamModel(binding.model)) throw new Error(`角色「${role}」还没有绑定模型，请先在团队设置里选择`)
  return { snapshot, role, binding }
}

/** 先确认模型切换成功，再按模型支持的档位设置思考深度。 */
export async function applyRoleRoute(workspaceRoot: string, role: string, sessionFile: string): Promise<void> {
  const { binding } = roleBinding(workspaceRoot, role)
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

export type DispatchResult = {
  ok: true
  sessionId: string
  sessionFile: string
  role: string
  taskId: string
  model: string
  snapshot: TeamSnapshot
}

/**
 * 派发一张任务卡：依赖校验 → 后台会话 → 模型/思考深度 → 提示词 → 运行记录 → 卡片进「进行中」。
 * `trigger` 只进看板备注，用来区分是面板点的还是模型自己派的。
 */
export async function dispatchTeamTask(
  workspaceRoot: string,
  taskId: string,
  options: { trigger?: 'panel' | 'agent' } = {},
): Promise<DispatchResult> {
  const snapshot = readTeamSnapshot(workspaceRoot)
  if (!snapshot.exists) throw new Error('当前项目还没有看板，请先初始化或接管老项目')
  const task = snapshot.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error(`找不到任务卡 ${taskId}，请刷新看板`)
  if (task.status === '已验收') throw new Error('这张卡已验收；要返工请先把它移回「进行中」')
  const role = canonicalTeamRole(task.role)
  const { binding } = roleBinding(workspaceRoot, role)

  for (const depId of task.dependsOn) {
    const dep = snapshot.tasks.find((item) => item.id === depId)
    if (!dep) throw new Error(`前置依赖 ${depId} 不在当前看板，请先修复依赖`)
    if (dep.status !== '已验收') throw new Error(`前置依赖 ${depId} 尚未验收（当前：${dep.status}），不能抢跑`)
  }

  const active = snapshot.runs.find(
    (run) => run.taskId === taskId && (run.status === 'starting' || run.status === 'running'),
  )
  if (active) {
    // 看门狗已经判定超时的记录不再挡路：关掉旧的再开新的，人不用先去手动收尾。
    if (!active.staleAt) {
      throw new Error(`这张卡已有运行中的派发（${active.role}），等它结束或先核对会话状态`)
    }
    settleTeamRun(teamSpecPath(workspaceRoot), workspaceRoot, active.sessionFile, 'cancelled', {
      note: '超时未落账，已被新的派发替代',
      closedBy: 'human',
      silent: true,
    })
  }

  const prompt = buildTeamPrompt({ role, batch: snapshot.batch, goal: snapshot.goal, task })
  const session = await workerManager.newSessionInBackground(workspaceRoot)
  if (!session.sessionFile) throw new Error('后台会话创建失败：没有拿到 sessionFile')
  const sessionFile = session.sessionFile
  titleRoleSession(sessionFile, `${role} · ${taskId}`)
  recordTeamDispatch(teamSpecPath(workspaceRoot), { taskId, role, sessionFile, sessionId: session.sessionId })

  try {
    await applyRoleRoute(workspaceRoot, role, sessionFile)
    await workerManager.sendPrompt(prompt, sessionFile)
    markTeamRunRunning(teamSpecPath(workspaceRoot), sessionFile)
  } catch (error) {
    // 会话已建但开工失败：留一条失败回执，卡片保持原状态，人能看到这轮没交付。
    settleTeamRun(teamSpecPath(workspaceRoot), workspaceRoot, sessionFile, 'failed')
    throw error
  }

  if (task.status !== '进行中') {
    setTeamTaskStatus(workspaceRoot, {
      taskId,
      to: '进行中',
      from: task.status,
      autoNote: options.trigger === 'agent' ? `已由团队工具派发给 ${role}` : `已派发给 ${role}`,
    })
  }

  return {
    ok: true,
    sessionId: session.sessionId,
    sessionFile,
    role,
    taskId,
    model: binding.model,
    snapshot: readTeamSnapshot(workspaceRoot),
  }
}
