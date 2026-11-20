import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamSnapshot } from '@shared/team-board'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn((): { ok: true; cwd: string } | { ok: false; error: string } => ({ ok: true, cwd: '/proj' })),
  readTeamSnapshot: vi.fn(),
  createTeamTask: vi.fn(),
  setTeamTaskStatus: vi.fn(),
  dispatchTeamTask: vi.fn(),
}))

vi.mock('./trusted-workspace', () => ({ authorizeProjectCwd: mocks.authorize }))
vi.mock('./team-board', () => ({
  readTeamSnapshot: mocks.readTeamSnapshot,
  createTeamTask: mocks.createTeamTask,
  setTeamTaskStatus: mocks.setTeamTaskStatus,
  teamSpecPath: (root: string) => `${root}/.文档/开发规范`,
}))
vi.mock('./team-board-ops', () => ({ dispatchTeamTask: mocks.dispatchTeamTask }))

import { handleTeamToolRequest } from './team-board-tool-bridge'

function snapshot(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    workspaceId: '/proj',
    specPath: '/proj/.文档/开发规范',
    boardFile: '/proj/.文档/开发规范/看板/当前批次.md',
    exists: true,
    batch: '订单模块',
    goal: '完成下单',
    tasks: [
      {
        id: 'T-001',
        title: '登录页',
        role: '前端',
        status: '待办',
        wave: '',
        input: '',
        output: '',
        dependsOn: [],
        note: '',
        blockType: '',
        manualNote: '',
        autoNote: '',
        approval: '',
        approvalNote: '',
        acceptance: [{ text: '账号可登录', done: false }],
        raw: 'T-001 登录页',
      },
    ],
    roles: [
      { role: '前端', model: 'mock/scripted', effort: '', note: '', enabled: true, directEnabled: true },
    ],
    sessions: {},
    runs: [],
    ...overrides,
  } as TeamSnapshot
}

function call(args: Record<string, unknown>) {
  const posted: Array<Record<string, unknown>> = []
  return handleTeamToolRequest({ callId: 'c1', args }, { cwd: '/proj' }, (message) => posted.push(message))
    .then(() => posted[0] as { type: string; result: { content: Array<{ text: string }>; isError?: boolean } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockReturnValue({ ok: true, cwd: '/proj' })
  mocks.readTeamSnapshot.mockReturnValue(snapshot())
  mocks.setTeamTaskStatus.mockReturnValue({ ok: true, from: '待办', changed: true, snapshot: snapshot() })
})

describe('team_board tool bridge', () => {
  it('summarizes the board for snapshot', async () => {
    const posted = await call({ action: 'snapshot' })
    expect(posted.type).toBe('team-tool-response')
    expect(posted.result.isError).toBeUndefined()
    const payload = JSON.parse(posted.result.content[0].text)
    expect(payload.batch).toBe('订单模块')
    expect(payload.tasks[0]).toMatchObject({ id: 'T-001', role: '前端', acceptance: '0/1' })
    expect(payload.roles[0]).toMatchObject({ role: '前端', dispatchable: true })
  })

  it('refuses when the project has no board yet', async () => {
    mocks.readTeamSnapshot.mockReturnValue(snapshot({ exists: false }))
    const posted = await call({ action: 'snapshot' })
    expect(posted.result.isError).toBe(true)
    expect(posted.result.content[0].text).toContain('还没有工作团队看板')
  })

  it('creates cards and reports their ids', async () => {
    const withTwo = snapshot({
      tasks: [snapshot().tasks[0], { ...snapshot().tasks[0], id: 'T-002', title: '支付接口', role: '后端' }],
    })
    mocks.readTeamSnapshot.mockReturnValueOnce(snapshot()).mockReturnValue(withTwo)
    mocks.createTeamTask
      .mockReturnValueOnce({ ...withTwo, tasks: [withTwo.tasks[0]] })
      .mockReturnValueOnce(withTwo)

    const posted = await call({
      action: 'create_task',
      tasks: [
        { title: '登录页', role: '前端', acceptance: ['账号可登录'] },
        { title: '支付接口', role: '后端' },
      ],
    })
    expect(mocks.createTeamTask).toHaveBeenCalledTimes(2)
    expect(mocks.createTeamTask.mock.calls[0][1]).toMatchObject({ title: '登录页', role: '前端', acceptance: ['账号可登录'] })
    expect(JSON.parse(posted.result.content[0].text).created).toEqual(['T-002'])
  })

  it('rejects an unknown role and an empty batch', async () => {
    expect((await call({ action: 'create_task', tasks: [{ title: 'x', role: '保洁' }] })).result.isError).toBe(true)
    expect((await call({ action: 'create_task', tasks: [] })).result.isError).toBe(true)
  })

  it('never lets the model accept a card', async () => {
    const posted = await call({ action: 'move_task', taskId: 'T-001', status: '已验收' })
    expect(posted.result.isError).toBe(true)
    expect(mocks.setTeamTaskStatus).not.toHaveBeenCalled()
  })

  it('requires a block type when blocking', async () => {
    const posted = await call({ action: 'move_task', taskId: 'T-001', status: '阻塞' })
    expect(posted.result.isError).toBe(true)
    expect(mocks.setTeamTaskStatus).not.toHaveBeenCalled()

    await call({ action: 'move_task', taskId: 'T-001', status: '阻塞', blockType: '缺环境/工具', reason: '没有测试机' })
    expect(mocks.setTeamTaskStatus).toHaveBeenCalledWith('/proj', {
      taskId: 'T-001',
      to: '阻塞',
      blockType: '缺环境/工具',
      reason: '没有测试机',
    })
  })

  it('dispatches through the shared ops layer', async () => {
    mocks.dispatchTeamTask.mockResolvedValue({
      ok: true,
      taskId: 'T-001',
      role: '前端',
      sessionFile: '/s/run.jsonl',
      model: 'mock/scripted',
      snapshot: snapshot(),
    })
    const posted = await call({ action: 'dispatch', taskId: 'T-001' })
    expect(mocks.dispatchTeamTask).toHaveBeenCalledWith('/proj', 'T-001', { trigger: 'agent' })
    expect(posted.result.isError).toBeUndefined()
    expect(JSON.parse(posted.result.content[0].text).sessionFile).toBe('/s/run.jsonl')
  })

  it('surfaces a dispatch failure as a tool error', async () => {
    mocks.dispatchTeamTask.mockRejectedValue(new Error('前置依赖 T-000 尚未验收'))
    const posted = await call({ action: 'dispatch', taskId: 'T-001' })
    expect(posted.result.isError).toBe(true)
    expect(posted.result.content[0].text).toContain('前置依赖')
  })

  it('rejects an untrusted workspace', async () => {
    mocks.authorize.mockReturnValue({ ok: false, error: 'cwd_not_trusted' })
    const posted = await call({ action: 'snapshot' })
    expect(posted.result.isError).toBe(true)
  })
})
