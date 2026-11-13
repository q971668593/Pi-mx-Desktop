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
      await expect(win.getByRole('button', { name: '切换项目排序' })).toHaveAttribute('aria-pressed', 'true')

      const demo = projects.filter({ has: win.getByRole('button', { name: 'Expand or collapse sessions in demo', exact: true }) })
      await demo.getByRole('button', { name: 'New session', exact: true }).click()
      await agent.send('First sidebar conversation')
      await expect(demo.getByText('First sidebar conversation', { exact: true })).toBeVisible()
      await demo.getByRole('button', { name: 'New session', exact: true }).click()
      await agent.send('Second sidebar conversation')
      const sessions = demo.locator('[data-session-file] .sidebar-session-row')
      await expect(sessions).toHaveCount(2)
      await expect(sessions.first()).toContainText('Second sidebar conversation')
      await sessions.first().dragTo(sessions.last(), { targetPosition: { x: 55, y: 30 } })
      await expect(sessions.first()).toContainText('First sidebar conversation')

      await win.reload()
      await expect(projects.first()).toHaveAttribute('data-workspace', second)
      const expandDemo = demo.getByRole('button', { name: 'Expand or collapse sessions in demo', exact: true })
      if (await expandDemo.getAttribute('aria-expanded') === 'false') await expandDemo.click()
      await expect(sessions.first()).toContainText('First sidebar conversation')
      await win.screenshot({ path: test.info().outputPath('project-cards.png') })
      await projects.first().locator('.sidebar-project-hit').click({ button: 'right' })
      await win.getByRole('button', { name: '隐藏项目', exact: true }).click()
      await expect(projects).toHaveCount(1)
      await win.getByRole('button', { name: '管理隐藏项目' }).click()
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
