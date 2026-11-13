import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

const shots = 'test-results/ui-review'

/** Minimal RGB PNG writer so the image preview has a visibly sized picture. */
function makePng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(([...body].reduce((c, byte) => ((crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)) >>> 0), 0xffffffff) ^ 0xffffffff) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)])
  for (let x = 0; x < width; x++) row.fill(Buffer.from([r, g, b]), 1 + x * 3, 4 + x * 3)
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// Review-only walkthrough: captures every right panel and exercises the main interactions
// so UI/UX issues can be inspected from screenshots. Not part of the regression suite.
test('full-site ui review walkthrough', async () => {
  test.setTimeout(300_000)
  const model = startScriptedModel(() => ({ text: '好的，已收到。' }), [])
  const agent = await launchAgentApp(await listen(model), { language: 'zh', config: { rightPanelPrefs: { files: true, terminal: true, git: true, run: true, browser: true }, rightPanelCollapsed: false } })
  const { win, project, home } = agent
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()
  fs.writeFileSync(path.join(project, 'notes.txt'), '第一行备注\n第二行备注\n')
  fs.writeFileSync(path.join(project, 'page.html'), '<!doctype html><title>demo</title><h1>hello</h1>')
  fs.writeFileSync(path.join(project, 'script.py'), 'def main():\n    print("hi")\n')
  // 96x64 solid color PNG, generated inline so the image preview has something visible.
  const png = makePng(96, 64, [200, 80, 40])
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(project, 'assets', 'dot.png'), png)
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  git(['add', '.'])
  git(['commit', '-m', '初始提交'])
  fs.writeFileSync(path.join(project, 'notes.txt'), '第一行备注\n第二行备注\n第三行改动\n')

  try {
    await agent.newSession()
    const fast = !!process.env.REVIEW_FAST
    const panelTab = (name: string) => win.getByRole('tab', { name, exact: true })
    const shot = (name: string) => win.screenshot({ path: path.join(shots, name) })
    await win.getByRole('button', { name: /展开右侧面板|Expand right panel/ }).click().catch(() => {})
    await win.evaluate(() => {
      const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { setState: (s: object) => void } } }).__piE2E
      useUIStore.setState({ rightPanelWidth: 640 })
    })
    await win.waitForTimeout(600)
    // The explorer rail auto-collapses on narrow panels; reopen it before tree interactions.
    const expandExplorer = async () => {
      await win.getByRole('button', { name: /展开文件树|Expand file tree/ }).click().catch(() => {})
      await win.waitForTimeout(300)
    }

    // 1. Review (chat) surface.
    if (!fast) {
      await agent.send('帮我生成一张测试海报')
      await win.waitForTimeout(1200)
      await shot('01-review.png')
    }

    // 2. Files panel: preview markdown, tabs, text edit default, image zoom, tree context menu.
    if (fast) await panelTab('文件').click().catch(() => {})
    else await panelTab('文件').click()
    if (!fast) await expandExplorer()
    if (!fast) {
      await win.getByText('README.md', { exact: true }).first().click()
      await win.waitForTimeout(600)
      await shot('02-files-md-preview.png')
      await expandExplorer()
      await win.getByText('notes.txt', { exact: true }).first().click()
      await win.waitForTimeout(700)
      await shot('03-files-txt-edit.png')
      await expandExplorer()
      await win.getByText('assets', { exact: true }).first().click()
      await win.waitForTimeout(400)
      await win.getByText('dot.png', { exact: true }).first().click()
      await win.waitForTimeout(700)
      await shot('04-files-image.png')
      await panelTab('文件').dispatchEvent('contextmenu')
      await win.waitForTimeout(400)
      await shot('05-files-tab-context.png')
      await win.keyboard.press('Escape')
      await win.locator('.files-explorer-rail').click({ button: 'right', position: { x: 60, y: 320 } })
      await win.waitForTimeout(400)
      await shot('06-files-tree-context.png')
      await win.keyboard.press('Escape')
    }

    // In fast mode visit Git BEFORE the terminal to isolate the freeze trigger.
    if (fast) {
      console.log('[review] fast: git first')
      const ipcCounts = await win.evaluate(async () => {
        const { ipcClient } = (window as unknown as { __piE2E: { ipcClient: { invoke: (method: string, req?: unknown) => Promise<unknown> } } }).__piE2E
        const original = ipcClient.invoke.bind(ipcClient)
        const counts = new Map<string, number>()
        ;(ipcClient as unknown as { invoke: typeof ipcClient.invoke }).invoke = ((method: string, req?: unknown) => {
          counts.set(method, (counts.get(method) ?? 0) + 1)
          return original(method, req)
        }) as typeof ipcClient.invoke
        await new Promise((resolve) => setTimeout(resolve, 3000))
        return [...counts.entries()].filter(([, n]) => n > 3).map(([m, n]) => `${m}=${n}`).join(', ') || 'quiet'
      }).catch((error) => `probe failed: ${String(error)}`)
      console.log(`[review] ipc counts over 3s: ${ipcCounts}`)
      const mutations = await win.evaluate(async () => {
        const seen = new Map<string, number>()
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const el = record.target as Element
            const key = `${el.tagName}.${String(el.className).slice(0, 40)}:${record.type}`
            seen.set(key, (seen.get(key) ?? 0) + 1)
          }
        })
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
        await new Promise((resolve) => setTimeout(resolve, 3000))
        observer.disconnect()
        return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${n}x ${k}`).join(' | ') || 'quiet'
      }).catch((error) => `mutation probe failed: ${String(error)}`)
      console.log(`[review] mutations over 3s: ${mutations}`)
      const hit = await win.evaluate(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent?.trim() === 'Git')
        if (!tab) return 'no git tab element'
        const r = tab.getBoundingClientRect()
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        const describe = (el: Element | null) => el ? `${el.tagName}.${String(el.className).slice(0, 60)}` : 'null'
        const chain: string[] = []
        let cursor: Element | null = top
        while (cursor && chain.length < 6) { chain.push(describe(cursor)); cursor = cursor.parentElement }
        return `tabRect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} top=${chain.join(' < ')}`
      }).catch((error) => `hit probe failed: ${String(error)}`)
      console.log(`[review] hit test: ${hit}`)
      const rects = await win.evaluate(async () => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent?.trim() === 'Git')
        if (!tab) return 'no tab'
        const values = new Set<string>()
        for (let frame = 0; frame < 30; frame++) {
          await new Promise((resolve) => requestAnimationFrame(resolve))
          const r = tab.getBoundingClientRect()
          values.add(`${r.x.toFixed(2)},${r.y.toFixed(2)},${r.width.toFixed(2)},${r.height.toFixed(2)}`)
        }
        return [...values].join(' ; ')
      }).catch((error) => `rect probe failed: ${String(error)}`)
      console.log(`[review] tab rects over 30 frames: ${rects}`)
      await panelTab('Git').click({ timeout: 15_000 }).catch(() => {})
      await win.waitForTimeout(900)
      await shot('10-git-changes.png')
    }

    // 3. Terminal panel: empty state, new terminal, run bar, context menu.
    await panelTab('终端').click({ timeout: 15_000 }).catch(() => {})
    await win.waitForTimeout(500)
    await shot('07-terminal-empty.png')
    await win.getByRole('button', { name: '新建终端', exact: true }).first().click()
    await win.waitForTimeout(1500)
    await shot('08-terminal-open.png')
    if (!fast && !process.env.REVIEW_NO_RIGHTCLICK) {
      await win.locator('.xterm-helper-textarea').first().focus()
      await win.locator('.xterm').first().click({ button: 'right', force: true })
      await win.waitForTimeout(400)
      await shot('09-terminal-context.png')
    }
    if (!fast) {
      console.log('[review] shot 09 done, pressing escape')
      await win.keyboard.press('Escape')
      console.log('[review] escape done')

      // Watch the renderer event loop for a few seconds: the app occasionally wedges the main
      // thread here, and when it dies we pull the JS call stack from the main process.
      const alive = await win.waitForFunction(() => {
        const w = window as unknown as { __ticks?: number }
        w.__ticks = (w.__ticks ?? 0) + 1
        return (w.__ticks ?? 0) >= 30
      }, { polling: 150, timeout: 6000 }).then(() => true).catch(() => false)
      console.log(`[review] alive after escape = ${alive}`)
      if (!alive) {
        const stack = await agent.app.evaluate(({ BrowserWindow }) => {
          const wc = BrowserWindow.getAllWindows()[0]?.webContents
          return (wc as unknown as { collectJavaScriptCallStack?: () => Promise<string> }).collectJavaScriptCallStack?.() ?? 'collectJavaScriptCallStack unavailable'
        }).catch((error) => `stack fetch failed: ${String(error)}`)
        console.log(`[review] renderer stack:\n${stack}`)
      }
    }

    // 4. Git panel: each sub-tab.
    console.log('[review] switching to git panel')
    const clicked = await panelTab('Git').click({ timeout: 15_000 }).then(() => true).catch((error) => {
      console.log(`[review] git tab click error: ${String(error).slice(0, 600)}`)
      return false
    })
    const stackFile = path.join(shots, 'renderer-stack.txt')
    void agent.app.evaluate(({ BrowserWindow }, file) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents
      void (wc as unknown as { collectJavaScriptCallStack?: () => Promise<string> }).collectJavaScriptCallStack?.()
        .then((stack) => require('node:fs').writeFileSync(file, String(stack)))
        .catch((error) => require('node:fs').writeFileSync(file, `stack failed: ${String(error)}`))
    }, stackFile).catch(() => {})
    await win.waitForTimeout(6000)
    try { console.log(`[review] renderer stack after git click:\n${fs.readFileSync(stackFile, 'utf8')}`) } catch { console.log('[review] no stack file written') }
    await win.waitForTimeout(900)
    console.log('[review] git changes shot')
    await shot('10-git-changes.png')
    for (const name of ['图谱', '分支', '标签', '远程']) {
      console.log(`[review] git sub-tab ${name}`)
      const tab = win.getByRole('tab', { name, exact: true })
      if (await tab.count()) {
        await tab.first().click()
        await win.waitForTimeout(700)
        await shot(`11-git-${name.toLowerCase()}.png`)
      }
    }

    // 5. Browser panel.
    await panelTab('浏览器').click()
    await win.waitForTimeout(800)
    await shot('12-browser.png')

    // 6. Settings: appearance + plugin model row.
    await win.getByRole('button', { name: /设置|Settings/ }).first().click().catch(() => {})
    await win.waitForTimeout(800)
    await shot('13-settings.png')
    const pluginRow = win.getByText(/插件|Plugin/).first()
    if (await pluginRow.count()) await pluginRow.scrollIntoViewIfNeeded().catch(() => {})
    await shot('14-settings-plugin-model.png')

    // Sanity: no console errors surfaced as error toasts during the walkthrough.
    await expect(win.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
  } finally {
    void home
    await agent.close()
    model.close()
  }
})
