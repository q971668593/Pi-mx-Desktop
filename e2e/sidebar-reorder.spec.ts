import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test('project and session drag order survive reload, and hidden projects restore from the dialog', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-sidebar-'))
  const project = path.join(home, 'code', 'demo')
  const second = path.join(home, 'code', 'other')
  fs.mkdirSync(second, { recursive: true })
  const model = startScriptedModel(() => ({ text: 'Ready.' }), [])
  try {
    const agent = await launchAgentApp(await listen(model), { home, config: { recentProjects: [project, second] } })
    try {
      const { win } = agent
      const projects = win.locator('.sidebar-project-card[data-workspace]')
      await expect(projects).toHaveCount(2)
      await expect(projects.first()).toHaveAttribute('data-workspace', project)
      await projects.first().locator('.sidebar-project-header').dragTo(projects.last().locator('.sidebar-project-header'), { targetPosition: { x: 55, y: 35 } })
      await expect(projects.first()).toHaveAttribute('data-workspace', second)
      // 排序/标题开关已搬到 设置 → 侧栏；这里只验证拖动结果本身（重新加载后仍然生效，见文件末尾断言）

      const demo = projects.filter({ has: win.getByRole('button', { name: 'Expand or collapse sessions in demo', exact: true }) })
      await demo.getByRole('button', { name: 'New session', exact: true }).click()
      await agent.send('First sidebar conversation')
      await expect(demo.getByText('First sidebar conversation', { exact: true })).toBeVisible()
      await demo.getByRole('button', { name: 'New session', exact: true }).click()
      await agent.send('Second sidebar conversation')
      const sessions = demo.locator('[data-session-file] .sidebar-session-row')
      await expect(sessions).toHaveCount(2)
      // 会话顺序 = 用户最后发送时间优先（会话级手动拖拽已按设计移除，不能再靠拖动改序）
      await expect(sessions.first()).toContainText('Second sidebar conversation')
      await sessions.filter({ hasText: 'First sidebar conversation' }).click()
      await agent.send('First sidebar conversation again')
      await expect(sessions.first()).toContainText('First sidebar conversation')

      await win.reload()
      await expect(projects.first()).toHaveAttribute('data-workspace', second)
      const expandDemo = demo.getByRole('button', { name: 'Expand or collapse sessions in demo', exact: true })
      if (await expandDemo.getAttribute('aria-expanded') === 'false') await expandDemo.click()
      await expect(sessions.first()).toContainText('First sidebar conversation')
      await win.screenshot({ path: test.info().outputPath('project-cards.png') })
      // 右键菜单是 portal：reload 之后侧栏还在刷会话列表，菜单可能被重渲染卸载（元素 detached）。
      // 先等侧栏稳定，再把「开菜单 + 点菜单项」整体重试；单次等待加长没用，元素会换新的。
      await win.waitForTimeout(800)
      const hideItem = win.getByRole('button', { name: '隐藏项目', exact: true })
      let hidden = false
      for (let attempt = 0; attempt < 4 && !hidden; attempt += 1) {
        await projects.first().locator('.sidebar-project-hit').click({ button: 'right' })
        try {
          await hideItem.click({ timeout: 5_000 })
          hidden = true
        } catch {
          await win.keyboard.press('Escape').catch(() => {})
        }
      }
      await expect(projects).toHaveCount(1)
      // 「管理隐藏项目」按钮的 aria-label 跟随界面语言，用结构选择器找它
      await win.locator('.sidebar-section-action[aria-haspopup="dialog"]').click()
      const dialog = win.getByRole('dialog', { name: /隐藏的项目/ })
      await expect(dialog).toBeVisible()
      const centered = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 2
          && Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 2
      })
      expect(centered).toBe(true)
      await dialog.getByRole('searchbox').fill('missing')
      await expect(dialog.getByText('没有匹配的项目')).toBeVisible()
      await dialog.getByRole('searchbox').fill('other')
      const restore = dialog.getByRole('button', { name: '恢复', exact: true })
      const restoreInView = await restore.evaluate((button) =>
        button.getBoundingClientRect().right <= button.closest('.hidden-projects-results')!.getBoundingClientRect().right)
      expect(restoreInView).toBe(true)
      await win.screenshot({ path: test.info().outputPath('hidden-projects.png') })
      await restore.click()
      await expect(dialog.getByText('没有隐藏的项目')).toBeVisible()
      await win.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(projects.first()).toHaveAttribute('data-workspace', second)
    } finally { await agent.close() }
  } finally { model.close() }
})
