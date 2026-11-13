import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })

test('chat images, file editing, terminal tasks, and git changes work together', async () => {
  const model = startScriptedModel(() => ({ text: 'Saved to C:\\generated\\poster.png' }), [])
  const agent = await launchAgentApp(await listen(model), {
    config: {
      rightPanelPrefs: { files: true, terminal: true, git: true, run: true, browser: false },
      rightPanelCollapsed: false,
    },
  })
  const { win, project } = agent
  fs.writeFileSync(path.join(project, 'poster.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'))
  const note = path.join(project, 'note.txt')
  fs.writeFileSync(note, 'original')
  git(project, ['init', '-b', 'main'])
  git(project, ['config', 'user.email', 'tester@example.com'])
  git(project, ['config', 'user.name', 'tester'])
  git(project, ['add', '.'])
  git(project, ['commit', '-m', 'base'])
  fs.writeFileSync(note, 'changed')
  try {
    await agent.newSession()
    await agent.send('show the image')
    const picture = win.getByRole('button', { name: /Enlarge poster.png/ })
    await expect(picture).toBeVisible()
    await picture.click({ button: 'right' })
    await expect(win.getByRole('menu').getByRole('button', { name: 'Copy image' })).toBeVisible()
    await win.keyboard.press('Escape')

    await win.getByRole('button', { name: 'Expand right panel' }).click()
    await win.getByRole('tab', { name: 'Files' }).click()
    const file = win.getByRole('button', { name: /note\.txt/ }).first()
    await file.click()
    const editor = win.locator('.cm-content[contenteditable="true"]')
    await expect(editor).toBeVisible()
    await editor.click()
    await win.keyboard.press('Control+A')
    await win.keyboard.insertText('saved from editor')
    await win.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => fs.readFileSync(note, 'utf8')).toBe('saved from editor')

    const explorer = win.getByRole('button', { name: /file tree/i })
    if ((await explorer.getAttribute('aria-label')) === 'Expand file tree') await explorer.click()
    await file.click({ button: 'right' })
    await win.getByRole('button', { name: 'New terminal here' }).click()
    await expect(win.locator('.terminal-drawer .xterm-rows').first()).toBeVisible()

    await win.getByRole('tab', { name: 'Git', exact: true }).click()
    await expect(win.getByRole('button', { name: 'note.txt' })).toBeVisible()
  } finally {
    await win.getByRole('tab', { name: 'Terminal', exact: true }).click({ timeout: 3000 }).catch(() => undefined)
    await win.locator('[aria-label="Close terminal"]').click({ timeout: 3000 }).catch(() => undefined)
    await agent.close()
    model.close()
  }
})
