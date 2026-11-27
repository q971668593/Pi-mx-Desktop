import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * acp_delegate 子 Agent 的实况文件落在系统 temp 下的 `acp-delegate/`：
 * 每次派发是 `.out`（最终报告）、`.activity`（逐行工具活动）、`.session.jsonl`（完整子会话）。
 *
 * 渲染层只知道 runId（工具结果里的 details.runId），不知道该去哪找文件，
 * 所以这里由主进程按 runId 解析出真实存在的子会话文件；渲染层拿到路径后
 * 走 `session.prepare` + 只读预览，就能点进去看这个子 Agent 的思考和进度。
 *
 * 只接受安全字符的 runId 且只在本应用的 acp-delegate 目录里找：这是宿主进程写的位置，
 * 不能让渲染层借这个通道探任意路径是否存在。
 */
const TEMP_DIR_NAME = 'acp-delegate'
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/

function delegateDir(): string {
  try {
    return join(app.getPath('temp'), TEMP_DIR_NAME)
  } catch {
    return ''
  }
}

export function resolveDelegateSessionFiles(runIds: unknown[]): Record<string, string | null> {
  const dir = delegateDir()
  const result: Record<string, string | null> = {}
  if (!dir) {
    for (const runId of runIds) if (typeof runId === 'string') result[runId] = null
    return result
  }
  for (const runId of runIds) {
    if (typeof runId !== 'string') continue
    if (!RUN_ID_PATTERN.test(runId)) {
      result[runId] = null
      continue
    }
    const sessionFile = join(dir, `${runId}.session.jsonl`)
    result[runId] = existsSync(sessionFile) ? sessionFile : null
  }
  return result
}

export type DelegateProbedState = 'running' | 'completed' | 'stale'

const DEFAULT_DELEGATE_STALE_MS = 10 * 60 * 1000

function latestMtimeMs(paths: string[]): number {
  let latest = 0
  for (const file of paths) {
    try {
      const mtime = statSync(file).mtimeMs
      if (Number.isFinite(mtime) && mtime > latest) latest = mtime
    } catch {
      /* 文件不存在 */
    }
  }
  return latest
}

/**
 * 核对 acp_delegate 子 Agent 的真实落地状态：
 * - `.out` 文件已写出 → `completed`
 * - `.activity` / `.session.jsonl` 最近仍在更新 → `running`
 * - 无产物或长时间静止 → `stale`（已死/已断开的历史残影）
 */
export function probeDelegateRunStates(
  runIds: unknown[],
  staleMs = DEFAULT_DELEGATE_STALE_MS,
): Record<string, DelegateProbedState> {
  const dir = delegateDir()
  const result: Record<string, DelegateProbedState> = {}
  const now = Date.now()
  for (const runId of runIds) {
    if (typeof runId !== 'string') continue
    if (!dir || !RUN_ID_PATTERN.test(runId)) {
      result[runId] = 'stale'
      continue
    }
    if (existsSync(join(dir, `${runId}.out`))) {
      result[runId] = 'completed'
      continue
    }
    const lastWrite = latestMtimeMs([
      join(dir, `${runId}.activity`),
      join(dir, `${runId}.session.jsonl`),
    ])
    result[runId] = lastWrite > 0 && now - lastWrite <= staleMs ? 'running' : 'stale'
  }
  return result
}
