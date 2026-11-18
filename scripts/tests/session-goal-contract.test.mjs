import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')
/** 只看代码，注释里解释「不要写进 settings.json」不算违规。 */
const code = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * 「会话目标」契约：目标只进 app 私有状态，经 pi 的 system prompt section 注入，
 * 自动循环必须带刹车。这三条是产品边界，不是实现细节 —— 破坏它们会污染用户的
 * 会话历史或让 agent 无限自转。
 */
describe('session goal contract', () => {
  it('stores goals in app-private state, never in pi settings or the JSONL', () => {
    const store = code('src/main/session-goals.ts')
    assert.match(store, /session-goals\.json/, '目标写在 userData/session-goals.json')
    assert.doesNotMatch(store, /settings\.json|\barv\b/, '不许写进与终端版共用的 settings.json')
    assert.doesNotMatch(store, /\.jsonl/, '不许写进 pi 的会话 JSONL')
    assert.doesNotMatch(store, /agentDir/, '目标与 pi 的 agentDir 无关')

    const handlers = read('src/main/ipc/handlers/session-goal.ts')
    assert.doesNotMatch(handlers, /sendPrompt|followUp|\.steer\(/, '目标写入不许顺手替用户发消息')
    assert.doesNotMatch(handlers, /ensureSessionWorker|logSession|resolveSlotForRpc/, '改目标不该拉起 worker')
  })

  it('injects the goal as a pi system prompt section, not as user message text', () => {
    const worker = read('src/worker/worker-goal.ts')
    assert.match(worker, /GOAL_SECTION_KEY/, 'section 名来自 shared 契约')
    assert.match(worker, /systemPromptOptions\?\.sections/, '写进结构化 prompt section')
    assert.match(worker, /before_agent_start/, '每轮开始前同步 section')
    assert.doesNotMatch(worker, /sendUserMessage|sessionManager\.append/, '不能伪造用户消息进历史')

    // 每条 turn 起跑前都补推当前目标（桌面端 + 远端 + steer/followUp 都要覆盖）
    const manager = read('src/main/worker-manager.ts')
    const pushCalls = manager.match(/await this\.pushGoalBeforeTurn\(sessionFile\)/g) ?? []
    assert.equal(pushCalls.length, 3, 'sendPrompt / steer / followUp 各推一次')
  })

  it('brakes the auto loop after three rounds without progress', () => {
    const shared = read('packages/shared/session-goal.ts')
    assert.match(shared, /GOAL_LOOP_STALL_LIMIT = 3/)
    assert.match(shared, /export function decideGoalLoop/)

    const loop = read('src/renderer/src/features/goal/goal-auto-loop.ts')
    assert.match(loop, /decideGoalLoop\(/, '判定必须走刹车函数，不能自己数轮次')
    assert.match(loop, /toast\.message/, '停下时要告诉用户为什么停')
    assert.match(loop, /isBlocked/, '跑着/刚按停/压缩中不许续')
  })

  it('bounds goal input in the IPC schema', () => {
    const schemas = read('src/main/ipc/schemas.ts')
    assert.match(schemas, /sessionGoalSetSchema/)
    assert.match(schemas, /MAX_GOAL_LENGTH/)
    assert.match(schemas, /MAX_GOAL_CRITERIA/)
    const generated = read('packages/shared/ipc-channels.generated.ts')
    for (const channel of ['get', 'set', 'toggleCriterion', 'markDone', 'clear']) {
      assert.ok(generated.includes(`'ipc:sessionGoal.${channel}'`), `白名单缺少 ipc:sessionGoal.${channel}`)
    }
  })
})
