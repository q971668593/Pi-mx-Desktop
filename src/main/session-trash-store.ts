import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sessionFilePathForFs } from './session-file-meta'

/**
 * 会话回收站。
 *
 * 删除对话时不再直接销毁：先把 .jsonl 复制到用户目录下的 session-trash/，
 * 连同「原路径 / 属于哪个项目 / 标题 / 删除时间」写进同名 .json 旁边。
 * 界面上有单独的全屏列表可以还原或彻底删除；超过 5 天的条目在启动与打开列表时自动清掉。
 */
export const SESSION_TRASH_TTL_MS = 5 * 24 * 60 * 60_000

export type SessionTrashEntry = {
  id: string
  sessionFile: string
  workspaceId: string
  title: string
  deletedAt: number
}

type TrashSidecar = {
  sessionFile?: string
  workspaceId?: string
  title?: string
  /** 兼容旧字段（早期只有 at）。 */
  at?: number
  deletedAt?: number
}

/** 测试里 electron.app 可能没有 getPath，退回临时目录。 */
export function sessionTrashDir(): string {
  try {
    return join(app.getPath('userData'), 'session-trash')
  } catch {
    return join(tmpdir(), 'pi-session-trash')
  }
}

function sidecarPath(id: string): string {
  return join(sessionTrashDir(), `${id}.json`)
}

function payloadPath(id: string): string {
  return join(sessionTrashDir(), `${id}.jsonl`)
}

function readSidecar(id: string): TrashSidecar | null {
  try {
    return JSON.parse(readFileSync(sidecarPath(id), 'utf8')) as TrashSidecar
  } catch {
    return null
  }
}

function toEntry(id: string, meta: TrashSidecar): SessionTrashEntry {
  return {
    id,
    sessionFile: String(meta.sessionFile || ''),
    workspaceId: String(meta.workspaceId || (meta.sessionFile ? dirname(meta.sessionFile) : '')),
    title: String(meta.title || ''),
    deletedAt: Number(meta.deletedAt ?? meta.at ?? 0) || 0,
  }
}

function removeEntryFiles(id: string): void {
  rmSync(sidecarPath(id), { force: true })
  rmSync(payloadPath(id), { force: true })
}

/**
 * 目录里的条目 id（不看扩展名）。
 * 侧车与 payload 是两次独立写盘，任何一步失败都会留下「只有一半」的条目：
 * 只按 *.json 遍历会让孤儿 .jsonl 永远列不出来、也永远清不掉，回收站目录无上限膨胀。
 */
function entryIds(): string[] {
  const dir = sessionTrashDir()
  if (!existsSync(dir)) return []
  const ids = new Set<string>()
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json')) ids.add(name.slice(0, -'.json'.length))
    else if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length))
  }
  return [...ids]
}

/** 清掉过期条目（默认 5 天）与半截图；返回清掉的条数。 */
export function purgeExpiredSessionTrash(now = Date.now()): number {
  if (!existsSync(sessionTrashDir())) return 0
  let purged = 0
  for (const id of entryIds()) {
    const meta = readSidecar(id)
    const hasPayload = existsSync(payloadPath(id))
    if (!meta || !hasPayload) {
      // 半截图：缺任一侧都清掉，不给用户看也删不掉的幽灵。
      removeEntryFiles(id)
      purged += 1
      continue
    }
    const deletedAt = Number(meta.deletedAt ?? meta.at ?? 0)
    if (!deletedAt || now - deletedAt > SESSION_TRASH_TTL_MS) {
      removeEntryFiles(id)
      purged += 1
    }
  }
  return purged
}

/**
 * 把会话文件复制进回收站。返回条目 id；复制失败返回 null（调用方必须据此放弃删除，
 * 否则就会出现「文件删了、回收站没有、也撤销不了」）。
 */
export function stashSessionForUndo(
  sessionFile: string,
  extra: { workspaceId?: string; title?: string } = {},
): string | null {
  const id = randomUUID()
  try {
    mkdirSync(sessionTrashDir(), { recursive: true })
    // 先写侧车再复制 payload：反过来的话，payload 复制成功而侧车写失败会留下无主 .jsonl。
    const meta: TrashSidecar = {
      sessionFile,
      workspaceId: extra.workspaceId || dirname(sessionFile),
      title: extra.title || '',
      deletedAt: Date.now(),
    }
    writeFileSync(sidecarPath(id), JSON.stringify(meta), 'utf8')
    // UNC/WSL 会话在 win32 下是 `//…` 形态，必须转成 \\{\\}… 再调 fs：
    // 删链路的存在性判断与真正删除都走转换后路径，这里必须一致，否则备份静默失败。
    copyFileSync(sessionFilePathForFs(sessionFile), payloadPath(id))
    if (!existsSync(payloadPath(id))) throw new Error('trash_payload_missing')
    return id
  } catch {
    removeEntryFiles(id)
    return null
  }
}

export function dropSessionUndo(trashId: string): void {
  removeEntryFiles(trashId)
}

/**
 * 还原。目标路径已经有文件时不再静默覆盖（那会把删除后新产生的消息顶掉），
 * 改成另存为 `<name>.restored-<ts>.jsonl`。
 */
export function restoreSessionFromUndo(trashId: string): { sessionFile: string; workspaceId: string } | null {
  try {
    const meta = readSidecar(trashId)
    if (!meta?.sessionFile) return null
    const deletedAt = Number(meta.deletedAt ?? meta.at ?? 0)
    if (deletedAt && Date.now() - deletedAt > SESSION_TRASH_TTL_MS) {
      removeEntryFiles(trashId)
      return null
    }
    if (!existsSync(payloadPath(trashId))) return null
    let target = meta.sessionFile
    // 目标存在性判断与写盘都走转换后路径（UNC 会话），否则还原可能判错或写错地方。
    if (existsSync(sessionFilePathForFs(target))) {
      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
      target = target.replace(/\.jsonl$/i, '') + `.restored-${stamp}.jsonl`
    }
    mkdirSync(dirname(sessionFilePathForFs(target)), { recursive: true })
    copyFileSync(payloadPath(trashId), sessionFilePathForFs(target))
    removeEntryFiles(trashId)
    return { sessionFile: target, workspaceId: String(meta.workspaceId || dirname(meta.sessionFile)) }
  } catch {
    return null
  }
}

/** 回收站列表，新的在前。读之前先清过期条目与半截图。 */
export function listSessionTrash(workspaceId?: string): SessionTrashEntry[] {
  purgeExpiredSessionTrash()
  const entries: SessionTrashEntry[] = []
  for (const id of entryIds()) {
    const meta = readSidecar(id)
    if (!meta?.sessionFile || !existsSync(payloadPath(id))) continue
    const entry = toEntry(id, meta)
    if (workspaceId && entry.workspaceId && entry.workspaceId !== workspaceId) continue
    entries.push(entry)
  }
  return entries.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** 测试/诊断用：条目在磁盘上的字节数。 */
export function trashEntryBytes(id: string): number {
  try {
    return statSync(payloadPath(id)).size
  } catch {
    return 0
  }
}
