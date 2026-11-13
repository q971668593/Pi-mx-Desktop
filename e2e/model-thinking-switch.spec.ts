import { expect, test } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test('switching models updates the current thinking level and the picker limits', async () => {
  const model = startScriptedModel(() => ({ text: 'Ready.' }), [])
  try {
    const agent = await launchAgentApp(await listen(model), { reasoningModel: true })
    try {
      await agent.newSession()
      await agent.send('Create a session for model switching')
      const { win } = agent
      await expect(win.getByText('Ready.', { exact: true }).last()).toBeVisible()
      const chip = win.locator('[data-composer-model-chip]')
      const thinking = win.locator('[data-composer-thinking-chip]')
      const choose = async (id: string) => {
        await chip.click()
        await win.getByRole('textbox', { name: /search model/i }).fill(id)
        await win.getByRole('button').filter({ has: win.getByText(id, { exact: true }) }).last().click()
        await expect(chip).toHaveText(id)
      }
      await choose('scripted-reasoner')
      await expect(thinking).toContainText('High')
      await choose('scripted')
      await expect(thinking).toContainText('Off')
      await thinking.click()
      await expect(win.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Off')
      await expect(win.getByRole('slider')).toHaveAttribute('aria-valuemax', '0')
      await win.keyboard.press('Escape')
      await choose('scripted-reasoner')
      await expect(thinking).toContainText('High')
    } finally { await agent.close() }
  } finally { model.close() }
})
