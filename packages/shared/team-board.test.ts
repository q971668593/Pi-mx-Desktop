import { describe, expect, it } from 'vitest'
import {
  buildTeamPrompt,
  normalizeTeamRoleBindings,
  normalizeTeamStatus,
  parseTeamBoard,
  splitTeamModel,
  teamProgress,
  updateTeamTaskStatus,
} from './team-board'

const BOARD = `# 看板：当前批次

> 正式任务进度依据（协议 01）。

## 批次信息

- 当前批次：订单模块
- 目标：完成下单与支付主流程

## 任务索引

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|------|------|------|------|--------|
| T-001 | 登录页 | 前端 | 进行中 | 账号密码登录 |
| T-002 | 支付接口 | 后端 | 阻塞 | 等商户号 |

---

## 卡片详情

### T-001 登录页

- 角色：前端
- 状态：进行中
- 波次：W1
- 输入：PRD 登录章节
- 产出：src/pages/login.vue
- 依赖：
- 备注：沿用现有表单

- [ ] 账号密码可登录
- [x] 空态提示

### T-002 支付接口

- 角色：后端
- 状态：阻塞
- 阻塞分型：外部依赖
- 人工处理：2026-01-02T00:00:00.000Z · 待办 → 阻塞 · 等商户号

- [ ] 支付成功回调幂等

---

## 归档规则

轮次由插件保存与切换。
`

describe('parseTeamBoard', () => {
  it('reads batch info, cards and acceptance state', () => {
    const board = parseTeamBoard(BOARD)
    expect(board.batch).toBe('订单模块')
    expect(board.goal).toBe('完成下单与支付主流程')
    expect(board.tasks.map((task) => task.id)).toEqual(['T-001', 'T-002'])
    const login = board.tasks[0]
    expect(login).toMatchObject({
      title: '登录页',
      role: '前端',
      status: '进行中',
      wave: 'W1',
      output: 'src/pages/login.vue',
      note: '沿用现有表单',
    })
    expect(login.acceptance).toEqual([
      { text: '账号密码可登录', done: false },
      { text: '空态提示', done: true },
    ])
    expect(board.tasks[1]).toMatchObject({ status: '阻塞', blockType: '外部依赖' })
  })

  it('falls back to index rows when the card detail is missing', () => {
    const board = parseTeamBoard(`## 批次信息

- 当前批次：老项目
- 目标：接管

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|---|---|---|---|---|
| T-009 | 盘点代码 | 质量测试 | 待认领 | 没有详情段 |

`)
    expect(board.tasks).toEqual([
      expect.objectContaining({
        id: 'T-009',
        title: '盘点代码',
        role: '质量测试',
        status: '待办',
        note: '没有详情段',
        raw: '',
      }),
    ])
  })

  it('normalizes legacy statuses and roles', () => {
    expect(normalizeTeamStatus('待认领')).toBe('待办')
    expect(normalizeTeamStatus('完成')).toBe('已验收')
    expect(normalizeTeamStatus('进行中（前端）')).toBe('进行中')
    expect(normalizeTeamStatus('奇怪状态')).toBe('待办')
    expect(teamProgress(parseTeamBoard(BOARD).tasks)).toEqual({
      total: 2,
      accepted: 0,
      blocked: 1,
      inProgress: 1,
      review: 0,
    })
  })
})

