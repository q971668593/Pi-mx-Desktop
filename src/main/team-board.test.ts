import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bindTeamSession,
  createTeamTask,
  initTeamProject,
  markTeamRunRunning,
  readTeamRoles,
  readTeamSnapshot,
  readTeamState,
  recordTeamDispatch,
  resolveTeamTaskApproval,
  saveTeamRoles,
  settleTeamRun,
  setTeamTaskStatus,
  sweepTeamRuns,
  teamBoardPath,
  teamSpecPath,
} from './team-board'

const roots: string[] = []

function workspace(): { root: string; spec: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-team-board-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return { root, spec: teamSpecPath(root) }
}

function writeBoard(root: string, cardStatus = '进行中'): void {
  const board = `# 看板：当前批次

## 批次信息

- 当前批次：订单模块
- 目标：完成下单主流程

## 任务索引

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|------|------|------|------|--------|
| T-001 | 登录页 | 前端 | ${cardStatus} | 账号密码登录 |

## 卡片详情

### T-001 登录页

- 角色：前端
- 状态：${cardStatus}

- [ ] 账号密码可登录
`
  writeFileSync(teamBoardPath(root), board, 'utf8')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('initTeamProject', () => {
  it('creates the project skeleton and the five-role config only once', () => {
    const { root, spec } = workspace()
    const snapshot = initTeamProject(root, { name: '演示项目' })
    expect(snapshot.exists).toBe(true)
    expect(snapshot.batch).toBe('需求梳理')
    expect(snapshot.roles.map((role) => role.role)).toEqual(['Leader', '设计师', '前端', '后端', '质量测试'])
    for (const file of ['看板/当前批次.md', 'PRD.md', '00-总入口.md', '错题本.md', '品味账本.md', '角色配置.json', '角色配置.md']) {
      expect(existsSync(join(spec, file)), file).toBe(true)
    }
    expect(readFileSync(join(spec, '00-总入口.md'), 'utf8')).toContain('演示项目')
    expect(() => initTeamProject(root)).toThrow('已初始化')
  })

  it('uses the inventory PRD when taking over an old project', () => {
    const { root, spec } = workspace()
    initTeamProject(root, { mode: 'legacy' })
    expect(readFileSync(join(spec, 'PRD.md'), 'utf8')).toContain('待盘点')
  })

  it('refuses a workspace that does not exist', () => {
    expect(() => initTeamProject(join(tmpdir(), 'pi-team-missing-' + Date.now()))).toThrow('工作区目录不可用')
  })
})

describe('role config', () => {
  it('keeps refs/notifications written by another tool when saving from the panel', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    const file = join(spec, '角色配置.json')
    writeFileSync(file, JSON.stringify({
      version: 2,
      scope: 'project',
      roles: [
        { role: '前端', model: 'old/model', refs: ['协议/01.md'], notifications: 'quiet' },
      ],
    }))
    saveTeamRoles(spec, [{ role: '前端', model: 'a/front', effort: 'high', enabled: true, directEnabled: true }])
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { roles: Array<Record<string, unknown>> }
    const front = saved.roles.find((role) => role.role === '前端')
    expect(front).toMatchObject({ model: 'a/front', effort: 'high', refs: ['协议/01.md'], notifications: 'quiet' })
  })

  it('saves project roles and keeps a readable mirror', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    saveTeamRoles(spec, [
      { role: 'Leader', model: 'a/leader', effort: 'high', enabled: true, directEnabled: true, note: '协调' },
      { role: '前端', model: 'a/frontend', effort: 'medium', enabled: true, directEnabled: false, note: '实现' },
    ])
    const roles = readTeamRoles(spec)
    expect(roles).toHaveLength(5)
    expect(roles[0]).toMatchObject({ role: 'Leader', model: 'a/leader', effort: 'high' })
    expect(roles[2]).toMatchObject({ role: '前端', model: 'a/frontend', directEnabled: false })
    expect(readFileSync(join(spec, '角色配置.md'), 'utf8')).toContain('| 前端 | a/frontend | medium | 开启 | 禁用 |')
  })
})

