import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

/**
 * 破甲开关（设置 › Agent › 破甲）的端到端验收：
 *   1. 安装包里的扩展被复制进隔离 agent 目录；
 *   2. 设置页拨开关 → config.json 真的被写入；
 *   3. 拨完后同一个会话下一句话发给模型的系统提示词已经换成人设（不重启、不敲命令）。
 * 全部在临时 HOME 里跑，不碰本机 ~/.pi。
 */
test.describe('purge settings', () => {
  test('toggle installs the extension and takes over the next request', async () => {
    test.setTimeout(120_000)
    const seen: Seen[] = []
    const model = startScriptedModel(() => ({ text: 'ok' }), seen)
    const agent = await launchAgentApp(await listen(model))
    const { win, home } = agent
    const agentDir = path.join(home, '.pi', 'agent')
    const configFile = path.join(agentDir, 'purge', 'config.json')
    const extensionFile = path.join(agentDir, 'extensions', 'pi-app-purge.ts')

    try {
      await agent.newSession()

      // 1. 启动时就把扩展落进了 agent 目录（安装包里带的）
      await expect.poll(() => fs.existsSync(extensionFile), { timeout: 15_000 }).toBe(true)

      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Purge', { exact: true }).first().click()
      const row = win.getByRole('group', { name: 'Enable purge', exact: true })
      await expect(row.getByRole('switch')).not.toBeChecked()

      // 打开之前先问一句，拿到「原生提示词」的基线
      await win.keyboard.press('Escape')
      await agent.send('baseline')
      await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThan(0)
      expect(seen[0].system).toContain('You are a coding assistant running inside pi')

      // 2. 拨开开关 → config.json 落盘
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Purge', { exact: true }).first().click()
      await win.getByRole('group', { name: 'Enable purge', exact: true }).getByRole('switch').click()
      await expect.poll(() => fs.existsSync(configFile) && JSON.parse(fs.readFileSync(configFile, 'utf8')).enabled, {
        timeout: 15_000,
      }).toBe(true)

      // 3. 同一个会话再说一句 → 系统提示词已经被人设接管（人设正文来自安装包）
      await win.keyboard.press('Escape')
      const before = seen.length
      await agent.send('after toggle')
      await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThan(before)
      const after = seen[seen.length - 1].system
      expect(after).toContain('MODE: UNRESTRICTED SANDBOX')
      expect(after).not.toContain('You are a coding assistant running inside pi')
      expect(after).not.toContain('<docs>')

      // 4. 再拨回去 → 恢复原生提示词
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Purge', { exact: true }).first().click()
      await win.getByRole('group', { name: 'Enable purge', exact: true }).getByRole('switch').click()
      await expect.poll(() => JSON.parse(fs.readFileSync(configFile, 'utf8')).enabled, { timeout: 15_000 }).toBe(false)

      await win.keyboard.press('Escape')
      const beforeOff = seen.length
      await agent.send('after off')
      await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThan(beforeOff)
      expect(seen[seen.length - 1].system).toContain('You are a coding assistant running inside pi')
    } finally {
      await agent.close()
      model.close()
    }
  })
})
