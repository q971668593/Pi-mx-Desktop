// 静帧截图：真实运行界面（1440×900 逻辑像素，2× 输出）。
//
// 每个语言 × 主题一轮：
//   hero        时间线 + 加宽后的 Review（Git 工作区、并排 diff）——README 首图
//   review      Review 面板：本轮 / 本对话 / Git 三个 scope
//   git         Git 面板：分支、更改列表、提交框
//   team        工作团队看板：五角色 + 六条泳道
//   timeline    折叠的工具步骤展开后的时间线
//   context     上下文占用（用户 / 助手 / 工具）
//   run         Run 面板：本轮状态与用量
//   tree        会话树（/tree）
//   files       文件面板：目录树 + 预览
//
// 文件名：<lang>-<theme>-<name>.png，落在 rawDir。
import { join } from 'node:path'
import { PANEL, SPLITTER, UI } from './config.mjs'
import { clickOwnText, clickTab, openDemo, shot, tabsFor, widenPanel } from './ui.mjs'

/** 在 Review 面板点某个 scope 页签（本轮 / 本对话 / Git 工作区）—— 只看面板内容区，不汚到顶部 Tab。 */
async function clickReviewScope(win, label) {
  const point = await win.evaluate((label) => {
    const el = [...document.querySelectorAll('button,[role="tab"]')].find((b) => {
      const r = b.getBoundingClientRect()
      if (r.width <= 0 || r.y < 70 || r.y > 140) return false
      return (b.getAttribute('aria-label') || '').startsWith(label) || (b.textContent || '').trim().startsWith(label)
    })
    const r = el?.getBoundingClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  }, label)
  if (!point) throw new Error(`readme-capture: review scope not found: ${label}`)
  await win.mouse.click(point.x, point.y)
  await win.waitForTimeout(1400)
}

/** 点开 Review 面板文件列表里的一行，把 diff 展开。 */
async function expandFile(win, name) {
  const point = await win.evaluate((name) => {
    const el = [...document.querySelectorAll('[title]')].find((b) => {
      const title = b.getAttribute('title') || ''
      const r = b.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.y > 150 && (title === name || title.endsWith(`/${name}`))
    })
    const r = el?.getBoundingClientRect()
    return r ? { x: r.x + Math.min(r.width / 2, 200), y: r.y + r.height / 2 } : null
  }, name)
  if (!point) throw new Error(`readme-capture: file row not found: ${name}`)
  await win.mouse.click(point.x, point.y)
  await win.waitForTimeout(1600)
}

/** 一个语言 + 主题的静帧。每个 step 失败只跳过它，不中断整轮。 */
export async function captureScreens({ appDir, demo, lang, theme, rawDir }) {
  const { app, win } = await openDemo({ appDir, demo, lang, theme })
  const ui = UI[lang]
  const tabs = tabsFor(lang)
  const step = async (label, action) => {
    try {
      return await action()
    } catch (error) {
      console.warn(`  ${lang}-${theme} step "${label}" failed: ${String(error).split('\n')[0]}`)
      return null
    }
  }
  try {
    // hero / review：Review 面板 → 拉宽 → Git 工作区 → 展开 links.mjs → 并排 diff。
    await step('review-tab', () => clickTab(win, tabs.review))
    await step('widen', () => widenPanel(win, SPLITTER.wideX))
    await step('git-scope', () => clickReviewScope(win, lang === 'zh' ? 'Git' : 'Git'))
    await step('expand', () => expandFile(win, 'src/links.mjs'))
    await step('side-by-side', () => win.locator(`button[aria-label="${ui.sideBySide}"]`).first().click())
    await win.waitForTimeout(1400)
    await shot(win, rawDir, lang, theme, 'hero')

    if (theme === 'dark') return

    await shot(win, rawDir, lang, theme, 'review')

    await step('git', () => clickTab(win, tabs.git))
    await win.waitForTimeout(800)
    await shot(win, rawDir, lang, theme, 'git')

    await step('team', () => clickTab(win, tabs.team))
    await win.waitForTimeout(1400)
    await shot(win, rawDir, lang, theme, 'team')

    // 收窄回默认宽度，截时间线与分析类面板。
    await step('narrow', async () => {
      await win.mouse.move(PANEL.wideX, SPLITTER.y)
      await win.mouse.down()
      await win.mouse.move(PANEL.edgeX, SPLITTER.y, { steps: 12 })
      await win.mouse.up()
      await win.waitForTimeout(900)
    })
    await step('tools', () => clickOwnText(win, ui.toolSummary, { exact: false }))
    await win.waitForTimeout(1400)
    await shot(win, rawDir, lang, theme, 'timeline')

    for (const name of ['context', 'run', 'tree', 'files']) {
      await step(name, async () => {
        await clickTab(win, tabs[name])
        await win.waitForTimeout(700)
        await shot(win, rawDir, lang, theme, name)
      })
    }
  } finally {
    await app.close()
  }
}

