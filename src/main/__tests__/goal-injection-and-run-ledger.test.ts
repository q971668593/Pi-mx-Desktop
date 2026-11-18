import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'
import { createRunLedger, type RunLedger } from '../run-ledger'
import { SessionGoalStore } from '../session-goals'

/**
 * 主进程侧的端到端验证（不是纯函数单测）：
 *  1. 「渲染层写目标 → 主进程在 prompt 前把它推到 worker」这条路真的通了；
 *  2. 「worker 在 turn 里崩掉 → 账本留下孤儿 → 下一次启动能扫到 → worker-fatal 带上数量」。
 *
 * 这两条正是 Phase 2.6 修的 R2 / R1；纯函数测试只能证明零件对，这里证明接线对。
 */

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
  runtime: { mode: 'host' as 'host' | 'wsl', distro: null as string | null },
  ledger: null as unknown as RunLedger,
  goals: null as unknown as SessionGoalStore,
}))

vi.mock('../config-store', () => ({ configStore: { get: vi.fn(() => undefined) } }))
vi.mock('../session-file-meta', () => ({
  readSessionMetaFromFile: vi.fn(async () => ({ cwd: '/workspace', sessionId: 'a' })),
  sessionFilePathForFs: (file: string) => file,
}))
vi.mock('../wsl/runtime-config', () => ({
  getAgentRuntimeConfig: () => mocks.runtime,
  isWslRuntimeActive: () => mocks.runtime.mode === 'wsl',
}))
vi.mock('../worker-pool-config', () => ({
  readMaxSessionWorkers: () => 4,
  readSessionWorkerIdleTimeoutMinutes: () => 0,
}))
vi.mock('../worker-manager-pool', async (original) => ({
  ...(await original<typeof import('../worker-manager-pool')>()),
  forkWorkerForCwd: mocks.fork,
}))
vi.mock('../run-ledger-instance', () => ({ getRunLedger: () => mocks.ledger }))
vi.mock('../session-goals-instance', () => ({ getSessionGoalStore: () => mocks.goals }))

const { WorkerManager } = await import('../worker-manager')
const { attachWorkerHandlers } = await import('../worker-manager-pool')
const { normalizeSessionKey, workspacePoolKey } = await import('../worker-session-key')

type Message = Record<string, unknown>
type Handler = (message: Message, reply: (response: Message) => void) => void

const key = (file: string) => normalizeSessionKey(file)

function makeSlot(file: string | null, handler: Handler, poolKey = file ? key(file) : workspacePoolKey('/workspace')): WorkerSlot {
  let listener: (message: Message) => void = () => {}
  const slot: WorkerSlot = {
    poolKey,
    cwd: '/workspace',
    sessionFile: file ? key(file) : null,
    runtime: { mode: 'host', distro: null },
    worker: {
      kind: 'utilityProcess',
      postMessage: vi.fn((message: Message) => handler(message, (response) => queueMicrotask(() => listener(response)))),
      onMessage: (cb) => {
        listener = cb as (message: Message) => void
      },
      onExit: vi.fn(),
      onStdout: vi.fn(),
      onStderr: vi.fn(),
      kill: vi.fn(),
    },
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: false,
    lastIdleAt: Date.now(),
    lastForegroundAt: Date.now(),
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
  attachWorkerHandlers(slot, slot.worker, { mainWindow: null, onAppEvent: vi.fn(), onSlotExit: vi.fn() })
  return slot
}

const normalReply: Handler = (message, reply) => {
  reply({ requestId: message.requestId, type: `${message.type}-done`, state: { sessionId: 'a' }, items: [] })
}

const posted = (slot: WorkerSlot, type: string) =>
  (slot.worker.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(([message]) => (message as Message).type === type)

type Sent = { channel: string; payload: Record<string, unknown> }

type Harness = { manager: InstanceType<typeof WorkerManager>; sent: Sent[] }

function setup(...slots: WorkerSlot[]): Harness {
  const manager = new WorkerManager()
  const sent: Sent[] = []
  const state = manager as unknown as { pool: Map<string, WorkerSlot>; foregroundPoolKey: string | null }
  for (const slot of slots) state.pool.set(slot.poolKey, slot)
  state.foregroundPoolKey = slots[0]?.poolKey ?? null
  manager.setMainWindow({
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: Record<string, unknown>) => sent.push({ channel, payload }) },
  } as never)
  return { manager, sent }
}

