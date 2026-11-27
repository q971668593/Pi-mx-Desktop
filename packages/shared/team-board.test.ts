import { describe, expect, it } from 'vitest'
import {
  appendTeamTask,
  buildTeamPrompt,
  deriveTeamStage,
  isTeamRunActive,
  normalizeTeamRoleBindings,
  normalizeTeamStatus,
  parseTeamBoard,
  resolveTeamApproval,
  sanitizeTeamText,
  splitTeamModel,
  teamProgress,
  updateTeamTaskStatus,
  type TeamRun,
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
      role: 'Builder',
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
        role: 'Verifier',
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
  it('normalizes legacy seven-role config to the four-role team', () => {
    const roles = normalizeTeamRoleBindings([
      { role: '产品经理', model: 'a/b', effort: 'HIGH' },
      { role: 'UI审查', model: 'a/c' },
      { role: '测试', model: 'a/d', enabled: false },
      { role: '前端', model: 'a/e', directEnabled: false },
      { role: '后端', model: 'a/f' },
      { role: '设计师', model: 'a/g' },
      { role: '质量测试', model: 'a/h' },
    ])
    expect(roles.map((role) => role.role)).toEqual(['Leader', 'Builder', 'Verifier', 'Designer'])
    expect(roles[0]).toMatchObject({ model: 'a/b', effort: 'high' })
    expect(roles[1]).toMatchObject({ model: 'a/e', directEnabled: false })
    // 同一角色重复时保留第一条（Verifier 来自 UI审查，Designer 来自 设计师）
    expect(roles[2]).toMatchObject({ model: 'a/c' })
    expect(roles[3]).toMatchObject({ model: 'a/g' })
    expect(splitTeamModel(roles[0].model)).toEqual({ provider: 'a', modelId: 'b' })
  })

  it('fills missing roles with defaults and rejects broken effort values', () => {
    const roles = normalizeTeamRoleBindings([{ role: '前端', model: 'x/y', effort: '很深' }])
    expect(roles).toHaveLength(4)
    expect(roles[1]).toMatchObject({ role: 'Builder', model: 'x/y', effort: '', enabled: true })
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
    expect(prompt).toContain('# 角色：Builder')
    expect(prompt).toContain('覆盖空态、加载、失败')
    expect(prompt).toContain('当前批次：订单模块')
    expect(prompt).toContain('T-001 登录页')
    expect(prompt).toContain('- [ ] 账号密码可登录')
    expect(prompt).toContain('team_board')
    expect(prompt).toContain('只动自己这张卡')
    expect(prompt).toContain('交付摘要')
  })
})

