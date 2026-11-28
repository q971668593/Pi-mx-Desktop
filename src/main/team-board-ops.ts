/**
 * 工作团队的可复用操作层。
 *
 * 面板 IPC 和 agent 侧 `team_board` 工具共用同一套逻辑：派发、模型路由、会话命名
 * 都只有一份实现，避免「面板派发」和「模型自己派发」长出两套行为。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  TEAM_MAX_REWORK_ROUNDS,
  buildTeamPrompt,
  buildTeamReviewPrompt,
  canonicalTeamRole,
  checkTeamDispatchGates,
  extractRecentMemorySnippet,
  isTeamRunActive,
  sanitizeTeamText,
  splitTeamModel,
  type TeamRoleBinding,
  type TeamSnapshot,
  type TeamStatus,
} from '@shared/team-board'
import { createGitWorktree, removeGitWorktree } from './git-worktree-ops'
import { gitExec } from './git-workspace'
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

function readSpecFile(spec: string, relativePath: string): string | null {
  try {
    const file = join(spec, relativePath)
    if (!existsSync(file) || statSync(file).size > 512 * 1024) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function roleBinding(
  workspaceRoot: string,
  roleValue: string,
  sessionFile?: string | null,
): { snapshot: TeamSnapshot; role: string; binding: TeamRoleBinding } {
  const snapshot = readTeamSnapshot(workspaceRoot, { sessionFile })
  if (!snapshot.exists) throw new Error('当前项目还没有看板，请先初始化或接管老项目')
  const role = canonicalTeamRole(roleValue)
  const binding = snapshot.roles.find((item) => item.role === role)
  if (!binding) throw new Error(`未知角色：${roleValue}`)
  if (!binding.enabled) throw new Error(`角色「${role}」已停用，请先在团队设置里开启`)
  const model = binding.model || snapshot.defaultModel || ''
  if (!splitTeamModel(model)) throw new Error(`角色「${role}」还没有绑定模型，请先在团队设置里选择`)
  return { snapshot, role, binding: { ...binding, model } }
}

/** 先确认模型切换成功，再按模型支持的档位设置思考深度。 */
export async function applyRoleRoute(binding: TeamRoleBinding, sessionFile: string): Promise<void> {
  const parts = splitTeamModel(binding.model)
  if (!parts) throw new Error(`角色「${binding.role}」的模型绑定无效`)
  const expected = `${parts.provider}/${parts.modelId}`
  const result = await workerManager.setModelWithThinking(parts.provider, parts.modelId, sessionFile)
  if (result.modelId !== expected && result.modelId !== parts.modelId) {
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
  worktreePath?: string
  branch?: string
  snapshot: TeamSnapshot
}

/**
 * 派发一张任务卡：依赖校验（已通过/已验收） → 并发上限校验 → Worktree 隔离（Builder）
 * → 后台会话 → 模型/思考深度 → 提示词 → 运行记录 → 卡片进「进行中」。
 */
export async function dispatchTeamTask(
  workspaceRoot: string,
  taskId: string,
  options: { trigger?: 'panel' | 'agent'; bypassGates?: boolean; sessionFile?: string | null } = {},
): Promise<DispatchResult> {
  const snapshot = readTeamSnapshot(workspaceRoot, { sessionFile: options.sessionFile })
  if (!snapshot.exists) throw new Error('当前项目还没有看板，请先初始化或接管老项目')
  const task = snapshot.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error(`找不到任务卡 ${taskId}，请刷新看板`)
  if (task.status === '已验收') throw new Error('这张卡已验收；要返工请先把它移回「进行中」')
  const role = canonicalTeamRole(task.role)
  const { binding } = roleBinding(workspaceRoot, role, options.sessionFile)

  const spec = teamSpecPath(workspaceRoot)
  if (!options.bypassGates) {
    const gate = checkTeamDispatchGates({
      role,
      prdText: readSpecFile(spec, 'PRD.md'),
      contractText: readSpecFile(spec, '02-方案契约.md'),
    })
    if (!gate.ok) throw new Error(gate.message)
  }

  for (const depId of task.dependsOn) {
    const dep = snapshot.tasks.find((item) => item.id === depId)
    if (!dep) throw new Error(`前置依赖 ${depId} 不在当前看板，请先修复依赖`)
    if (dep.status !== '已通过' && dep.status !== '已验收') {
      throw new Error(`前置依赖 ${depId} 尚未通过审查（当前：${dep.status}），不能抢跑`)
    }
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

  if (role === 'Builder') {
    const activeBuilders = snapshot.runs.filter(
      (run) => canonicalTeamRole(run.role) === 'Builder' && isTeamRunActive(run) && !run.staleAt && run.taskId !== taskId,
    )
    if (activeBuilders.length >= snapshot.maxConcurrency) {
      throw new Error(`当前已有 ${activeBuilders.length} 个并发 Builder 任务在跑（上限 ${snapshot.maxConcurrency}），请等前序完成或调高团队设置中的并发上限`)
    }
  }

  let worktreePath = task.worktreePath
  let branch = task.branch
  if (role === 'Builder') {
    if (worktreePath && existsSync(worktreePath)) {
      branch = branch || `team/${taskId.toLowerCase()}`
    } else {
      const targetBranch = branch || `team/${taskId.toLowerCase()}`
      const created = await createGitWorktree(workspaceRoot, targetBranch)
      if (created.ok) {
        worktreePath = created.path
        branch = created.branch
      } else {
        worktreePath = ''
        branch = ''
      }
    }
  }

  const taskForPrompt = worktreePath || branch ? { ...task, worktreePath, branch } : task
  const lessonsSnippet = extractRecentMemorySnippet(readSpecFile(spec, '错题本.md'))
  const tasteSnippet = extractRecentMemorySnippet(readSpecFile(spec, '品味账本.md'))
  const prompt = buildTeamPrompt({
    role,
    batch: snapshot.batch,
    goal: snapshot.goal,
    task: taskForPrompt,
    ...(lessonsSnippet ? { lessonsSnippet } : {}),
    ...(tasteSnippet ? { tasteSnippet } : {}),
  })
  const sessionCwd = worktreePath || workspaceRoot
  const session = await workerManager.newSessionInBackground(sessionCwd)
  if (!session.sessionFile) throw new Error('后台会话创建失败：没有拿到 sessionFile')
  const sessionFile = session.sessionFile
  titleRoleSession(sessionFile, `${role} · ${taskId}`)
  recordTeamDispatch(teamSpecPath(workspaceRoot), {
    taskId,
    role,
    sessionFile,
    sessionId: session.sessionId,
    model: binding.model,
    ...(options.sessionFile ? { originSessionFile: options.sessionFile } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    ...(branch ? { branch } : {}),
  })

  try {
    await applyRoleRoute(binding, sessionFile)
    await workerManager.sendPrompt(prompt, sessionFile)
    markTeamRunRunning(teamSpecPath(workspaceRoot), sessionFile)
  } catch (error) {
    // 会话已建但开工失败：留一条失败回执，卡片保持原状态，人能看到这轮没交付。
    settleTeamRun(teamSpecPath(workspaceRoot), workspaceRoot, sessionFile, 'failed')
    throw error
  }

  const note = options.trigger === 'agent' ? `已由团队工具派发给 ${role}` : `已派发给 ${role}`
  if (task.status !== '进行中' || worktreePath !== task.worktreePath || branch !== task.branch) {
    setTeamTaskStatus(workspaceRoot, {
      taskId,
      to: '进行中',
      from: task.status,
      autoNote: branch ? `${note}（分支 ${branch}）` : note,
      ...(worktreePath ? { worktreePath } : {}),
      ...(branch ? { branch } : {}),
    })
  }

  return {
    ok: true,
    sessionId: session.sessionId,
    sessionFile,
    role,
    taskId,
    model: binding.model,
    ...(worktreePath ? { worktreePath } : {}),
    ...(branch ? { branch } : {}),
    snapshot: readTeamSnapshot(workspaceRoot, { sessionFile: options.sessionFile }),
  }
}

export type MergeWorktreeResult = {
  ok: true
  taskId: string
  branch: string
  snapshot: TeamSnapshot
}

/**
 * 一键合并已通过任务卡的独立 Worktree 分支到主工作区当前分支，并自动清理临时 Worktree。
 * 若发生 Git 冲突，立即 abort 恢复现场并将卡片移入「阻塞 / 合并冲突」。
 */
export async function mergeTeamTaskWorktree(workspaceRoot: string, taskId: string): Promise<MergeWorktreeResult> {
  const snapshot = readTeamSnapshot(workspaceRoot)
  if (!snapshot.exists) throw new Error('当前项目还没有看板')
  const task = snapshot.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error(`找不到任务卡 ${taskId}，请刷新看板`)
  if (task.status !== '已通过' && task.status !== '已验收') {
    throw new Error(`只有「已通过」或「已验收」的任务卡才能合并（当前：${task.status}）`)
  }
  const branch = task.branch.trim()
  if (!branch) throw new Error(`任务卡 ${taskId} 没有关联独立分支，无需合并`)

  if (task.worktreePath && existsSync(task.worktreePath)) {
    const dirty = await gitExec(task.worktreePath, ['status', '--porcelain'], { timeout: 10000 })
    if (dirty.status === 0 && dirty.stdout.trim()) {
      const staged = await gitExec(task.worktreePath, ['add', '-A'], { timeout: 15000 })
      if (staged.status !== 0) {
        throw new Error(`暂存 Worktree 改动失败，已中止合并以保护现场：${staged.stderr || staged.stdout || 'unknown'}`)
      }
      const committed = await gitExec(
        task.worktreePath,
        ['commit', '-m', `${task.id}: ${task.title}`],
        { timeout: 15000 },
      )
      if (committed.status !== 0) {
        throw new Error(`自动提交 Worktree 改动失败，已中止合并以保护现场：${committed.stderr || committed.stdout || 'unknown'}`)
      }
    }
  }

  const ahead = await gitExec(workspaceRoot, ['rev-list', '--count', `HEAD..${branch}`], { timeout: 10000 })
  const aheadCount = ahead.status === 0 ? Number.parseInt(ahead.stdout.trim(), 10) : -1
  if (aheadCount === 0) {
    if (task.worktreePath) {
      await removeGitWorktree(workspaceRoot, task.worktreePath).catch(() => {})
    }
    await gitExec(workspaceRoot, ['branch', '-d', branch], { timeout: 10000 }).catch(() => {})
    setTeamTaskStatus(workspaceRoot, {
      taskId,
      to: task.status,
      from: task.status,
      worktreePath: null,
      branch: null,
      autoNote: `分支 ${branch} 无新增提交，已清理工作区`,
    })
    return {
      ok: true,
      taskId,
      branch,
      snapshot: readTeamSnapshot(workspaceRoot),
    }
  }

  const rootStatus = await gitExec(workspaceRoot, ['-c', 'core.quotepath=false', 'status', '--porcelain'], { timeout: 10000 })
  if (rootStatus.status === 0) {
    const dirtyEntries = rootStatus.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false
        const pathPart = line.slice(2).trim().replace(/^"/, '').replace(/\\/g, '/')
        return !pathPart.startsWith('.文档/') && pathPart !== '.文档'
      })
    if (dirtyEntries.length > 0) {
      throw new Error(`主工作区存在未提交改动（${dirtyEntries[0]}），请先提交或暂存后再合并，避免误触发冲突`)
    }
  }

  const merged = await gitExec(
    workspaceRoot,
    ['merge', '--no-ff', branch, '-m', `Merge ${task.id}: ${task.title}`],
    { timeout: 30000 },
  )
  if (merged.status !== 0) {
    await gitExec(workspaceRoot, ['merge', '--abort'], { timeout: 10000 }).catch(() => {})
    const detail = (merged.stderr || merged.stdout || '存在合并冲突').split(/\r?\n/).find((l) => l.trim())?.trim() || '存在合并冲突'
    setTeamTaskStatus(workspaceRoot, {
      taskId,
      to: '阻塞',
      from: task.status,
      blockType: '合并冲突',
      reason: `合并分支 ${branch} 失败：${detail}`,
    })
    throw new Error(`合并分支 ${branch} 失败：${detail}`)
  }

  if (task.worktreePath) {
    await removeGitWorktree(workspaceRoot, task.worktreePath).catch(() => {})
  }
  await gitExec(workspaceRoot, ['branch', '-d', branch], { timeout: 10000 }).catch(() => {})

  setTeamTaskStatus(workspaceRoot, {
    taskId,
    to: task.status,
    from: task.status,
    worktreePath: null,
    branch: null,
    autoNote: `已合并分支 ${branch} 并清理工作区`,
  })

  return {
    ok: true,
    taskId,
    branch,
    snapshot: readTeamSnapshot(workspaceRoot),
  }
}

export type DispatchReviewResult = {
  ok: true
  taskId: string
  sessionId: string
  sessionFile: string
  model: string
  snapshot: TeamSnapshot
}

/**
 * 派发独立 Verifier 审查一张「待审查」的任务卡：
 * 在独立后台会话中启动，不共享 Builder 聊天上下文；优先指向该卡 Worktree 目录。
 */
export async function dispatchTeamReview(
  workspaceRoot: string,
  taskId: string,
  options: { sessionFile?: string | null } = {},
): Promise<DispatchReviewResult> {
  const snapshot = readTeamSnapshot(workspaceRoot, { sessionFile: options.sessionFile })
  if (!snapshot.exists) throw new Error('当前项目还没有看板')
  const task = snapshot.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error(`找不到任务卡 ${taskId}，请刷新看板`)
  if (task.status !== '待审查') {
    throw new Error(`只有「待审查」的任务卡才能发起 Verifier 审查（当前：${task.status}）`)
  }
  const activeReview = snapshot.runs.find((run) => run.taskId === taskId && isTeamRunActive(run))
  if (activeReview) {
    if (!activeReview.staleAt) {
      throw new Error(`这张卡已有运行中的派发（${activeReview.role}），请勿重复发起审查`)
    }
    settleTeamRun(teamSpecPath(workspaceRoot), workspaceRoot, activeReview.sessionFile, 'cancelled', {
      note: '超时未落账，已被新的审查替代',
      closedBy: 'human',
      silent: true,
    })
  }
  const { role, binding } = roleBinding(workspaceRoot, 'Verifier', options.sessionFile)

  const spec = teamSpecPath(workspaceRoot)
  const lessonsSnippet = extractRecentMemorySnippet(readSpecFile(spec, '错题本.md'))
  const tasteSnippet = extractRecentMemorySnippet(readSpecFile(spec, '品味账本.md'))
  const prompt = buildTeamReviewPrompt({
    batch: snapshot.batch,
    goal: snapshot.goal,
    task,
    ...(lessonsSnippet ? { lessonsSnippet } : {}),
    ...(tasteSnippet ? { tasteSnippet } : {}),
  })

  const reviewCwd = task.worktreePath && existsSync(task.worktreePath) ? task.worktreePath : workspaceRoot
  const session = await workerManager.newSessionInBackground(reviewCwd)
  if (!session.sessionFile) throw new Error('Verifier 审查会话创建失败：没有拿到 sessionFile')
  const sessionFile = session.sessionFile
  titleRoleSession(sessionFile, `${role} · 审查 ${taskId}`)
  recordTeamDispatch(spec, {
    taskId,
    role,
    sessionFile,
    sessionId: session.sessionId,
    model: binding.model,
    ...(options.sessionFile ? { originSessionFile: options.sessionFile } : {}),
    ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
    ...(task.branch ? { branch: task.branch } : {}),
  })

  try {
    await applyRoleRoute(binding, sessionFile)
    await workerManager.sendPrompt(prompt, sessionFile)
    markTeamRunRunning(spec, sessionFile)
  } catch (error) {
    settleTeamRun(spec, workspaceRoot, sessionFile, 'failed')
    throw error
  }

  setTeamTaskStatus(workspaceRoot, {
    taskId,
    to: '待审查',
    from: '待审查',
    autoNote: '已派发 Verifier 独立审查',
  })

  return {
    ok: true,
    taskId,
    sessionId: session.sessionId,
    sessionFile,
    model: binding.model,
    snapshot: readTeamSnapshot(workspaceRoot, { sessionFile: options.sessionFile }),
  }
}

export type ReviewVerdictResult = {
  ok: true
  taskId: string
  verdict: 'pass' | 'reject'
  status: TeamStatus
  reworkCount: number
  circuitBroken?: boolean
  resumed?: boolean
  snapshot: TeamSnapshot
}

/**
 * 提交 Verifier 审查裁决：
 * - pass：推进到「已通过」，解锁下游依赖；
 * - reject：< 3 轮时原地唤醒原 Builder 会话在原 Worktree 秒修；>= 3 轮触发熔断转「阻塞 / 待用户确认」。
 */
export async function submitTeamReviewVerdict(
  workspaceRoot: string,
  input: { taskId: string; verdict: 'pass' | 'reject'; summary: string; issues?: string[] },
): Promise<ReviewVerdictResult> {
  const snapshot = readTeamSnapshot(workspaceRoot)
  if (!snapshot.exists) throw new Error('当前项目还没有看板')
  const task = snapshot.tasks.find((item) => item.id === input.taskId)
  if (!task) throw new Error(`找不到任务卡 ${input.taskId}，请刷新看板`)
  if (task.status !== '待审查') {
    throw new Error(`只有「待审查」的任务卡才能提交审查裁决（当前：${task.status}）`)
  }

  const spec = teamSpecPath(workspaceRoot)
  for (const run of snapshot.runs) {
    if (run.taskId === task.id && canonicalTeamRole(run.role) === 'Verifier' && isTeamRunActive(run)) {
      settleTeamRun(spec, workspaceRoot, run.sessionFile, 'success', {
        silent: true,
        closedBy: 'host',
        note: '已提交审查裁决',
      })
    }
  }

  const summary = sanitizeTeamText(input.summary, 600)
  const issues = (input.issues ?? []).map((item) => sanitizeTeamText(item, 300)).filter(Boolean)

  if (input.verdict === 'pass') {
    setTeamTaskStatus(workspaceRoot, {
      taskId: task.id,
      to: '已通过',
      from: task.status,
      autoNote: `Verifier 审查通过：${summary || '验收项全部达标'}`,
    })
    return {
      ok: true,
      taskId: task.id,
      verdict: 'pass',
      status: '已通过',
      reworkCount: task.reworkCount,
      snapshot: readTeamSnapshot(workspaceRoot),
    }
  }

  const nextRework = task.reworkCount + 1
  if (nextRework >= TEAM_MAX_REWORK_ROUNDS) {
    const detail = [summary, issues.length ? `问题：${issues.join('；')}` : ''].filter(Boolean).join('｜')
    setTeamTaskStatus(workspaceRoot, {
      taskId: task.id,
      to: '阻塞',
      from: task.status,
      blockType: '待用户确认',
      reworkCount: nextRework,
      reason: `连续 ${nextRework} 轮审查未通过触发熔断：${detail || '需主人拍板'}`,
    })
    return {
      ok: true,
      taskId: task.id,
      verdict: 'reject',
      status: '阻塞',
      reworkCount: nextRework,
      circuitBroken: true,
      snapshot: readTeamSnapshot(workspaceRoot),
    }
  }

  setTeamTaskStatus(workspaceRoot, {
    taskId: task.id,
    to: '进行中',
    from: task.status,
    reworkCount: nextRework,
    autoNote: `Verifier 打回返工（第 ${nextRework}/${TEAM_MAX_REWORK_ROUNDS} 轮）：${summary || '见审查缺陷清单'}`,
  })

  let resumed = false
  const builderRun = [...snapshot.runs]
    .reverse()
    .find((run) => run.taskId === task.id && canonicalTeamRole(run.role) === 'Builder' && existsSync(run.sessionFile))

  if (builderRun) {
    const spec = teamSpecPath(workspaceRoot)
    const issueLines = issues.length ? issues.map((item, i) => `${i + 1}. ${item}`).join('\n') : `- ${summary}`
    recordTeamDispatch(spec, {
      taskId: task.id,
      role: 'Builder',
      sessionFile: builderRun.sessionFile,
      sessionId: builderRun.sessionId,
      ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
      ...(task.branch ? { branch: task.branch } : {}),
    })
    try {
      await workerManager.sendPrompt(
        `Verifier 审查未通过（第 ${nextRework}/${TEAM_MAX_REWORK_ROUNDS} 轮返工），请就在当前 Worktree 修复以下问题：\n\n结论：${summary}\n\n问题清单：\n${issueLines}\n\n修复并自检通过后在当前分支提交改动，重新给出「交付摘要」与「验证」证据。`,
        builderRun.sessionFile,
      )
      markTeamRunRunning(spec, builderRun.sessionFile)
      resumed = true
    } catch (error) {
      settleTeamRun(spec, workspaceRoot, builderRun.sessionFile, 'failed', { silent: true })
      console.warn('[team-board] 原地唤醒 Builder 返工失败，尝试重派：', error)
    }
  }

  if (!resumed && canonicalTeamRole(task.role) === 'Builder') {
    try {
      await dispatchTeamTask(workspaceRoot, task.id, { trigger: 'agent', bypassGates: true })
      resumed = true
    } catch (error) {
      console.warn('[team-board] 返工重派 Builder 失败：', error)
    }
  }

  return {
    ok: true,
    taskId: task.id,
    verdict: 'reject',
    status: '进行中',
    reworkCount: nextRework,
    circuitBroken: false,
    resumed,
    snapshot: readTeamSnapshot(workspaceRoot),
  }
}

export type ResumeRunResult = {
  ok: true
  taskId: string
  role: string
  sessionId?: string
  sessionFile: string
  model: string
  snapshot: TeamSnapshot
}

/**
 * 断点续跑同一个子代理会话：保留原 sessionFile 与 Worktree，
 * 先收回旧的活跃/超时记录再重开运行中记录，避免从头重做。
 */
export async function resumeTeamRun(
  workspaceRoot: string,
  input: { sessionFile: string; taskId?: string; note?: string; contextSessionFile?: string | null },
): Promise<ResumeRunResult> {
  const snapshot = readTeamSnapshot(workspaceRoot, { sessionFile: input.contextSessionFile })
  if (!snapshot.exists) throw new Error('当前项目还没有看板')
  const spec = teamSpecPath(workspaceRoot)
  const target = [...snapshot.runs]
    .reverse()
    .find((run) => run.sessionFile === input.sessionFile || (!input.sessionFile && input.taskId && run.taskId === input.taskId))
  if (!target) throw new Error('找不到对应的子代理派发记录，请刷新看板后重试')
  if (!existsSync(target.sessionFile)) throw new Error('该子代理的会话文件已不存在，请改用「派发开工」新建会话')

  const originSessionFile = target.originSessionFile || input.contextSessionFile || undefined
  const { role, binding } = roleBinding(workspaceRoot, target.role, originSessionFile)

  if (isTeamRunActive(target)) {
    settleTeamRun(spec, workspaceRoot, target.sessionFile, 'cancelled', {
      note: '手动触发断点续跑，替代前一轮记录',
      closedBy: 'human',
      silent: true,
    })
  }

  recordTeamDispatch(spec, {
    taskId: target.taskId,
    role,
    sessionFile: target.sessionFile,
    sessionId: target.sessionId,
    model: binding.model,
    ...(originSessionFile ? { originSessionFile } : {}),
    ...(target.worktreePath ? { worktreePath: target.worktreePath } : {}),
    ...(target.branch ? { branch: target.branch } : {}),
  })

  try {
    await applyRoleRoute(binding, target.sessionFile)
  } catch (error) {
    console.warn('[team-board] 续跑切换模型失败，保留原会话模型继续：', error)
  }

  const customNote = sanitizeTeamText(input.note, 1000)
  const resumePrompt =
    `上一轮执行中断，请直接从当前工作区和已有改动处继续完成任务卡 ${target.taskId}（不要推倒重来）。` +
    (customNote ? `\n\n补充指引：${customNote}` : '') +
    `\n\n完成后自检并给出「交付摘要」与「验证」证据。`

  try {
    await workerManager.sendPrompt(resumePrompt, target.sessionFile)
    markTeamRunRunning(spec, target.sessionFile)
  } catch (error) {
    settleTeamRun(spec, workspaceRoot, target.sessionFile, 'failed')
    throw error
  }

  const task = snapshot.tasks.find((item) => item.id === target.taskId)
  if (task && (task.status === '待办' || task.status === '阻塞')) {
    setTeamTaskStatus(workspaceRoot, {
      taskId: task.id,
      to: '进行中',
      from: task.status,
      autoNote: `已断点续跑 ${role} 会话`,
    })
  }

  return {
    ok: true,
    taskId: target.taskId,
    role,
    sessionId: target.sessionId,
    sessionFile: target.sessionFile,
    model: binding.model,
    snapshot: readTeamSnapshot(workspaceRoot, { sessionFile: originSessionFile }),
  }
}
