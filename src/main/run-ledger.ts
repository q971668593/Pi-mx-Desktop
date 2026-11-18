/**
 * Run ledger —— 「哪个会话正在跑」的持久账本（崩溃恢复的最小闭环）
 *
 * 参考 opencode 的 write-ahead execution claim（packages/core/src/session/execution.ts）：
 * 每轮开始写一条持久记录，终态删除；进程被 kill 时记录残留，下次启动就能知道
 * 「上次是谁在跑、跑到哪」。这里刻意做成**收敛版**：
 *
 *  - 只记 sessionFile / cwd / 起止时间 / runId，不碰 pi 的 JSONL 会话数据（不另造内核）
 *  - 不做自动续跑（语义变更需产品决策），只提供「孤儿 run」清单给主进程告警与后续 UI
 *  - 纯 Node fs + 可注入时钟，便于单测；本文件**不 import electron**
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

export const RUN_LEDGER_VERSION = 1
export const DEFAULT_MAX_ENTRIES = 200
export const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000

export interface RunRecord {
  /** pi 会话 JSONL 绝对路径；稳定路由键 */
  sessionFile: string
  /** 工作目录（用于诊断；空串表示未知） */
  cwd: string
  startedAt: number
  updatedAt: number
  runId?: string
  /** 非正常退出时打上；正常终态会直接删除记录 */
  orphanedAt?: number
  orphanReason?: string
}

export interface RunLedgerFile {
  version: typeof RUN_LEDGER_VERSION
  runs: RunRecord[]
}

export interface RunLedgerOptions {
  filePath: string
  now?: () => number
  maxEntries?: number
  maxAgeMs?: number
  onError?: (error: unknown) => void
}

export interface BeginRunInput {
  sessionFile: string
  cwd?: string
  runId?: string
}

export interface MarkOrphanedInput {
  reason?: string
}

export interface SweepResult {
  /** 本次被判为孤儿（含此前已标记但仍在保留期内）的记录 */
  orphans: RunRecord[]
  /** 清理后剩余条数 */
  kept: number
}

export interface RunLedger {
  readonly filePath: string
  beginRun(input: BeginRunInput): RunRecord | null
  identifyRun(sessionFile: string, runId: string): void
  releaseRun(sessionFile: string): boolean
  markOrphaned(sessionFile: string, input?: MarkOrphanedInput): boolean
  listOrphans(maxAgeMs?: number): RunRecord[]
  read(): RunRecord[]
  sweep(reason?: string): SweepResult
}

function isRecord(value: unknown): value is RunRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.sessionFile === 'string' &&
    row.sessionFile.length > 0 &&
    typeof row.startedAt === 'number' &&
    Number.isFinite(row.startedAt)
  )
}

function normalize(raw: unknown): RunLedgerFile {
  if (!raw || typeof raw !== 'object') return { version: RUN_LEDGER_VERSION, runs: [] }
  const file = raw as Record<string, unknown>
  const runs = Array.isArray(file.runs) ? file.runs.filter(isRecord) : []
  return { version: RUN_LEDGER_VERSION, runs }
}

export function createRunLedger(options: RunLedgerOptions): RunLedger {
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const defaultMaxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const report = options.onError ?? (() => undefined)
  const filePath = options.filePath

  function load(): RunLedgerFile {
    if (!existsSync(filePath)) return { version: RUN_LEDGER_VERSION, runs: [] }
    try {
      return normalize(JSON.parse(readFileSync(filePath, 'utf8')))
    } catch (error) {
      // 账本是可丢弃的诊断数据：损坏就重置，绝不让它拖垮启动。
      report(error)
      return { version: RUN_LEDGER_VERSION, runs: [] }
    }
  }

  function save(file: RunLedgerFile): void {
    const runs = [...file.runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, maxEntries)
    const payload = JSON.stringify({ version: RUN_LEDGER_VERSION, runs }, null, 2)
    const tempPath = `${filePath}.tmp`
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(tempPath, payload, 'utf8')
      // rename 在同分区是原子的：崩溃时要么是旧文件，要么是新文件，不会半截。
      renameSync(tempPath, filePath)
    } catch (error) {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath)
      } catch {
        /* ignore */
      }
      report(error)
    }
  }

  function mutate(change: (runs: RunRecord[]) => RunRecord[]): void {
    const file = load()
    save({ version: RUN_LEDGER_VERSION, runs: change(file.runs) })
  }

  return {
    filePath,

    beginRun(input) {
      const sessionFile = input.sessionFile.trim()
      if (!sessionFile) return null
      const at = now()
      const record: RunRecord = {
        sessionFile,
        cwd: input.cwd ?? '',
        startedAt: at,
        updatedAt: at,
        ...(input.runId ? { runId: input.runId } : {}),
      }
      mutate((runs) => [record, ...runs.filter((row) => row.sessionFile !== sessionFile)])
      return record
    },

    identifyRun(sessionFile, runId) {
      mutate((runs) => runs.map((row) =>
        row.sessionFile === sessionFile && row.orphanedAt === undefined
          ? { ...row, runId, updatedAt: now() }
          : row,
      ))
    },

    releaseRun(sessionFile) {
      const key = sessionFile.trim()
      if (!key) return false
      const file = load()
      const next = file.runs.filter((row) => row.sessionFile !== key)
      if (next.length === file.runs.length) return false
      save({ version: RUN_LEDGER_VERSION, runs: next })
      return true
    },

    markOrphaned(sessionFile, input) {
      const key = sessionFile.trim()
      if (!key) return false
      const at = now()
      let touched = false
      mutate((runs) =>
        runs.map((row) => {
          if (row.sessionFile !== key) return row
          touched = true
          return { ...row, orphanedAt: at, orphanReason: input?.reason ?? 'worker-exit', updatedAt: at }
        }),
      )
      return touched
    },

    listOrphans(maxAgeMs) {
      const budget = maxAgeMs ?? defaultMaxAgeMs
      const at = now()
      return load()
        .runs.filter((row) => typeof row.orphanedAt === 'number' && at - row.orphanedAt <= budget)
        .sort((a, b) => b.startedAt - a.startedAt)
    },

    read() {
      return load()
        .runs.sort((a, b) => b.startedAt - a.startedAt)
    },

    sweep(reason) {
      const at = now()
      const reasonText = reason ?? 'process-restart'
      const kept: RunRecord[] = []
      const orphans: RunRecord[] = []
      for (const row of load().runs) {
        const alreadyOrphaned = typeof row.orphanedAt === 'number'
        // 超龄记录直接丢弃（正常结束的清理由 releaseRun 负责）。
        if (row.orphanedAt !== undefined && at - row.orphanedAt > defaultMaxAgeMs) continue
        const next: RunRecord = alreadyOrphaned
          ? row
          : { ...row, orphanedAt: at, orphanReason: reasonText, updatedAt: at }
        kept.push(next)
        orphans.push(next)
      }
      save({ version: RUN_LEDGER_VERSION, runs: kept })
      return { orphans, kept: kept.length }
    },
  }
}
