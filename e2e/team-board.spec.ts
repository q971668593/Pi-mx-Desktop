import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

/**
 * 工作团队面板：真实 Electron + 脚本模型。
 * 覆盖「看板渲染 → 卡片详情 → 后台派发 → 会话结束自动落账」整条链路。
 */
test('team board renders the project board and settles a background dispatch', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-team-e2e-'))
  const project = path.join(home, 'code', 'demo')
  const specDir = path.join(project, '.文档', '开发规范')
  const boardFile = path.join(specDir, '看板', '当前批次.md')
  fs.mkdirSync(path.dirname(boardFile), { recursive: true })
  fs.writeFileSync(
    boardFile,
    `# 看板：当前批次

## 批次信息

- 当前批次：订单模块
- 目标：完成下单主流程

## 任务索引

| 编号 | 标题 | 角色 | 状态 | 一句话 |
|------|------|------|------|--------|
| T-001 | 登录页 | 前端 | 进行中 | 账号密码登录 |

## 卡片详情

### T-001 登录页

- 角色：前端
- 状态：进行中
- 产出：src/pages/login.vue

- [ ] 账号密码可登录
`,
  )
  const roles = ['Leader', '设计师', '前端', '后端', '质量测试'].map((role) => ({
    role,
    model: 'mock/scripted',
    effort: '',
    note: role,
    enabled: true,
    directEnabled: true,
  }))
  fs.writeFileSync(path.join(specDir, '角色配置.json'), JSON.stringify({ version: 2, scope: 'project', roles }, null, 2))

  const seen: Seen[] = []
  const server = startScriptedModel(() => ({ text: '已收到任务，开始执行。' }), seen)
  const port = await listen(server)
  const app = await launchAgentApp(port, { home, language: 'zh' })
  try {
    const win = app.win
    // 右侧栏默认可能是收起状态；先展开，再点项目上的「新会话」激活工作区。
    await win.evaluate(() => {
      const store = window.__piE2E.useUIStore.getState()
      if (store.rightPanelCollapsed) store.toggleRightPanel()
    })
    const addSession = win.locator('.sidebar-project-add').first()
    if (await addSession.count()) {
      await addSession.click()
      await win.waitForTimeout(2000)
    }
    await win.getByRole('tab', { name: '工作团队' }).click()
    await expect(win.getByText('订单模块')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByText('登录页')).toBeVisible()
    await win.screenshot({ path: 'test-results/team-board-panel.png' })

    await win.getByText('登录页').click()
    await expect(win.getByRole('dialog', { name: 'T-001 登录页' })).toBeVisible()
    // 验收标准与「看板原文」里都会出现这行字：只看抽屉里的验收项，避免 strict 冲突。
    await expect(win.getByRole('dialog', { name: 'T-001 登录页' }).getByText('账号密码可登录').first()).toBeVisible()
    await win.screenshot({ path: 'test-results/team-board-card.png' })

    await win.getByRole('button', { name: '派发开工' }).click()
    // 卡片先进入「进行中」（已是进行中则不写），随后会话结束自动落到「待审查」。
    await expect.poll(() => fs.readFileSync(boardFile, 'utf8'), { timeout: 45_000 }).toContain('- 状态：待审查')
    expect(fs.readFileSync(path.join(specDir, '协作', '团队.json'), 'utf8')).toContain('"settledTo": "待审查"')
    expect(seen.length).toBeGreaterThan(0)
    await win.screenshot({ path: 'test-results/team-board-after-dispatch.png' })
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