describe('task status', () => {
  it('writes the status through the lock and reports conflicts instead of overwriting', () => {
    const { root } = workspace()
    initTeamProject(root)
    writeBoard(root)
    const first = setTeamTaskStatus(root, {
      taskId: 'T-001',
      to: '待审查',
      from: '进行中',
      autoNote: '前端会话结束',
    })
    expect(first.ok).toBe(true)
    expect(readFileSync(teamBoardPath(root), 'utf8')).toContain('| T-001 | 登录页 | 前端 | 待审查 | 账号密码登录 |')

    const conflict = setTeamTaskStatus(root, { taskId: 'T-001', to: '待办', from: '进行中' })
    expect(conflict).toEqual({ ok: false, reason: 'status_mismatch', current: '待审查' })

    const missing = setTeamTaskStatus(root, { taskId: 'T-404', to: '待办' })
    expect(missing).toEqual({ ok: false, reason: 'task_not_found' })
  })

  it('returns the refreshed snapshot after a manual acceptance', () => {
    const { root } = workspace()
    initTeamProject(root)
    writeBoard(root)
    const result = setTeamTaskStatus(root, {
      taskId: 'T-001',
      to: '已验收',
      from: '进行中',
      manual: true,
      reason: '真机验证',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.tasks[0]).toMatchObject({ status: '已验收', acceptance: [{ text: '账号密码可登录', done: true }] })
    expect(readFileSync(teamBoardPath(root), 'utf8')).toContain('人工验收，原自动报告保留')
  })
})

describe('createTeamTask', () => {
  it('creates cards with sequential ids and persists the acceptance list', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    const first = createTeamTask(root, {
      title: '登录页',
      role: '前端',
      output: 'src/pages/login.vue',
      acceptance: ['账号密码可登录'],
    })
    expect(first.tasks[0]).toMatchObject({ id: 'T-001', title: '登录页', role: '前端', status: '待办' })
    expect(first.tasks[0].acceptance).toEqual([{ text: '账号密码可登录', done: false }])
    const second = createTeamTask(root, { title: '支付接口', role: '后端' })
    expect(second.tasks.map((task) => task.id)).toEqual(['T-001', 'T-002'])
    expect(readFileSync(join(spec, '看板/当前批次.md'), 'utf8')).toContain('### T-002 支付接口')
  })
})

describe('dispatch runs', () => {
  it('records a background session and moves the card to 待审查 when it finishes', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    writeBoard(root)
    bindTeamSession(spec, '前端', { sessionFile: 'C:/sessions/front-chat.jsonl', sessionId: 'chat-1' })
    const run = recordTeamDispatch(spec, {
      taskId: 'T-001',
      role: '前端',
      sessionFile: 'C:/sessions/front.jsonl',
      sessionId: 's-1',
    })
    expect(run.status).toBe('starting')
    // 派发是任务会话，不能把角色坞的常驻会话覆盖掉
    expect(readTeamState(spec).sessions['前端']).toMatchObject({ sessionFile: 'C:/sessions/front-chat.jsonl', sessionId: 'chat-1' })
    markTeamRunRunning(spec, 'C:/sessions/front.jsonl')
    expect(readTeamState(spec).runs[0].status).toBe('running')

    const settled = settleTeamRun(spec, root, 'C:/sessions/front.jsonl', 'success')
    expect(settled).toMatchObject({ settled: true, movedTo: '待审查' })
    const board = readFileSync(teamBoardPath(root), 'utf8')
    expect(board).toContain('- 状态：待审查')
    expect(board).toContain('自动推进：')
    expect(readTeamState(spec).runs[0]).toMatchObject({ status: 'done', settledTo: '待审查' })

    // 重复事件不能把卡再动一次
    expect(settleTeamRun(spec, root, 'C:/sessions/front.jsonl', 'success')).toEqual({ settled: false })
  })

  it('leaves the status alone but records the failure receipt', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    writeBoard(root)
    recordTeamDispatch(spec, { taskId: 'T-001', role: '前端', sessionFile: 'C:/sessions/fail.jsonl' })
    const settled = settleTeamRun(spec, root, 'C:/sessions/fail.jsonl', 'failed')
    expect(settled.settled).toBe(true)
    expect(settled.movedTo).toBeNull()
    const board = readFileSync(teamBoardPath(root), 'utf8')
    expect(board).toContain('- 状态：进行中')
    expect(board).toContain('本轮执行失败/中止')
  })

  it('binds a role conversation without a task', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    expect(bindTeamSession(spec, '设计', { sessionFile: 'C:/sessions/design.jsonl' })).toBe('设计师')
    expect(readTeamState(spec).sessions['设计师']).toMatchObject({ sessionFile: 'C:/sessions/design.jsonl' })
    expect(readTeamSnapshot(root).sessions['设计师']).toBeTruthy()
  })
})

