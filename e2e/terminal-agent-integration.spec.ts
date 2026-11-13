import { expect, test } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

test('agent starts, inspects, and restarts a visible project terminal', async () => {
  const seen: Seen[] = []
  const model = startScriptedModel((_first, results) => {
    if (results.length === 0) return { tool: { name: 'desktop_terminal', args: { action: 'start', command: 'node', args: ['-e', "console.log('SIDEBAR_AGENT_READY'); setInterval(() => {}, 1000)"], label: 'agent-service' } } }
    if (results.length === 1) return { tool: { name: 'desktop_terminal', args: { action: 'list' } } }
    if (results.length === 2) return { tool: { name: 'desktop_terminal', args: { action: 'restart', id: JSON.parse(results[0]).id } } }
    return { text: 'Terminal started.' }
  }, seen)
  const agent = await launchAgentApp(await listen(model), { config: { rightPanelPrefs: { files: true, terminal: true, git: true, run: true, browser: false }, rightPanelCollapsed: false } })
  try {
    await agent.newSession()
    await agent.send('Start a terminal and inspect it')
    await expect.poll(() => seen.some((request) => request.tools.includes('desktop_terminal'))).toBe(true)
    await expect.poll(() => seen.some((request) => request.toolTexts.length >= 3), { timeout: 60_000 }).toBe(true)
    expect(seen.at(-1)?.toolTexts[1]).toContain('"terminals"')
    expect(JSON.parse(seen.at(-1)!.toolTexts[2]).id).not.toBe(JSON.parse(seen.at(-1)!.toolTexts[0]).id)
    await expect(agent.win.locator('.terminal-drawer .xterm-rows').first()).toBeVisible({ timeout: 30_000 })
    await expect(agent.win.locator('.terminal-drawer .xterm')).toHaveCount(1)
    await expect(agent.win.locator('.terminal-drawer')).toContainText('SIDEBAR_AGENT_READY', { timeout: 30_000 })
  } finally {
    await agent.win.locator('[aria-label="Close terminal"]').first().click({ timeout: 3000 }).catch(() => undefined)
    await agent.close()
    model.close()
  }
})

test('creates multiple terminals and exposes their context menu and close-all control', async () => {
  const model = startScriptedModel(() => ({ text: 'ok' }), [])
  const agent = await launchAgentApp(await listen(model), { config: { rightPanelPrefs: { files: true, terminal: true, git: true, run: true, browser: false }, rightPanelCollapsed: false } })
  try {
    await agent.newSession()
    await agent.win.getByRole('button', { name: 'Expand right panel' }).click()
    await agent.win.getByRole('tab', { name: 'Terminal', exact: true }).click()
    const panel = agent.win.locator('.terminal-drawer')
    const add = panel.getByRole('button', { name: 'New terminal', exact: true }).first()
    await add.click()
    await expect(panel.locator('.xterm')).toHaveCount(1)
    await add.click()
    await expect(panel.locator('.xterm')).toHaveCount(2)
    await expect(panel.getByRole('button', { name: 'Detect tasks with AI' }).first()).toBeVisible()
    await panel.locator('.xterm-screen').first().click({ button: 'right' })
    await expect(agent.win.getByRole('menuitem', { name: 'Copy' })).toBeVisible()
    await expect(agent.win.getByRole('menuitem', { name: 'Paste' })).toBeVisible()
    await expect(agent.win.getByRole('menuitem', { name: 'Add to chat' })).toBeVisible()
    await agent.win.keyboard.press('Escape')
    await panel.getByRole('button', { name: 'Restart terminal command' }).first().click()
    const restartDialog = agent.win.getByRole('dialog', { name: 'Restart terminal command' })
    await restartDialog.getByRole('textbox').fill('echo SIDEBAR_RESTART_READY')
    await restartDialog.getByRole('textbox').press('Enter')
    await expect(panel.locator('.xterm').first()).toContainText('SIDEBAR_RESTART_READY', { timeout: 30_000 })
    const previousTerminal = await panel.locator('.xterm').first().elementHandle()
    await panel.getByRole('button', { name: 'Restart terminal command' }).first().click()
    await expect.poll(() => previousTerminal?.evaluate((element) => element.isConnected)).toBe(false)
    await expect(panel.locator('.xterm').first()).toContainText('SIDEBAR_RESTART_READY', { timeout: 30_000 })
    agent.win.once('dialog', (dialog) => void dialog.accept())
    await panel.getByRole('button', { name: 'Close all terminals in this project' }).click()
    await expect(panel.locator('.xterm')).toHaveCount(0)
  } finally {
    await agent.close()
    model.close()
  }
})