describe('updateTeamTaskStatus', () => {
  it('writes both the detail and the index, keeps CRLF and records the human note', () => {
    const crlf = BOARD.replace(/\n/g, '\r\n')
    const result = updateTeamTaskStatus(crlf, {
      id: 'T-001',
      to: '已验收',
      from: '进行中',
      at: '2026-02-01T00:00:00.000Z',
      manual: true,
      reason: '真机验证通过',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.from).toBe('进行中')
    expect(result.markdown).toContain('\r\n')
    expect(result.markdown).not.toMatch(/[^\r]\n/)
    expect(result.markdown).toContain('| T-001 | 登录页 | 前端 | 已验收 | 账号密码登录 |')
    expect(result.markdown).toContain('- 状态：已验收')
    expect(result.markdown).toContain('- 人工处理：2026-02-01T00:00:00.000Z · 进行中 → 已验收 · 真机验证通过（人工验收，原自动报告保留）')
    expect(result.markdown).toContain('- [x] 账号密码可登录')
    // 另一张卡不受影响
    expect(result.markdown).toContain('### T-002 支付接口\r\n\r\n- 角色：后端\r\n- 状态：阻塞')
  })

  it('refuses to overwrite a status that changed since the card was read', () => {
    const result = updateTeamTaskStatus(BOARD, { id: 'T-001', to: '待办', from: '待办' })
    expect(result).toEqual({ ok: false, reason: 'status_mismatch', current: '进行中' })
  })

  it('clears acceptance ticks when a card leaves 已验收 and removes stale block type', () => {
    const accepted = BOARD.replace('- 状态：进行中', '- 状态：已验收').replace('- [ ] 账号密码可登录', '- [x] 账号密码可登录')
    const result = updateTeamTaskStatus(accepted, { id: 'T-001', to: '进行中', from: '已验收', autoNote: '重新开工' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain('- [ ] 账号密码可登录')
    expect(result.markdown).toContain('- 自动推进：')
    expect(result.markdown).toContain('· 已验收 → 进行中 · 重新开工')
  })

  it('adds a block type when the card moves into 阻塞 and drops it when it leaves', () => {
    const blocked = updateTeamTaskStatus(BOARD, { id: 'T-001', to: '阻塞', from: '进行中', blockType: '缺环境/工具' })
    expect(blocked.ok).toBe(true)
    if (!blocked.ok) return
    expect(blocked.markdown).toContain('- 阻塞分型：缺环境/工具')
    const freed = updateTeamTaskStatus(blocked.markdown, { id: 'T-001', to: '进行中', from: '阻塞' })
    expect(freed.ok).toBe(true)
    if (!freed.ok) return
    expect(freed.markdown).not.toContain('- 阻塞分型：缺环境/工具')
  })

  it('reports a missing task instead of silently succeeding', () => {
    expect(updateTeamTaskStatus(BOARD, { id: 'T-404', to: '待办' })).toEqual({ ok: false, reason: 'task_not_found' })
  })
})

describe('role bindings', () => {
  it('normalizes old seven-role config to the five-role team', () => {
    const roles = normalizeTeamRoleBindings([
      { role: '产品经理', model: 'a/b', effort: 'HIGH' },
      { role: 'UI审查', model: 'a/c' },
      { role: '测试', model: 'a/d', enabled: false },
      { role: '前端', model: 'a/e', directEnabled: false },
      { role: '后端', model: 'a/f' },
      { role: '设计师', model: 'a/g' },
      { role: '质量测试', model: 'a/h' },
    ])
    expect(roles.map((role) => role.role)).toEqual(['Leader', '设计师', '前端', '后端', '质量测试'])
    expect(roles[0]).toMatchObject({ model: 'a/b', effort: 'high' })
    expect(roles[2]).toMatchObject({ model: 'a/e', directEnabled: false })
    // 同一角色重复时保留第一条（质量测试来自 UI审查）
    expect(roles[4]).toMatchObject({ model: 'a/c' })
    expect(splitTeamModel(roles[0].model)).toEqual({ provider: 'a', modelId: 'b' })
  })

  it('fills missing roles with defaults and rejects broken effort values', () => {
    const roles = normalizeTeamRoleBindings([{ role: '前端', model: 'x/y', effort: '很深' }])
    expect(roles).toHaveLength(5)
    expect(roles[2]).toMatchObject({ role: '前端', model: 'x/y', effort: '', enabled: true })
    expect(splitTeamModel('no-slash')).toBeNull()
  })
})

describe('buildTeamPrompt', () => {
  it('includes role rules, project context, card and the hard working agreement', () => {
    const board = parseTeamBoard(BOARD)
    const prompt = buildTeamPrompt({
      role: '前端',
      batch: board.batch,
      goal: board.goal,
      task: board.tasks[0],
    })
    expect(prompt).toContain('# 角色：前端')
    expect(prompt).toContain('覆盖空态、加载、失败')
    expect(prompt).toContain('当前批次：订单模块')
    expect(prompt).toContain('### T-001 登录页')
    expect(prompt).toContain('- [ ] 账号密码可登录')
    expect(prompt).toContain('不要修改 `看板/当前批次.md`')
    expect(prompt).toContain('交付摘要')
  })
})
