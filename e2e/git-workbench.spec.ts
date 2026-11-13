import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test('git tabs provide branch creation and contextual checkout', async () => {
  const model = startScriptedModel(() => ({ text: 'ok' }), [])
  const agent = await launchAgentApp(await listen(model), { config: { rightPanelPrefs: { files: true, terminal: true, git: true, run: true, browser: false }, rightPanelCollapsed: false } })
  git(agent.project, ['init', '-b', 'main'])
  git(agent.project, ['config', 'user.email', 'test@example.com'])
  git(agent.project, ['config', 'user.name', 'Test'])
  git(agent.project, ['add', '.'])
  git(agent.project, ['commit', '-m', 'initial'])
  try {
    await agent.newSession()
    await agent.win.getByRole('button', { name: 'Expand right panel' }).click()
    await agent.win.getByRole('tab', { name: 'Git', exact: true }).click()
    await agent.win.getByRole('tab', { name: 'Branches', exact: true }).click()
    await agent.win.getByPlaceholder('Branch, tag or commit').fill('feature/demo')
    await agent.win.getByRole('button', { name: 'New branch', exact: true }).click()
    await expect.poll(() => git(agent.project, ['branch', '--list', 'feature/demo'])).toContain('feature/demo')
    await expect.poll(() => git(agent.project, ['branch', '--show-current'])).toBe('feature/demo')
    await agent.win.getByRole('button', { name: 'Actions for main' }).click()
    await agent.win.getByRole('menuitem', { name: 'Checkout' }).click()
    await expect.poll(() => git(agent.project, ['branch', '--show-current'])).toBe('main')
    await expect(agent.win.locator('.git-board strong').first()).toHaveText('main')
    await agent.win.getByRole('tab', { name: 'Graph', exact: true }).click()
    await expect(agent.win.getByText('initial', { exact: true })).toBeVisible()
    await agent.win.screenshot({ path: test.info().outputPath('git-graph.png') })
  } finally {
    await agent.close()
    model.close()
  }
})