/* ---------------- 看门狗 / 审批 ---------------- */

function session(root: string, name: string, ageMs = 0): string {
  const file = join(root, name)
  writeFileSync(file, '{"type":"message"}\n')
  if (ageMs > 0) {
    const seconds = (Date.now() - ageMs) / 1000
    utimesSync(file, seconds, seconds)
  }
  return file
}

/** 让看门狗以为过了 31 分钟，而不用真的等。 */
function afterStaleWindow(): { now: number } {
  return { now: Date.now() + 31 * 60 * 1000 }
}

function writeApprovalBoard(root: string): void {
  const board = `# 看板：当前批次

## 批次信息

- 当前批次：订单模块
- 目标：完成下单主流程

## 任务索引

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|------|------|------|------|--------|
| T-001 | 登录页 | 前端 | 阻塞 | 账号密码登录 |

## 卡片详情

### T-001 登录页

- 角色：前端
- 状态：阻塞
- 阻塞分型：待用户确认
- 待批准：外发测试邮件给 200 个用户 · 不可撤回

- [ ] 账号密码可登录
`
  writeFileSync(teamBoardPath(root), board, 'utf8')
}

describe('run watchdog', () => {
  it('flags a dispatch that stopped moving and blocks the card exactly once', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    writeBoard(root)
    const file = session(root, 'dead.jsonl')
    recordTeamDispatch(spec, { taskId: 'T-001', role: '前端', sessionFile: file })
    markTeamRunRunning(spec, file)

    const first = sweepTeamRuns(spec, root, afterStaleWindow())
    expect(first.stale.map((run) => run.taskId)).toEqual(['T-001'])
    expect(first.blocked).toEqual(['T-001'])
    expect(readTeamState(spec).runs[0].staleAt).toBeGreaterThan(0)
    const board = readFileSync(teamBoardPath(root), 'utf8')
    expect(board).toContain('- 状态：阻塞')
    expect(board).toContain('- 阻塞分型：待用户确认')
    expect(board).toContain('派发超过 30 分钟没有结束事件')

    // 第二次 tick：不再重复报阻塞，但仍旧把它列在 stale 里给面板提示
    const second = sweepTeamRuns(spec, root, afterStaleWindow())
    expect(second.blocked).toEqual([])
    expect(second.stale).toHaveLength(1)
  })

  it('leaves a dispatch that is still writing its session alone', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    writeBoard(root)
    const file = session(root, 'live.jsonl')
    recordTeamDispatch(spec, { taskId: 'T-001', role: '前端', sessionFile: file })
    markTeamRunRunning(spec, file)
    // 时间过去了 31 分钟，但会话文件到这一刻还在写：不算死。
    const window = afterStaleWindow()
    const seconds = window.now / 1000
    utimesSync(file, seconds, seconds)
    const result = sweepTeamRuns(spec, root, window)
    expect(result.stale).toEqual([])
    expect(result.blocked).toEqual([])
    expect(readFileSync(teamBoardPath(root), 'utf8')).toContain('- 状态：进行中')
  })

  it('does not touch a card that is waiting for an approval', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    writeApprovalBoard(root)
    writeFileSync(
      teamBoardPath(root),
      readFileSync(teamBoardPath(root), 'utf8').replace('- 状态：阻塞', '- 状态：进行中'),
      'utf8',
    )
    const file = session(root, 'wait.jsonl')
    recordTeamDispatch(spec, { taskId: 'T-001', role: '前端', sessionFile: file })
    markTeamRunRunning(spec, file)
    const result = sweepTeamRuns(spec, root, afterStaleWindow())
    expect(result.blocked).toEqual([])
    expect(readFileSync(teamBoardPath(root), 'utf8')).toContain('- 待批准：')
  })

  it('settle records a typed report and clears the stale mark', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    writeBoard(root)
    const file = session(root, 'dead.jsonl')
    recordTeamDispatch(spec, { taskId: 'T-001', role: '前端', sessionFile: file })
    markTeamRunRunning(spec, file)
    sweepTeamRuns(spec, root, afterStaleWindow())

    const settled = settleTeamRun(spec, root, file, 'success', { closedBy: 'human', note: '人工核对后收口' })
    expect(settled.settled).toBe(true)
    const run = readTeamState(spec).runs[0]
    expect(run.staleAt).toBeUndefined()
    expect(run.closedBy).toBe('human')
    expect(run.report).toMatchObject({ kind: 'ready', text: '人工核对后收口', verdict: 'deliver' })
  })

  it('keeps the settlement idempotent when the same session reports twice', () => {
    const { root, spec } = workspace()
    initTeamProject(root)
    writeBoard(root)
    const file = session(root, 'once.jsonl')
    recordTeamDispatch(spec, { taskId: 'T-001', role: '前端', sessionFile: file })
    markTeamRunRunning(spec, file)
    expect(settleTeamRun(spec, root, file, 'failed').settled).toBe(true)
    expect(settleTeamRun(spec, root, file, 'success')).toEqual({ settled: false })
    expect(readTeamState(spec).runs[0].report?.kind).toBe('failed')
  })
})