const exitSlot = (manager: InstanceType<typeof WorkerManager>, slot: WorkerSlot, code: number): void =>
  (manager as unknown as { handleSlotExit(s: WorkerSlot, c: number): void }).handleSlotExit(slot, code)

beforeEach(() => {
  mocks.fork.mockReset()
  mocks.runtime = { mode: 'host', distro: null }
  const dir = mkdtempSync(join(tmpdir(), 'pi-goal-ledger-'))
  mocks.ledger = createRunLedger({ filePath: join(dir, 'run-ledger.json') })
  mocks.goals = new SessionGoalStore(dir)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('goal reaches the worker before the turn starts', () => {
  it('finds the goal when the renderer stored a normalized key and the prompt carries a native path', async () => {
    // 渲染层用归一化键写入（session-goal-store 的 keyOf），prompt.send 带的是 pi 返回的原生路径。
    const nativePath = 'C:\\ws\\sessions\\a.jsonl'
    const normalizedKey = 'C:/ws/sessions/a.jsonl'
    const slot = makeSlot(nativePath, normalReply)
    const { manager } = setup(slot)
    mocks.goals.set({ sessionFile: normalizedKey, goal: '首页 banner 抽成组件', criteria: ['背景图已生成', '高度 700px'] })

    await manager.sendPrompt('开始干活', nativePath)

    const goals = posted(slot, 'setGoal')
    expect(goals).toHaveLength(1)
    const section = String(goals[0][0].goal ?? '')
    // R2 之前这里拿到的是 null：目标存了一个键、查了另一个键 → worker 的 goal 段被撤掉
    expect(section).toContain('首页 banner 抽成组件')
    expect(section).toContain('[未达成] 背景图已生成')
    // 目标先到、prompt 后到（顺序决定这一轮到底带不带 goal 段）
    const order = (slot.worker.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([message]) => (message as Message).type)
      .filter((type) => type === 'setGoal' || type === 'prompt')
    expect(order).toEqual(['setGoal', 'prompt'])
  })

  it('does not spawn or touch another session worker when pushing the goal', async () => {
    const a = makeSlot('/sessions/a.jsonl', normalReply)
    const b = makeSlot('/sessions/b.jsonl', normalReply)
    const { manager } = setup(a, b)
    mocks.goals.set({ sessionFile: '/sessions/a.jsonl', goal: '只推 A', criteria: ['x'] })

    await manager.sendPrompt('hi', '/sessions/a.jsonl')

    expect(posted(a, 'setGoal')).toHaveLength(1)
    expect(posted(b, 'setGoal')).toHaveLength(0)
    expect(mocks.fork).not.toHaveBeenCalled()
  })
})

describe('run ledger survives a crashed worker', () => {
  it('keeps the run as an orphan and reports it on ipc:worker-fatal', async () => {
    const file = '/sessions/a.jsonl'
    const slot = makeSlot(file, (message, reply) => {
      if (message.type === 'prompt') {
        expect(mocks.ledger.read()).toMatchObject([{ sessionFile: key(file) }])
        reply({ type: 'app-event', event: { type: 'run', phase: 'started', runId: 'run-a' } })
      }
      normalReply(message, reply)
    })
    const { manager, sent } = setup(slot)
    attachWorkerHandlers(slot, slot.worker, {
      mainWindow: null,
      onAppEvent: (payload) => {
        const target = manager as unknown as { forwardAppEvent(event: typeof payload): void }
        target.forwardAppEvent(payload)
      },
      onSlotExit: vi.fn(),
    })

    await manager.sendPrompt('长任务', file)
    expect(slot.agentTurnActive).toBe(true)
    expect(mocks.ledger.read()).toMatchObject([{ sessionFile: key(file), runId: 'run-a' }])
    exitSlot(manager, slot, 1)

    // R1 之前这里是 []：mark-orphan 之后紧跟 release，记录当场被删
    expect(mocks.ledger.read().map((row) => row.sessionFile)).toEqual([key(file)])
    expect(mocks.ledger.listOrphans().map((row) => row.orphanReason)).toEqual(['worker-exit:1'])

    const fatal = sent.find((entry) => entry.channel === 'ipc:worker-fatal')
    expect(fatal?.payload.orphanedRuns).toBe(1)
  })

  it('defers external model reload for a busy session only and refreshes its catalog after settlement', async () => {
    const a = '/sessions/a.jsonl'
    const b = '/sessions/b.jsonl'
    const first = makeSlot(a, normalReply)
    const second = makeSlot(b, normalReply)
    const { manager, sent } = setup(first, second)
    await manager.sendPrompt('test', a)
    await manager.reloadModels()
    expect(posted(first, 'reloadModels')).toHaveLength(0)
    expect(posted(second, 'reloadModels')).toHaveLength(1)

    const payload = {
      event: { type: 'run', phase: 'idle', settled: true, sessionFile: key(a) },
      fromCwd: first.cwd, fromPoolKey: first.poolKey, sessionFile: key(a), agentTurnActive: false,
    }
    const target = manager as unknown as { forwardAppEvent(event: typeof payload): void }
    target.forwardAppEvent(payload)
    await vi.waitFor(() => expect(sent.some(({ channel }) => channel === 'ipc:model-catalog-changed')).toBe(true))
    expect(posted(first, 'reloadModels')).toHaveLength(1)
  })

  it('releases the record when the turn ends normally (no orphan left behind)', async () => {
    const file = '/sessions/a.jsonl'
    const slot = makeSlot(file, normalReply)
    const { manager } = setup(slot)

    await manager.sendPrompt('短任务', file)
    expect(mocks.ledger.read()).toHaveLength(1)

    const forward = manager as unknown as {
      forwardAppEvent(payload: {
        event: Record<string, unknown>
        fromCwd: string
        fromPoolKey: string
        sessionFile: string | null
        agentTurnActive: boolean
      }): void
    }
    forward.forwardAppEvent({
      event: { type: 'run', phase: 'idle', sessionFile: key(file) },
      fromCwd: '/workspace',
      fromPoolKey: slot.poolKey,
      sessionFile: key(file),
      agentTurnActive: false,
    })

    expect(mocks.ledger.read()).toEqual([])
    expect(mocks.ledger.listOrphans()).toEqual([])
  })

  it('applies a pending model update when the worker rejects a prompt before starting the run', async () => {
    const file = '/sessions/a.jsonl'
    let rejectPrompt: () => void = () => { throw new Error('Expected the prompt to reach the worker') }
    const slot = makeSlot(file, (message, reply) => {
      if (message.type === 'prompt') {
        rejectPrompt = () => reply({ requestId: message.requestId, type: 'error', error: 'No session' })
        return
      }
      normalReply(message, reply)
    })
    const { manager } = setup(slot)

    const prompt = manager.sendPrompt('test', file)
    await vi.waitFor(() => expect(posted(slot, 'prompt')).toHaveLength(1))
    await manager.reloadModels()
    expect(posted(slot, 'reloadModels')).toHaveLength(0)

    const rejected = expect(prompt).rejects.toThrow('No session')
    rejectPrompt()
    await rejected
    expect(mocks.ledger.read()).toEqual([])
    expect(posted(slot, 'reloadModels')).toHaveLength(1)
  })
})
