import { expect, test } from '@playwright/test'
import { listen, launchAgentApp, startScriptedModel } from './helpers/scripted-agent'

/**
 * A brand-new conversation must show up under its project as soon as it exists — not after the
 * first turn finishes, and not only after the user clicks the project (which refreshes the list).
 * The model is deliberately slow so the turn is still running while the row is asserted.
 */
test('new conversation appears under its project while the first turn is still running', async () => {
  const server = startScriptedModel(() => ({ text: 'working on it', delayMs: 8000 }), [])
  const port = await listen(server)
  const agent = await launchAgentApp(port)
  const { win } = agent
  try {
    await win.waitForTimeout(2000)
    await win.locator('button[aria-label="New session"], button[aria-label="新建会话"], button[aria-label="新会话"]').first().click()
    await win.waitForTimeout(500)
    await win.locator('[contenteditable="true"]').last().click()
    await win.keyboard.type('make a checklist')
    await win.keyboard.press('Enter')

    const rows = win.locator('[data-session-file]')
    await expect(rows).toHaveCount(1, { timeout: 20_000 })
    // The title comes from the first message, not the list process' "(no messages)" placeholder.
    await expect(rows.first()).toContainText('make a checklist')
    console.log('[e2e] row appeared:', await rows.first().innerText())
  } finally {
    await agent.close()
    server.close()
  }
})
