/**
 * Worker 槽位生命周期状态机（T5 第一步：纯转移表）
 *
 * 现状问题（`doc/CONTEXT.md` 与 `session-shell-stream-switch-race.test.ts` 668 行可佐证）：
 * 槽位状态分散在 `WorkerSlot` 的 `stopping / agentTurnActive / sessionFile / initPromise`
 * 等字段里，靠 `handleSlotExit` 里的一串 if 维持；分支只能靠长集成测试兜住。
 *
 * 做法（借鉴 opencode `desktop/src/main/ipc-machine.ts` / `lifecycle/machine.ts`）：
 * 把「状态 × 事件 → 新状态 + 命令」写成纯函数，副作用以**命令**声明，由 manager 执行。
 *
 * 硬约束：
 *  - 本文件不得 import electron / fs / 时钟；`lastIdleAt` 之类时间戳由调用方塞进事件
 *  - 只表达槽位生命周期；spawn 参数、RPC 细节、UI 事件仍在 manager
 *  - 所有「不该发生」的组合一律返回同一状态 + 空命令（幂等），绝不抛错
 *
 * 接入顺序（见 PI-MX-OPTIMIZATION-TASKS.md T5）：handleSlotExit → sendPrompt/followUp → spawn 决策。
 */

export type SlotPhase = 'spawning' | 'ready' | 'busy' | 'draining' | 'dead'

export interface SlotState {
  readonly phase: SlotPhase
  /** 绑定到该槽位的会话文件；workspace-only 槽位为 null */
  readonly sessionFile: string | null
  /** 当前活跃 turn 的序号；无 turn 时为 null */
  readonly turnId: number | null
  /** 单调递增的 turn 计数器，用于区分晚到的上一轮事件 */
  readonly turnSeq: number
}

export type SlotEvent =
  /** 子进程初始化成功 / 失败 */
  | { readonly type: 'spawn.ok' }
  | { readonly type: 'spawn.fail'; readonly message: string }
  /** 槽位绑定/改绑会话（fork / clone / 复用工作区槽位） */
  | { readonly type: 'session.bind'; readonly sessionFile: string | null }
  /** 一轮开始（sendPrompt / followUp 生效） */
  | { readonly type: 'turn.start' }
  /** 一轮结束（run 事件到达 idle/failed/cancelled/settled） */
  | { readonly type: 'turn.end'; readonly outcome: 'idle' | 'failed' | 'cancelled' }
  /** 空闲超时回收（worker-pool 的 TTL） */
  | { readonly type: 'idle.timeout' }
  /** 主动停止（stop() / 关闭工作区 / 应用退出） */
  | { readonly type: 'stop.request' }
  | { readonly type: 'stop.done' }
  /** 子进程退出（任何原因） */
  | { readonly type: 'worker.exit'; readonly code: number }

export type SlotCommand =
  /** 记一条运行账本（run-ledger.beginRun） */
  | { readonly type: 'run.begin' }
  /** 释放运行账本（run-ledger.releaseRun） */
  | { readonly type: 'run.release' }
  /** 记账为孤儿（run-ledger.markOrphaned），用于崩溃归因；标记后不得紧跟 release，否则记录会被删掉 */
  | { readonly type: 'run.mark-orphan'; readonly reason: string }
  /** 通知渲染层 worker 异常退出（ipc:worker-fatal） */
  | { readonly type: 'notify.fatal'; readonly message: string }
  /** 通知初始化失败（挂在 initPromise 的 reject 上） */
  | { readonly type: 'notify.init-failed'; readonly message: string }
  /** 释放子进程与句柄 */
  | { readonly type: 'slot.dispose' }

export interface SlotTransition {
  readonly state: SlotState
  readonly commands: readonly SlotCommand[]
}

export function initialSlotState(): SlotState {
  return { phase: 'spawning', sessionFile: null, turnId: null, turnSeq: 0 }
}

/**
 * 从现有 `WorkerSlot` 字段推导阶段（接线期用，避免一次性改动槽位存储）。
 * 只覆盖能可靠推导的三个阶段；`spawning` / `dead` 由调用方自己判断。
 */
export function derivePhase(flags: { stopping: boolean; agentTurnActive: boolean }): SlotPhase {
  if (flags.stopping) return 'draining'
  return flags.agentTurnActive ? 'busy' : 'ready'
}

/**
 * 子进程退出时的运行账本处置（T5 接线点 1：`handleSlotExit`）。
 *
 * 只返回账本相关命令；`notify.fatal` 仍由 manager 根据 `autoRestartEnabled` 决定（那是策略，不是生命周期）。
 *
 * **崩渍分支只能 `mark-orphan`，绝不能紧跟 `release`**：`releaseRun` 是按 sessionFile
 * 把整行删掉，「先标记再释放」等于当场销毁唯一的归因证据（曾经的真 bug：启动 sweep 与
 * `ipc:worker-fatal.orphanedRuns` 永远是 0）。终态已知（正常退出 / run 事件落到
 * idle·failed·cancelled）才 release。
 */
