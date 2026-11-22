// 截图脚本共用的界面操作：启动 → 打开项目/会话 → 展开展开右侧栏 → 切 Tab → 拖宽。
// 标签与几何都以当前版本的界面为准（Tab 见 config.mjs 的 TABS / PANEL）。
import { join } from 'node:path'
import { launchApp } from './app.mjs'
import { PANEL, TABS, UI } from './config.mjs'
import { text } from './demo-script.mjs'

/** 右侧栏 Tab 全开：默认只开 files/git/team/terminal/browser/run。 */
export const ALL_PANELS = {
  rightPanelPrefs: { files: true, git: true, team: true, terminal: true, browser: true, run: true, review: true, context: true, tree: true },
}

/** 截图用的「等界面稳定」节奏：项目会话列表先出加载态，必须分两段等。 */
export const WAIT = { boot: 2600, project: 6000, session: 2600, tab: 1500, reveal: 1400 }

/** 点右侧栏的 Tab（在 role=tablist 里按自有文本找，避开聊天内容的同名文字）。 */
export async function clickTab(win, label) {
  const point = await win.evaluate((label) => {
    const list = document.querySelector('[role="tablist"]')
    const scope = list ? [...list.querySelectorAll('button,[role="tab"]')] : []
    const nodes = (scope.length ? scope : [...document.querySelectorAll('button,[role="tab"]')]).filter((el) => {
      const own = [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim()
      return (own === label || (el.textContent || '').trim() === label) && el.getBoundingClientRect().width > 0
    })
    const el = nodes[0]
    if (!el) return null
    el.scrollIntoView({ block: 'nearest', inline: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, label)
  if (!point) throw new Error(`readme-capture: panel tab not found: ${label}`)
  await win.mouse.click(point.x, point.y)
  await win.waitForTimeout(WAIT.tab)
}

/** 右侧栏处于收起状态时，点窗口右上角的展开按钮。 */
export async function revealPanel(win, title = '展开右侧面板') {
  const clicked = await win.evaluate((title) => {
    const button = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('title') || '').includes(title))
    if (!button) return false
    button.click()
    return true
  }, title)
  await win.waitForTimeout(WAIT.reveal)
  return clicked
}

/** 把右侧栏拖宽（Review / 看板需要横向空间）；recorder 传入时逐帧记录拖动过程。 */
export async function widenPanel(win, toX = PANEL.wideX, { recorder, y = PANEL.tabRowY + 360 } = {}) {
  if (recorder) {
    await recorder.drag(PANEL.edgeX, y, toX)
    return
  }
  await win.mouse.move(PANEL.edgeX, y)
  await win.mouse.down()
  await win.mouse.move(toX, y, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(900)
}

/** 打开演示项目与指定会话；`session: 'plan' | 'fix' | 'json'`。 */
export async function openSession(win, lang, session = 'fix') {
  const t = text(lang)
  const title = session === 'plan' ? t.planTitle : session === 'json' ? t.jsonTitle : t.fixTitle
  await clickOwnText(win, 'lumen')
  await win.waitForTimeout(WAIT.project)
  await clickOwnText(win, title, { exact: false })
  await win.waitForTimeout(WAIT.session)
}

/** 按元素自有文本点击（不做 exact 之外的模糊匹配，避免点到容器）。 */
export async function clickOwnText(win, label, { exact = true } = {}) {
  const point = await win.evaluate(({ label, exact }) => {
    const nodes = [...document.querySelectorAll('body *')].filter((el) => {
      const own = [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim()
      if (!own || (exact ? own !== label : !own.includes(label))) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.y >= 0 && r.y < innerHeight
    })
    const el = nodes[0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2 }
  }, { label, exact })
  if (!point) throw new Error(`readme-capture: text not found: ${label}`)
  await win.mouse.click(point.x, point.y)
}

/**
 * 启动并进入「演示项目 + 会话 + 右侧栏展开」，截图脚本都在这个状态下开始。
 * @returns {Promise<{ app: import('@playwright/test').ElectronApplication, win: import('@playwright/test').Page }>}
 */
export async function openDemo({ appDir, demo, lang, theme = 'light', config = {}, session = 'fix' }) {
  const { app, win } = await launchApp({
    appDir,
    demo,
    lang,
    theme,
    config: { ...ALL_PANELS, ...config },
  })
  try {
    await win.waitForTimeout(WAIT.boot)
    await openSession(win, lang, session)
    await revealPanel(win, UI[lang].revealPanel)
    return { app, win }
  } catch (error) {
    await app.close()
    throw error
  }
}

/** 截图并打印文件名；`dir` 里统一用 `<lang>-<theme>-<name>.png`。 */
export async function shot(win, dir, lang, theme, name) {
  const file = join(dir, `${lang}-${theme}-${name}.png`)
  await win.screenshot({ path: file })
  console.log(`  ${lang}-${theme}-${name}.png`)
  return file
}

export function tabsFor(lang) {
  return TABS[lang]
}
