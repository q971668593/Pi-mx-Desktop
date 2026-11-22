// 逐帧录制：真实运行的界面 + 脚本化模型（mock-llm）驱动一轮真实 Worker 回合。
// 每帧的采集时间写进 times.json，GIF 按真实速度回放。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clickReviewScope, expandFile } from './capture.mjs'
import { clickTab, clickOwnText, openDemo, openSession, revealPanel, shot, tabsFor, widenPanel } from './ui.mjs'
import { PANEL, SPLITTER, UI } from './config.mjs'
import { text } from './demo-script.mjs'

export function recorder(win, outDir) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const times = []
  const shot = async () => {
    const name = `f${String(times.length).padStart(4, '0')}.png`
    await win.screenshot({ path: join(outDir, name) })
    times.push([name, Date.now()])
  }
  const hold = async (ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      await shot()
      await win.waitForTimeout(80)
    }
  }
  const type = async (value, everyChar = true) => {
    for (const ch of value) {
      await win.keyboard.type(ch)
      if (everyChar || Math.random() < 0.6) await shot()
      else await win.waitForTimeout(35)
    }
  }
  /** Drag horizontally in a few recorded steps (used for the sidebar splitter). */
  const drag = async (fromX, y, toX, steps = 10) => {
    await win.mouse.move(fromX, y)
    await win.mouse.down()
    for (let i = 1; i <= steps; i++) {
      await win.mouse.move(fromX + ((toX - fromX) * i) / steps, y)
      await shot()
    }
    await win.mouse.up()
  }
  const save = () => writeFileSync(join(outDir, 'times.json'), JSON.stringify(times))
  return { shot, hold, type, drag, save, count: () => times.length }
}

async function focusComposer(win) {
  await win.locator('[contenteditable="true"]').last().click()
  await win.waitForTimeout(300)
}

/** 等一轮打完：停止按钮消失并持续空闲 2 秒以上。 */
async function waitIdle(win, rec, { limit = 60_000, idle = 2500 } = {}) {
  const started = Date.now()
  let idleSince = 0
  while (Date.now() - started < limit) {
    await rec.shot()
    await win.waitForTimeout(120)
    const running = await win.evaluate(() => !!document.querySelector('[aria-label*="停止"],[aria-label*="Stop"],button[title*="停止"],button[title*="Stop"]'))
    if (running) idleSince = 0
    else if (!idleSince) idleSince = Date.now()
    else if (Date.now() - idleSince > idle) return
  }
}

/** 新会话里跑完一整轮「修复带标题的 Markdown 链接解析」：工具步骤逐条出现 → 折叠 → 结论。 */
export async function recordAgentTurn({ appDir, demo, lang, outDir }) {
  const { startMockLlm } = await import('./mock-llm.mjs')
  const { MOCK_PORT } = await import('./config.mjs')
  const mock = await startMockLlm({ port: MOCK_PORT, lang })
  // live demo 里没有 fix 会话（就是要让真实 worker 跑出来），只启动到主界面。
  const { app, win } = await openDemo({ appDir, demo, lang, session: null })
  const rec = recorder(win, outDir)
  try {
    await win.locator(`button[aria-label="${UI[lang].newSession}"]`).first().click()
    await win.waitForTimeout(1500)
    await clickTab(win, tabsFor(lang).git).catch(() => {})
    await focusComposer(win)
    await rec.shot()
    await rec.type(text(lang).fixPrompt, false)
    await rec.hold(300)
    await win.keyboard.press('Enter')
    await waitIdle(win, rec)
    await revealPanel(win, UI[lang].revealPanel)
    await clickTab(win, tabsFor(lang).git).catch(() => {})
    await rec.hold(1600)
    rec.save()
    console.log(`  agent turn: ${rec.count()} frames`)
  } finally {
    await app.close()
    await mock.close()
  }
}

