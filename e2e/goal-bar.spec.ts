import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

/**
 * 会话目标的端到端链路（真实 Electron + 真实 worker + 脚本化模型）：
 *
 *  1. 目标条设的目标真的进了下一轮的 system prompt（R2 的接线；纯单测只能证明零件对）；
 *  2. 模型带注解的进度行 `GOAL-PROGRESS: 1,2（…）` 会被解析并落盘（R3）；
 *  3. 一轮结束还有剩余项时自动续跑，remaining 归零后停下来并提示达成。
 *
 * 断言一律按「哪次请求满足条件」来找，不按序号 —— 发送时机稍有偏差就会多出/少掉一次请求，
 * 按序号断言会变成随机红（本用例第一版就是这么假的）。
 */

const GOAL = '首页 banner 抽成组件'
const lastUserOf = (seen: Seen): string =>
  [...seen.messages].reverse().find((message) => message.role === 'user')?.text ?? ''

test.describe('session goal bar', () => {
  test('pins the goal into the prompt, auto-continues, and stops when everything is ticked', async () => {
    test.setTimeout(180_000)
    const seen: Seen[] = []
    const model = startScriptedModel((_first, _tools, last) => {
      // 自动续跑那轮：故意带注解——严格解析器会把这行丢掉、判「没有进展」
      if (/继续推进本会话目标/.test(last)) return { text: 'GOAL-PROGRESS: 1,2（背景图与高度都已完成）' }
      return { text: '好的。' }
    }, seen)
    const agent = await launchAgentApp(await listen(model), { language: 'zh' })
    const bar = agent.win.locator('[data-goal-bar]')
    try {
      // 新会话要先发一条消息才会有 sessionFile，目标条也只在这时出现
      await agent.newSession()
      await agent.send('开始')
      await expect.poll(() => seen.length, { timeout: 30_000 }).toBe(1)
      // 等这一轮真的收尾（目标循环的 800ms 静默窗口）再发下一条，否则会被当成队列里的补充消息
      await expect(agent.win.getByText('好的。')).toBeVisible()
      await agent.win.waitForTimeout(1500)
      await expect(bar).toBeVisible()

      // 设定目标 + 两条验收项（走真实 IPC，落到 userData/session-goals.json）
      await bar.getByText('这个会话要达成什么？（一句话）').click()
      await bar.locator('input').fill(GOAL)
      await bar.locator('textarea').fill('背景图已生成\n高度 700px')
      await bar.locator('button[type="submit"]').click()
      await expect(bar.getByText('还剩 2 项未达成')).toBeVisible()

      // 带目标的下一轮
      await agent.send('继续')
      await expect
        .poll(() => seen.filter((entry) => entry.system.includes(GOAL)).length, { timeout: 30_000 })
        .toBe(1)
      const withGoal = seen.find((entry) => entry.system.includes(GOAL))!
      // 注入：结构化 section 会以 <goal> 包裹进 system prompt
      expect(withGoal.system).toContain('<goal>')
      expect(withGoal.system).toContain('[未达成] 背景图已生成')
      // 用户消息里不该被塞进目标前缀（历史只留用户真正说的话）
      expect(withGoal.firstUser).not.toContain(GOAL)

      // 这一轮没报进度 → 自动续跑一轮（提示语进历史，用户看得见）
      await expect
        .poll(() => seen.filter((entry) => lastUserOf(entry).includes('继续推进本会话目标')).length, {
          timeout: 40_000,
        })
        .toBe(1)

      // 带注解的进度行被解析 → 两项打勾 → 停 + 提示达成
      await expect(bar.getByText('目标已达成')).toBeVisible({ timeout: 30_000 })
      const boxes = bar.locator('input[type="checkbox"]')
      await expect(boxes).toHaveCount(2)
      await expect(boxes.nth(0)).toBeChecked()
      await expect(boxes.nth(1)).toBeChecked()

      // 归零后不再自动发
      const settled = seen.length
      await agent.win.waitForTimeout(4000)
      expect(seen).toHaveLength(settled)
      expect(seen.filter((entry) => lastUserOf(entry).includes('继续推进本会话目标'))).toHaveLength(1)
    } finally {
      await agent.close()
      model.close()
    }
  })
})
