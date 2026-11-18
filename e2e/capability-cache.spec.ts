import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

/**
 * Capability switches must not rewrite the cached prompt prefix: on a model that accepts system
 * messages mid-conversation, pi records the change as a section update after the prefix.
 */
test.describe('capability switches keep the prompt cache', () => {
  test('switching browser control on and off only appends section updates', async () => {
    test.setTimeout(120_000)
    const seen: Seen[] = []
    const model = startScriptedModel((_first, _tools, last) => ({ text: `re ${last}` }), seen)
    const agent = await launchAgentApp(await listen(model))
    try {
      const file = path.join(agent.home, '.pi', 'agent', 'models.json')
      const config = JSON.parse(fs.readFileSync(file, 'utf8'))
      config.providers.mock.compat = { ...config.providers.mock.compat, supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true }
      fs.writeFileSync(file, JSON.stringify(config))

      await agent.newSession()
      const turn = async (text: string, count: number) => {
        await agent.send(text)
        await expect.poll(() => seen.length, { timeout: 30_000 }).toBe(count)
        await expect(agent.win.getByText(`re ${text}`)).toBeVisible()
      }
      // 默认就带内置浏览器（DEFAULT_CAPABILITIES 含 browser），所以先关再开：
      // 关闭/开启都必须只追加 section 更新，而不是重写缓存前缀。
      await turn('one', 1)

      await agent.disableBrowserControl()
      await turn('two', 2)

      await agent.enableBrowserControl()
      await turn('three', 3)

      const head = (s: Seen) => s.messages[0]
      expect(head(seen[0]).role).toBe('system')
      // The leading system message (the cached prefix) never changes.
      expect(head(seen[1]).text).toBe(head(seen[0]).text)
      expect(head(seen[2]).text).toBe(head(seen[0]).text)
      // 首轮默认带内置浏览器段；关掉之后它必须从「增量 section」里消失
      expect(head(seen[0]).text).toContain('# Built-in browser')

      const updates = (s: Seen) => s.messages.slice(1).filter((m) => m.role === 'system' || m.role === 'developer').map((m) => m.text).join('\n')
      expect(updates(seen[1])).toContain('Removed system prompt section "desktop_browser".')
      expect(updates(seen[2])).toContain('Updated system prompt section "desktop_browser"')
      // Switching back keeps the declared tools (removing them would resend the whole tool list).
      expect(seen[2].tools).toEqual(seen[1].tools)
      // Earlier turns stay byte-identical in later requests, so the provider can reuse them.
      expect(seen[2].messages.slice(0, seen[1].messages.length).map((m) => m.text)).toEqual(seen[1].messages.map((m) => m.text))
    } finally {
      await agent.close()
      model.close()
    }
  })
})