/** 加宽右侧栏 → Review 面板的 Git 工作区 → 文件 diff → 并排 → 暂存一个 hunk（减号行消失）。 */
export async function recordReviewStage({ appDir, demo, lang, outDir }) {
  const { app, win } = await openDemo({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await clickTab(win, tabsFor(lang).review)
    await rec.hold(700)
    await rec.drag(PANEL.edgeX, SPLITTER.y, SPLITTER.wideX)
    await rec.hold(500)
    await clickReviewScope(win, 'Git')
    await rec.hold(500)
    await expandFile(win, 'links.mjs')
    await rec.hold(1300)
    await win.locator(`button[aria-label="${UI[lang].sideBySide}"]`).first().click()
    await rec.hold(1800)
    const stage = win.locator(`button[aria-label="${UI[lang].stageHunk}"]`).first()
    await stage.hover()
    await rec.hold(500)
    await stage.click()
    await rec.hold(2200)
    // 暂存后 diff 会收起；再打开剩余文件，让最后一帧仍然是一份真 diff。
    await expandFile(win, 'links.mjs').catch(() => {})
    await rec.hold(2400)
    rec.save()
    console.log(`  review: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}

/** 工作团队看板：打开一张待办卡 → 任务抽屉里点「派发开工」 —— 卡片上出现执行者与运行态。 */
export async function recordTeamDispatch({ appDir, demo, lang, outDir }) {
  const { startMockLlm } = await import('./mock-llm.mjs')
  const { MOCK_PORT } = await import('./config.mjs')
  const mock = await startMockLlm({ port: MOCK_PORT, lang, pace: 1.4 })
  const { app, win } = await openDemo({ appDir, demo, lang, config: {}, session: 'plan' })
  const rec = recorder(win, outDir)
  const copy = {
    zh: { card: '文档站更新', dispatch: '派发开工' },
    en: { card: 'Docs site update', dispatch: 'Dispatch' },
  }[lang]
  try {
    await clickTab(win, tabsFor(lang).team)
    await rec.hold(800)
    await widenPanel(win, PANEL.wideX, { recorder: rec })
    await rec.hold(900)
    // 卡片本身是一个 title=任务标题的按钮，点开右侧任务抽屉。
    const card = await win.evaluate((label) => {
      const box = [...document.querySelectorAll(`button[title="${label}"]`)].map((b) => b.getBoundingClientRect()).find((r) => r.width > 0)
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
    }, copy.card)
    if (!card) throw new Error(`team card not found: ${copy.card}`)
    await win.mouse.move(card.x, card.y)
    await rec.hold(500)
    await win.mouse.click(card.x, card.y)
    await rec.hold(1400)
    const fire = await win.evaluate((label) => {
      const box = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === label).map((b) => b.getBoundingClientRect()).find((r) => r.width > 0)
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
    }, copy.dispatch)
    if (!fire) throw new Error(`team dispatch button not found: ${copy.dispatch}`)
    await win.mouse.move(fire.x, fire.y)
    await rec.hold(500)
    await win.mouse.click(fire.x, fire.y)
    await waitIdle(win, rec, { limit: 45_000, idle: 2000 })
    await rec.hold(2200)
    rec.save()
    console.log(`  team: ${rec.count()} frames`)
  } finally {
    // 派发出的会话还在跑，app.close() 会等 Worker 收尾；超时就强杀，别把整条流水线挂住。
    const closed = await Promise.race([
      app.close().then(() => true).catch(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20_000)),
    ])
    if (!closed) app.process().kill('SIGKILL')
    await mock.close()
  }
}

/** 文件面板：切到加宽、展开目录、预览一个文件、把某一行引用进输入框。 */
export async function recordFiles({ appDir, demo, lang, outDir }) {
  const { app, win } = await openDemo({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await clickTab(win, tabsFor(lang).files)
    await rec.hold(500)
    await rec.drag(PANEL.edgeX, SPLITTER.y, SPLITTER.wideX)
    await rec.hold(500)
    await clickOwnText(win, 'src', { exact: false }).catch(() => {})
    await rec.hold(600)
    await clickOwnText(win, 'links.mjs', { exact: false })
    await rec.hold(1400)
    const quote = win.locator('button[title*="links.mjs:"]').first()
    if (await quote.count()) {
      await quote.hover()
      await rec.hold(400)
      await quote.click()
      await rec.hold(1600)
    }
    rec.save()
    console.log(`  files: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}

/** 两个新会话同时跑；在两边的回合之间来回切换，谁都不会被打断。 */
export async function recordParallel({ appDir, demo, lang, outDir, stillPath }) {
  const { startMockLlm } = await import('./mock-llm.mjs')
  const { MOCK_PORT } = await import('./config.mjs')
  const t = text(lang)
  const mock = await startMockLlm({ port: MOCK_PORT, lang, pace: 1.6 })
  const { app, win } = await openDemo({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  const newSession = () => win.locator(`button[aria-label="${UI[lang].newSession}"]`).first().click()
  const send = async (prompt) => {
    await focusComposer(win)
    await win.keyboard.insertText(prompt)
    await rec.hold(350)
    await win.keyboard.press('Enter')
  }
  try {
    await newSession()
    await win.waitForTimeout(1200)
    await rec.hold(400)
    await send(t.fixPrompt)
    await rec.hold(2200)
    await newSession()
    await rec.hold(800)
    await send(t.remotePrompt)
    await rec.hold(2800)
    if (stillPath) await win.screenshot({ path: stillPath })
    await rec.hold(200)
    await clickOwnText(win, t.fixPrompt.slice(0, 10), { exact: false })
    await rec.hold(3200)
    await clickOwnText(win, t.remotePrompt.slice(0, 10), { exact: false })
    await waitIdle(win, rec, { limit: 60_000, idle: 1500 })
    await clickOwnText(win, t.fixPrompt.slice(0, 10), { exact: false })
    await rec.hold(2600)
    rec.save()
    console.log(`  parallel: ${rec.count()} frames`)
  } finally {
    await app.close()
    await mock.close()
  }
}

/** 时间线：工具步骤展开成一串，正文开始后收成一行摘要。 */
export async function recordTimeline({ appDir, demo, lang, outDir }) {
  const { app, win } = await openDemo({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await rec.hold(600)
    const summary = await win.evaluate((label) => {
      const el = [...document.querySelectorAll('button,[role="button"]')].find((b) => (b.textContent || '').trim().startsWith(label))
      const r = el?.getBoundingClientRect()
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
    }, UI[lang].toolSummary)
    if (summary) {
      await win.mouse.move(summary.x, summary.y)
      await rec.hold(300)
      await win.mouse.click(summary.x, summary.y)
      await rec.hold(1600)
      await win.mouse.click(summary.x, summary.y)
    }
    await rec.hold(1800)
    rec.save()
    console.log(`  timeline: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}

export { revealPanel, shot, openSession }

/** 输入框：打入 @ 触发文件候选，选中后插成文件引用。 */
export async function recordComposer({ appDir, demo, lang, outDir }) {
  const t = text(lang)
  const { app, win } = await openDemo({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await focusComposer(win)
    await rec.hold(600)
    await rec.type(t.mentionBefore)
    await rec.type('@li')
    await rec.hold(1500)
    await win.keyboard.press('Enter')
    await rec.hold(700)
    await rec.type(t.mentionAfter)
    await rec.hold(2200)
    rec.save()
    console.log(`  composer: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}