describe('card approval', () => {
  it('approves into 进行中 and returns the exact request', () => {
    const { root } = workspace()
    initTeamProject(root)
    writeApprovalBoard(root)
    const result = resolveTeamTaskApproval(root, { taskId: 'T-001', decision: 'approve', note: '只发内测名单', from: '阻塞' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.to).toBe('进行中')
    expect(result.request).toContain('外发测试邮件')
    expect(result.snapshot.tasks[0].status).toBe('进行中')
    expect(result.snapshot.tasks[0].approval).toBe('')
    expect(result.snapshot.tasks[0].approvalNote).toContain('只发内测名单')
  })

  it('denies and keeps the card blocked pending the user', () => {
    const { root } = workspace()
    initTeamProject(root)
    writeApprovalBoard(root)
    const result = resolveTeamTaskApproval(root, { taskId: 'T-001', decision: 'deny', note: '先别发' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.to).toBe('阻塞')
    expect(result.snapshot.tasks[0].blockType).toBe('待用户确认')
    expect(result.snapshot.tasks[0].approvalNote).toContain('先别发')
  })

  it('reports a missing pending request instead of silently editing the card', () => {
    const { root } = workspace()
    initTeamProject(root)
    writeBoard(root)
    expect(resolveTeamTaskApproval(root, { taskId: 'T-001', decision: 'approve' })).toEqual({
      ok: false,
      reason: 'no_pending_approval',
      current: '进行中',
    })
  })
})