describe('appendTeamTask', () => {
  it('adds the next numbered card to both the index and the detail area', async () => {
    const board = `# 看板：当前批次

## 批次信息

- 当前批次：订单模块
- 目标：完成下单

## 任务索引

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|------|------|------|------|--------|
| T-001 | 登录页 | 前端 | 进行中 | 登录 |

---

## 卡片详情

### T-001 登录页

- 角色：前端
- 状态：进行中

---

## 归档规则

保留。
`
    const result = appendTeamTask(board, {
      title: '支付回调',
      role: '后端',
      acceptance: ['回调幂等', '失败可重试'],
      output: 'src/api/pay.ts',
      note: '等商户号',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.id).toBe('T-002')
    expect(result.markdown).toContain('| T-002 | 支付回调 | Builder | 待办 | 等商户号 |')
    expect(result.markdown).toContain('### T-002 支付回调')
    expect(result.markdown).toContain('- [ ] 回调幂等')
    // 新卡在详情区（第一个 --- 之前），不是归档规则后面
    const detail = result.markdown.split('## 归档规则')[0]
    expect(detail).toContain('### T-002 支付回调')
    expect(result.markdown.split('## 归档规则')[1]).not.toContain('### T-002')
  })

  it('rejects an empty title', () => {
    expect(appendTeamTask('', { title: '  ', role: '前端' })).toEqual({ ok: false, reason: 'empty_title' })
  })
})

describe('index-only cards', () => {
  it('creates a detail section before changing an old card that only lives in the index', () => {
    const old = `# 看板

## 批次信息

- 当前批次：老项目
- 目标：接管

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|---|---|---|---|---|
| T-009 | 盘点代码 | 质量测试 | 待办 | 没有详情段 |

## 归档规则

保留。
`
    const result = updateTeamTaskStatus(old, { id: 'T-009', to: '进行中', from: '待办', autoNote: '开工' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain('### T-009 盘点代码')
    expect(result.markdown).toContain('- 状态：进行中')
    expect(result.markdown.indexOf('### T-009')).toBeLessThan(result.markdown.indexOf('## 归档规则'))
  })
})

/* ---------------- 阶段推导 / 审批 / 清洗 ---------------- */

const APPROVAL_BOARD = `# 看板：当前批次

## 批次信息

- 当前批次：订单模块
- 目标：完成下单主流程

## 任务索引

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|------|------|------|------|--------|
| T-003 | 发通知 | 后端 | 阻塞 | 需要外发 |

## 卡片详情

### T-003 发通知

- 角色：后端
- 状态：阻塞
- 阻塞分型：待用户确认
- 待批准：给 200 个用户发上线通知邮件 · 外发不可撤回

- [ ] 通知可回滚
`

function run(overrides: Partial<TeamRun> = {}): TeamRun {
  return {
    id: 'run-1',
    taskId: 'T-003',
    role: '后端',
    sessionFile: 'C:/sessions/a.jsonl',
    status: 'running',
    startedAt: 1_000,
    ...overrides,
  }
}

describe('team stage derivation', () => {
  it('reads a pending approval out of the card, whatever the status says', () => {
    const task = parseTeamBoard(APPROVAL_BOARD).tasks[0]
    expect(task.approval).toContain('给 200 个用户发上线通知邮件')
    expect(deriveTeamStage({ task })).toBe('awaiting-approval')
    expect(deriveTeamStage({ task: { ...task, approval: '', status: '阻塞' } })).toBe('awaiting-approval')
    expect(deriveTeamStage({ task: { ...task, approval: '', blockType: '外部依赖', status: '阻塞' } })).toBe('blocked')
  })

  it('separates queued, running, stale and failed dispatches', () => {
    const task = parseTeamBoard(APPROVAL_BOARD).tasks[0]
    const working = { ...task, status: '进行中' as const, approval: '', blockType: '' }
    expect(deriveTeamStage({ task: working, run: run({ status: 'starting' }) })).toBe('queued')
    expect(deriveTeamStage({ task: working, run: run() })).toBe('running')
    expect(deriveTeamStage({ task: working, run: run({ staleAt: 5_000 }) })).toBe('stale')
    expect(deriveTeamStage({ task: working, run: run({ status: 'failed' }) })).toBe('failed')
    expect(deriveTeamStage({ task: working })).toBe('idle')
    expect(deriveTeamStage({ task: { ...working, status: '待审查' } })).toBe('awaiting-review')
    expect(deriveTeamStage({ task: { ...working, status: '已验收' } })).toBe('accepted')
    expect(isTeamRunActive(run())).toBe(true)
    expect(isTeamRunActive(run({ status: 'done' }))).toBe(false)
  })
})

describe('resolveTeamApproval', () => {
  it('approves back into 进行中 and leaves an auditable decision line', () => {
    const result = resolveTeamApproval(APPROVAL_BOARD, {
      id: 'T-003',
      decision: 'approve',
      note: '只发已确认名单',
      at: '2026-02-01T00:00:00.000Z',
      from: '阻塞',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request).toContain('上线通知邮件')
    expect(result.to).toBe('进行中')
    expect(result.markdown).not.toContain('- 待批准：')
    expect(result.markdown).not.toContain('- 阻塞分型：')
    expect(result.markdown).toContain('- 批准：2026-02-01T00:00:00.000Z · 只发已确认名单')
    expect(result.markdown).toContain('| T-003 | 发通知 | 后端 | 进行中 | 需要外发 |')
  })

  it('denies into 阻塞 / 待用户确认 without touching the index row', () => {
    const result = resolveTeamApproval(APPROVAL_BOARD, { id: 'T-003', decision: 'deny', note: '先不发' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.to).toBe('阻塞')
    expect(result.markdown).toContain('- 驳回：')
    expect(result.markdown).toContain('- 阻塞分型：待用户确认')
    expect(result.markdown).toContain('| T-003 | 发通知 | 后端 | 阻塞 | 需要外发 |')
  })

  it('refuses a card with nothing pending and honours the optimistic status check', () => {
    const noPending = APPROVAL_BOARD.replace('- 待批准：给 200 个用户发上线通知邮件 · 外发不可撤回\n', '')
    expect(resolveTeamApproval(noPending, { id: 'T-003', decision: 'approve' })).toEqual({
      ok: false,
      reason: 'no_pending_approval',
      current: '阻塞',
    })
    expect(resolveTeamApproval(APPROVAL_BOARD, { id: 'T-003', decision: 'approve', from: '进行中' })).toEqual({
      ok: false,
      reason: 'status_mismatch',
      current: '阻塞',
    })
    expect(resolveTeamApproval(APPROVAL_BOARD, { id: 'T-404', decision: 'approve' })).toEqual({
      ok: false,
      reason: 'task_not_found',
    })
  })
})

describe('text sanitizing', () => {
  it('strips terminal/bidi control characters and collapses lines', () => {
    expect(sanitizeTeamText('发\u001b[31m通知\n第二行\u202e')).toBe('发 [31m通知 第二行')
    expect(sanitizeTeamText('x'.repeat(400), 20)).toHaveLength(20)
  })

  it('keeps a hostile auto note on one line inside the card', () => {
    const result = updateTeamTaskStatus(APPROVAL_BOARD, {
      id: 'T-003',
      to: '待审查',
      from: '阻塞',
      autoNote: '第一行\u0007\u001b第二行\n### T-999 伪造卡',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 没换行就构不成新标题：只在同一行里当文本
    expect(result.markdown.split('\n').some((line) => line.startsWith('### T-999'))).toBe(false)
    expect(result.markdown).toContain('- 自动推进：')
    expect(result.markdown.split('\n').filter((line) => line.startsWith('- 自动推进：'))).toHaveLength(1)
  })
})
