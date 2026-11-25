import type { AppEvent } from '@shared/app-events'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'
import type { WorkerTransport } from './worker-transport'

export type WorkerInitResult = {
  sessionId: string
  model?: string
  thinkingLevel?: string
}

export type WorkerSlot = {
  /** Pool map key: sessionFile abs path or `ws:${cwd}` */
  poolKey: string
  cwd: string
  /** Runtime identity captured when this worker was created. */
  runtime: { mode: 'host' | 'wsl'; distro: string | null }
  /** Bound session file when known; null for workspace-only slots */
  sessionFile: string | null
  worker: WorkerTransport
  pendingRequests: Map<
    string,
    { resolve: (v: WorkerResponsePayload) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >
  requestCounter: number
  initResolver: ((r: WorkerInitResult) => void) | null
  initRejecter: ((e: Error) => void) | null
  initPromise: Promise<WorkerInitResult> | null
  agentTurnActive: boolean
  /** Last time turn became idle (ms); used for idle TTL eviction */
  lastIdleAt: number
  /** Last time this slot was foreground (ms) */
  lastForegroundAt: number
  sdkFallback: boolean
  autoRestartEnabled: boolean
  stopping: boolean
  /** Fork/clone RPCs awaiting a session switch; such slots are not reused for other sessions. */
  identityOpsInFlight?: number
}

export type WorkerAppEventForward = {
  event: AppEvent
  fromCwd: string
  fromPoolKey: string
  sessionFile: string | null
  agentTurnActive: boolean
}

/**
 * 「按目标再跑一轮」的结果。冷会话会先唤醒再发，唤醒失败要如实回报给 UI，
 * 不能像以前那样静默什么也不做。
 */
export type GoalRoundStart = {
  started: boolean
  reason?: 'wake_failed'
}
