import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { defaultTeamRoleBindings, type TeamSnapshot } from '@shared/team-board'
import { TeamBoardPanel } from './team-board-panel'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({ activateWorkspace: vi.fn(async () => {}) }))

const workspaceId = 'C:/proj'

function snapshot(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    workspaceId,
    specPath: `${workspaceId}/.文档/开发规范`,
    boardFile: `${workspaceId}/.文档/开发规范/看板/当前批次.md`,
    exists: true,
    batch: '订单模块',
    goal: '完成下单主流程',
    tasks: [
      {
        id: 'T-001',
        title: '登录页',
        role: '前端',
        status: '进行中',
        wave: 'W1',
        input: 'PRD 登录章节',
        output: 'src/pages/login.vue',
        dependsOn: [],
        note: '沿用现有表单',
        blockType: '',
        manualNote: '',
        autoNote: '',
        approval: '',
        approvalNote: '',
        acceptance: [{ text: '账号密码可登录', done: false }],
        raw: 'T-001 登录页',
      },
      {
        id: 'T-002',
        title: '支付接口',
        role: '后端',
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
        acceptance: [],
        raw: 'T-002 支付接口',
      },
    ],
    roles: defaultTeamRoleBindings().map((role) => (role.role === '前端' ? { ...role, model: 'acme/front' } : role)),
    sessions: {},
    runs: [],
    autoTeam: false,
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
  useUIStore.setState({ currentWorkspace: workspaceId, sessionRuntimeRunning: {} })
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'teamBoard.snapshot') return { ok: true, snapshot: snapshot() }
    return {}
  })
})

afterEach(cleanup)

describe('TeamBoardPanel', () => {
  it('shows the current batch, the five-role dock and the task lanes', async () => {
    render(<TeamBoardPanel />)
    expect(await screen.findByText('订单模块')).toBeInTheDocument()
    expect(screen.getByText('完成下单主流程')).toBeInTheDocument()
    for (const role of ['Leader', '设计师', '前端', '后端', '质量测试']) {
      expect(screen.getAllByText(role).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('登录页')).toBeInTheDocument()
    expect(screen.getByText('支付接口')).toBeInTheDocument()
    expect(screen.getByText('0/2 已验收')).toBeInTheDocument()
  })

  it('changes a status through the card sheet', async () => {
    const next = snapshot({
      tasks: snapshot().tasks.map((task) => (task.id === 'T-001' ? { ...task, status: '待审查' as const } : task)),
    })
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'teamBoard.snapshot') return { ok: true, snapshot: snapshot() }
      if (channel === 'teamBoard.taskStatus') return { ok: true, from: '进行中', changed: true, snapshot: next }
      return {}
    })
    render(<TeamBoardPanel />)
    fireEvent.click(await screen.findByText('登录页'))
    const dialog = await screen.findByRole('dialog', { name: 'T-001 登录页' })
    fireEvent.click(within(dialog).getByText('待审查'))
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('teamBoard.taskStatus', {
        workspaceId,
        taskId: 'T-001',
        to: '待审查',
        from: '进行中',
      }),
    )
  })

  it('gates manual acceptance behind an explicit confirmation', async () => {
    render(<TeamBoardPanel />)
    fireEvent.click(await screen.findByText('登录页'))
    const dialog = await screen.findByRole('dialog', { name: 'T-001 登录页' })
    fireEvent.click(within(dialog).getByText('已验收'))
    expect(await within(dialog).findByText('人工验收')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: '确认' })
    expect(confirm).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '真机验证主流程' } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('teamBoard.taskStatus', {
        workspaceId,
        taskId: 'T-001',
        to: '已验收',
        from: '进行中',
        reason: '真机验证主流程',
        manualConfirmed: true,
      }),
    )
  })

  it('surfaces a pending approval and sends the decision back', async () => {
    const pending = snapshot({
      tasks: snapshot().tasks.map((task) =>
        task.id === 'T-001'
          ? { ...task, status: '阻塞' as const, blockType: '待用户确认', approval: '外发测试邮件给 200 个用户 · 不可撤回' }
          : task,
      ),
    })
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'teamBoard.snapshot') return { ok: true, snapshot: pending }
      if (channel === 'teamBoard.approval') return { ok: true, from: '阻塞', to: '进行中', request: pending.tasks[0].approval, resumed: true, snapshot: pending }
      return {}
    })
    render(<TeamBoardPanel />)
    expect(await screen.findByText('1 待批准')).toBeInTheDocument()
    expect(screen.getByText('待批准')).toBeInTheDocument()

    fireEvent.click(screen.getAllByText('登录页')[0])
    const dialog = await screen.findByRole('dialog', { name: 'T-001 登录页' })
    expect(within(dialog).getByText('等你批准')).toBeInTheDocument()
    expect(within(dialog).getByText('外发测试邮件给 200 个用户 · 不可撤回')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByPlaceholderText('可选：批准条件或驳回原因'), { target: { value: '只发内测名单' } })
    fireEvent.click(within(dialog).getByText('批准并继续'))
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('teamBoard.approval', {
        workspaceId,
        taskId: 'T-001',
        decision: 'approve',
        note: '只发内测名单',
        from: '阻塞',
      }),
    )
  })

  it('dispatches a card to a background session', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'teamBoard.snapshot') return { ok: true, snapshot: snapshot() }
      if (channel === 'teamBoard.dispatch') return { ok: true, sessionFile: 'C:/sessions/front.jsonl', model: 'acme/front', snapshot: snapshot() }
      return {}
    })
    render(<TeamBoardPanel />)
    fireEvent.click(await screen.findByText('登录页'))
    const dialog = await screen.findByRole('dialog', { name: 'T-001 登录页' })
    fireEvent.click(within(dialog).getByText('派发开工'))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('teamBoard.dispatch', { workspaceId, taskId: 'T-001' }))
  })

  it('offers initialization when the project has no board yet', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'teamBoard.snapshot') return { ok: true, snapshot: snapshot({ exists: false }) }
      return {}
    })
    render(<TeamBoardPanel />)
    expect(await screen.findByText('还没有项目看板')).toBeInTheDocument()
    fireEvent.click(screen.getByText('初始化看板'))
    expect(await screen.findByRole('dialog', { name: '初始化工作团队' })).toBeInTheDocument()
  })
})