/** 终端面板：打开一个真实 shell，跑两条命令。 */
export async function captureTerminal({ appDir, demo, lang, rawDir }) {
  process.env.PS1 = 'lumen $ '
  const { app, win } = await openDemo({ appDir, demo, lang, theme: 'light' })
  try {
    await clickTab(win, tabsFor(lang).terminal)
    const newTerminal = lang === 'zh' ? '新建终端' : 'New terminal'
    const created = await win.evaluate((label) => {
      const button = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('title') || '').includes(label) || (el.textContent || '').trim() === label)
      if (!button) return false
      button.click()
      return true
    }, newTerminal)
    if (!created) throw new Error('terminal: new-terminal button not found')
    await win.locator('.xterm').first().waitFor({ timeout: 20_000 })
    await win.waitForTimeout(2500)
    await win.locator('.xterm').first().click()
    await win.keyboard.type('git log --oneline -3\n', { delay: 6 })
    await win.waitForTimeout(900)
    await win.keyboard.type('node --test 2>&1 | tail -6\n', { delay: 6 })
    await win.waitForTimeout(2600)
    await shot(win, rawDir, lang, 'light', 'terminal')
  } finally {
    delete process.env.PS1
    await win
      .evaluate(() => document.querySelectorAll('.terminal-drawer [aria-label="关闭终端"], .terminal-drawer [aria-label="Close terminal"]').forEach((b) => b.click()))
      .catch(() => {})
    await win.waitForTimeout(600)
    await app.close()
  }
}

/** 设置页 → 外观：浅色（Claude 预设）与深色 + 背景图（设置自动保存，无保存按钮）。 */
export async function captureAppearance({ appDir, demo, lang, rawDir, image }) {
  const { app, win } = await openDemo({ appDir, demo, lang, theme: 'light' })
  const ui = UI[lang]
  const copy = {
    zh: { light: '浅色主题', dark: '深色主题', themeDark: '深色', choose: '选择图片…', back: '返回', strength: '图片强度', opacity: '界面不透明度' },
    en: { light: 'Light theme', dark: 'Dark theme', themeDark: 'Dark', choose: 'Choose image…', back: 'Back', strength: 'Image strength', opacity: 'Interface opacity' },
  }[lang]
  const backToChat = async () => {
    await win.getByRole('button', { name: copy.back, exact: true }).first().click()
    await win.waitForTimeout(1800)
  }
  try {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, image)
    await clickOwnText(win, ui.settings)
    await win.waitForTimeout(1200)
    await clickOwnText(win, ui.appearance)
    await win.waitForTimeout(1200)
    for (const section of [copy.light, copy.dark]) {
      await win.getByRole('heading', { name: section }).locator('xpath=ancestor::section[1]').getByRole('radio', { name: 'Claude' }).click()
      await win.waitForTimeout(300)
    }
    await win.waitForTimeout(800)
    await win.mouse.move(720, 420)
    await win.mouse.wheel(0, -600)
    await win.waitForTimeout(700)
    await shot(win, rawDir, lang, 'theme', 'settings')
    await backToChat()
    await shot(win, rawDir, lang, 'theme', 'light')

    await clickOwnText(win, ui.settings)
    await win.waitForTimeout(900)
    await clickOwnText(win, ui.appearance)
    await win.waitForTimeout(1000)
    await win.getByRole('button', { name: copy.themeDark, exact: true }).click()
    await win.waitForTimeout(700)
    await win.mouse.move(720, 420)
    await win.mouse.wheel(0, 1200)
    await win.waitForTimeout(800)
    await win.getByRole('button', { name: copy.choose }).click()
    await win.waitForTimeout(1600)
    await win.getByRole('slider', { name: copy.strength }).fill('1')
    await win.getByRole('slider', { name: copy.opacity }).fill('0.72')
    await win.waitForTimeout(1400)
    await shot(win, rawDir, lang, 'theme', 'settings-dark')
    await backToChat()
    await win.waitForTimeout(1400)
    await shot(win, rawDir, lang, 'theme', 'dark-bg')
  } finally {
    await app.close()
  }
}

/** 用量页：造 10 周历史后截 90 天视图。 */
export async function captureUsage({ appDir, demo, lang, rawDir }) {
  const { seedUsage } = await import('./record-features.mjs')
  seedUsage(demo)
  const { app, win } = await openDemo({ appDir, demo, lang, theme: 'light' })
  const copy = { zh: { usage: '用量', days90: '90 天' }, en: { usage: 'Usage', days90: '90 days' } }[lang]
  try {
    await clickOwnText(win, UI[lang].settings)
    await win.waitForTimeout(1200)
    await clickOwnText(win, copy.usage)
    await win.waitForTimeout(1600)
    await win.getByRole('radio', { name: copy.days90 }).click()
    await win.waitForTimeout(1600)
    await win.mouse.move(800, 500)
    await win.mouse.wheel(0, 140)
    await win.waitForTimeout(900)
    const bars = win.locator('.flex.h-40.items-end > div')
    const count = await bars.count()
    if (count) {
      const box = await bars.nth(Math.max(0, count - 9)).boundingBox()
      if (box) await win.mouse.move(box.x + box.width / 2, box.y + box.height - 6)
    }
    await win.waitForTimeout(700)
    await shot(win, rawDir, lang, 'light', 'usage')
  } finally {
    await app.close()
  }
}

export { clickReviewScope, expandFile, join }