export function exitLedgerCommands(phase: SlotPhase, code: number): readonly SlotCommand[] {
  if (phase === 'draining' || phase === 'dead') return []
  if (code === 0) return phase === 'busy' ? [{ type: 'run.release' }] : []
  if (phase !== 'busy') return []
  return [{ type: 'run.mark-orphan', reason: `worker-exit:${code}` }]
}

/** T5 接线点 2：一轮开始时的账本命令（`sendPrompt` / `followUp`）。 */
export function turnStartCommands(phase: SlotPhase): readonly SlotCommand[] {
  return transition(seed(phase), { type: 'turn.start' }).commands
}

/** T5 接线点 2：一轮结束时的账本命令（run 事件的 idle/failed/cancelled/settled）。 */
export function turnEndCommands(
  phase: SlotPhase,
  outcome: 'idle' | 'failed' | 'cancelled',
): readonly SlotCommand[] {
  return transition(seed(phase), { type: 'turn.end', outcome }).commands
}

function seed(phase: SlotPhase): SlotState {
  return { phase, sessionFile: null, turnId: null, turnSeq: 0 }
}

const unchanged = (state: SlotState): SlotTransition => ({ state, commands: [] })

/**
 * 单次转移。约定：
 *  - `dead` 之后的任何事件都不产生命令（防重复通知 / 重复 dispose）
 *  - `turn.end` 只在 `busy` 时释放账本；`ready` 收到是无害噪声（run 事件晚到）
 *  - `idle.timeout` 在 `busy` 时忽略（绝不回收正在跑的 turn）
 *  - `worker.exit` 在 `draining` 时算预期退出：不发 fatal，但要释放账本
 */
export function transition(state: SlotState, event: SlotEvent): SlotTransition {
  if (state.phase === 'dead') return unchanged(state)

  switch (event.type) {
    case 'spawn.ok':
      if (state.phase !== 'spawning') return unchanged(state)
      return { state: { ...state, phase: 'ready' }, commands: [] }

    case 'spawn.fail':
      if (state.phase !== 'spawning') return unchanged(state)
      return {
        state: { ...state, phase: 'dead' },
        commands: [{ type: 'notify.init-failed', message: event.message }],
      }

    case 'session.bind': {
      if (state.phase === 'draining') return unchanged(state)
      return { state: { ...state, sessionFile: event.sessionFile }, commands: [] }
    }

    case 'turn.start': {
      if (state.phase !== 'ready') return unchanged(state)
      const turnSeq = state.turnSeq + 1
      return { state: { ...state, phase: 'busy', turnId: turnSeq, turnSeq }, commands: [{ type: 'run.begin' }] }
    }

    case 'turn.end': {
      if (state.phase !== 'busy') return unchanged(state)
      // 收到 run 终态 = 这一轮的去向已知（哪怕 failed），账本记录就该删掉。
      // `mark-orphan` 只用于「进程没了、不知道这轮怎么了」，标记后必须保留记录。
      return { state: { ...state, phase: 'ready', turnId: null }, commands: [{ type: 'run.release' }] }
    }

    case 'idle.timeout': {
      if (state.phase !== 'ready') return unchanged(state)
      return { state: { ...state, phase: 'draining' }, commands: [{ type: 'slot.dispose' }] }
    }

    case 'stop.request': {
      if (state.phase === 'draining') return unchanged(state)
      return { state: { ...state, phase: 'draining' }, commands: [{ type: 'slot.dispose' }] }
    }

    case 'stop.done':
      if (state.phase !== 'draining') return unchanged(state)
      return { state: { ...state, phase: 'dead', turnId: null }, commands: [] }

    case 'worker.exit': {
      const commands: SlotCommand[] = []
      // 预期退出（已 draining）不再告警；非主动停止才发 fatal
      if (state.phase !== 'draining' && event.code !== 0) {
        commands.push({ type: 'notify.fatal', message: `Worker 已退出（code ${event.code}）` })
        // 崩在 turn 里：记成孤儿并**保留记录**（release 会把它删掉，见 exitLedgerCommands 注释）
        if (state.phase === 'busy') commands.push({ type: 'run.mark-orphan', reason: `worker-exit:${event.code}` })
      } else if (state.phase === 'busy') {
        // 干净退出（code 0）而 turn 还在：终态已知，直接释放
        commands.push({ type: 'run.release' })
      }
      return { state: { ...state, phase: 'dead', turnId: null }, commands }
    }

    default:
      return unchanged(state)
  }
}
