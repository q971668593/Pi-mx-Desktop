/**
 * 「这个会话下次启动时用哪个模型」的待生效记录。
 *
 * 背景：`model.set` 走 worker 的 `session.setModel()`，它会往会话 JSONL 追加一条
 * model_change。会话没有活着的 worker 时，这条路径要先 spawn worker + 把整份 JSONL
 * 读进内存（实测 54MB 会话 2266ms），用户看到的只是「切模型卡住」。
 *
 * 这里把「没有活 worker 的会话切模型」变成纯内存/一条小文件的写入，等 worker 真正
 * 启动（发消息 / 打开会话）后再补写 model_change —— 数据真相仍是 pi 的会话文件，
 * 只是把「打开会话」的成本推迟到真正需要它的那一刻。
 *
 * 纯 Node，可注入 fs 与时钟；不 import electron。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const SESSION_MODEL_OVERRIDES_VERSION = 1
export const DEFAULT_MAX_OVERRIDES = 200

export type PendingSessionModel = {
  sessionFile: string
  provider: string
  modelId: string
  requestedAt: number
  /** Thinking level the user picked for this session while no worker was alive. */
  thinkingLevel?: string
}

type OverridesFile = { version: number; overrides: PendingSessionModel[] }

export interface SessionModelOverridesOptions {
  /** Omitted = memory only (main-process tests / environments without userData). */
  filePath?: string
  now?: () => number
  maxEntries?: number
  onError?: (error: unknown) => void
}

export interface SessionModelOverrides {
  readonly filePath: string | null
  /** Record the model (and optional thinking level) a session adopts when it next starts. */
  set(sessionFile: string, provider: string, modelId: string, thinkingLevel?: string): PendingSessionModel
  /** Recorded model for this session, if any (does not consume it). */
  get(sessionFile: string): PendingSessionModel | null
  /** Remove after the worker confirmed the model change. */
  clear(sessionFile: string): void
  list(): PendingSessionModel[]
}

function isPending(value: unknown): value is PendingSessionModel {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.sessionFile === 'string' && row.sessionFile.length > 0 &&
    typeof row.provider === 'string' && row.provider.length > 0 &&
    typeof row.modelId === 'string' && row.modelId.length > 0 &&
    typeof row.requestedAt === 'number' && Number.isFinite(row.requestedAt) &&
    (row.thinkingLevel === undefined || typeof row.thinkingLevel === 'string')
  )
}

export function createSessionModelOverrides(options: SessionModelOverridesOptions): SessionModelOverrides {
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_OVERRIDES
  const report = options.onError ?? (() => undefined)
  const filePath = options.filePath ?? null
  let memory: PendingSessionModel[] = []

  function load(): PendingSessionModel[] {
    if (!filePath) return memory
    if (!existsSync(filePath)) return []
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<OverridesFile>
      if (!Array.isArray(parsed.overrides)) return []
      return parsed.overrides.filter(isPending)
    } catch (error) {
      // Pending overrides are advisory: a corrupt file must never block a model switch.
      report(error)
      return []
    }
  }

  function save(rows: PendingSessionModel[]): void {
    const trimmed = rows.slice(0, maxEntries)
    if (!filePath) {
      memory = trimmed
      return
    }
    const payload = JSON.stringify({ version: SESSION_MODEL_OVERRIDES_VERSION, overrides: trimmed }, null, 2)
    const temp = `${filePath}.tmp`
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600 })
      renameSync(temp, filePath)
    } catch (error) {
      report(error)
      try {
        if (existsSync(temp)) unlinkSync(temp)
      } catch {
        /* best effort */
      }
    }
  }

  return {
    filePath,
    set(sessionFile, provider, modelId, thinkingLevel) {
      const rows = load().filter((row) => row.sessionFile !== sessionFile)
      const row: PendingSessionModel = {
        sessionFile,
        provider,
        modelId,
        requestedAt: now(),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      }
      // Newest first: the cap then drops the oldest pending requests, never a fresh one.
      save([row, ...rows])
      return row
    },
    get(sessionFile) {
      return load().find((row) => row.sessionFile === sessionFile) ?? null
    },
    clear(sessionFile) {
      const rows = load()
      const next = rows.filter((row) => row.sessionFile !== sessionFile)
      if (next.length !== rows.length) save(next)
    },
    list() {
      return load()
    },
  }
}
