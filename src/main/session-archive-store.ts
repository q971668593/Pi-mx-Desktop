import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeSessionKey } from './worker-session-key'
import { sessionFilePathForFs } from './session-file-meta'
import { workspacePathsEqual } from '@shared/workspace-path'

/**
 * 对话归档。
 *
 * 归档不是删除：会话 .jsonl 原样留在磁盘上，只在用户目录的 session-archive.json 里记一条
 * 「这条属于哪个项目」。侧栏列表（ipc:session.list）会跳过归档过的会话，
 * 项目右键的「查看归档对话」把它们列出来，可以随时还原或在归档里再删除。
 */
export type SessionArchiveEntry = {
  id: string
  sessionFile: string
  workspaceId: string
  title: string
  archivedAt: number
}

type ArchiveFile = { entries: SessionArchiveEntry[] }

function archiveFilePath(): string {
  try {
    return join(app.getPath('userData'), 'session-archive.json')
  } catch {
    return join(tmpdir(), 'pi-desktop-session-archive.json')
  }
}

let cache: SessionArchiveEntry[] | null = null
/** 缓存对应的磁盘 mtime：文件被外部改动（另一个实例 / 手工编辑）时能自愈。 */
let cacheMtimeMs = -1

function currentMtimeMs(): number {
  try {
    return statSync(archiveFilePath()).mtimeMs
  } catch {
    return -1
  }
}

/**
 * 读档案。解析失败时保留上一次的缓存（哪怕为空），绝不把半截文件当成「空档案」——
 * 否则下一次写入会把用户全部归档记录覆盖掉。
 * 冷启动（无缓存）又撞上半截文件时：先备份现场再返回空，避免备份都没有就覆盖。
 */
let corrupted = false
function read(): SessionArchiveEntry[] {
  const mtime = currentMtimeMs()
  if (cache && mtime === cacheMtimeMs) return cache
  if (mtime === -1) {
    // 文件还不存在：确实是空的。
    cache = []
    cacheMtimeMs = -1
    corrupted = false
    return cache
  }
  try {
    const parsed = JSON.parse(readFileSync(archiveFilePath(), 'utf8')) as ArchiveFile
    const rows = Array.isArray(parsed?.entries) ? parsed.entries.filter((row) => !!row?.sessionFile) : []
    cache = rows
    cacheMtimeMs = mtime
    corrupted = false
    return rows
  } catch {
    // 半截 / 脏数据：保持旧缓存，让写入有机会覆盖成完整内容，而不是把记录当空丢掉。
    // 冷启动没有旧缓存时先备份半截文件（取证用），调用方通过 isArchiveCorrupted() 可知档案不可信。
    if (!cache) backupArchiveFile(`corrupt-${Date.now()}.bak`)
    corrupted = true
    return cache ?? []
  }
}

/** 档案损坏时写路径必须先备份再覆盖，避免静默丢失可取证的现场。 */
export function isArchiveCorrupted(): boolean {
  return corrupted
}

/** 原子写：先写 .tmp 再 rename，避免进程被杀时留下半截 JSON。 */
function write(entries: SessionArchiveEntry[]): boolean {
  const file = archiveFilePath()
  const tmp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, JSON.stringify({ entries }, null, 2), 'utf8')
    renameSync(tmp, file)
    cache = entries
    cacheMtimeMs = currentMtimeMs()
    return true
  } catch {
    return false
  }
}

export function listSessionArchive(workspaceId?: string): SessionArchiveEntry[] {
  const rows = read()
  // 只在展示时过滤幽灵条目，不回写：existsSync 瞬时 false 可能是 WSL 未启动/网络盘抖动，
  // 直接回写会把还在的会话记录永久删除。真正的文件删除走 delete/unarchive 时清理。
  const live = rows.filter((row) => existsSync(sessionFilePathForFs(row.sessionFile)))
  const filtered = workspaceId
    ? live.filter((row) => !row.workspaceId || workspacePathsEqual(row.workspaceId, workspaceId))
    : live
  return [...filtered].sort((a, b) => b.archivedAt - a.archivedAt)
}

/** 文件确认没了（删除/还原时）才清理归档记录，不在列表展示时顺手删。 */
export function dropArchiveEntriesForMissingFile(sessionFile: string): boolean {
  if (!sessionFile || existsSync(sessionFilePathForFs(sessionFile))) return false
  const key = normalizeSessionKey(sessionFile)
  if (!key) return false
  const rows = read()
  const next = rows.filter((row) => normalizeSessionKey(row.sessionFile) !== key)
  if (next.length === rows.length) return false
  write(next)
  return true
}

/** 归档时用的 key 集合：侧栏列表按它过滤。 */
export function archivedSessionKeys(): Set<string> {
  const keys = new Set<string>()
  for (const row of read()) {
    const key = normalizeSessionKey(row.sessionFile)
    if (key) keys.add(key)
  }
  return keys
}

export function archiveSession(input: {
  sessionFile: string
  workspaceId?: string
  title?: string
}): SessionArchiveEntry | null {
  const file = String(input.sessionFile || '').trim()
  if (!file) return null
  const key = normalizeSessionKey(file)
  const rows = read().filter((row) => normalizeSessionKey(row.sessionFile) !== key)
  const entry: SessionArchiveEntry = {
    id: randomUUID(),
    sessionFile: file,
    workspaceId: String(input.workspaceId || dirname(file)),
    title: String(input.title || ''),
    archivedAt: Date.now(),
  }
  if (!write([...rows, entry])) return null
  return entry
}

export function unarchiveSession(id: string): SessionArchiveEntry | null {
  if (!id) return null
  const rows = read()
  const entry = rows.find((row) => row.id === id)
  if (!entry) {
    // 也允许按 sessionFile 还原（侧栏右键直接还原时更省事）。
    const byFile = rows.find((row) => normalizeSessionKey(row.sessionFile) === normalizeSessionKey(id))
    if (!byFile) return null
    write(rows.filter((row) => row.id !== byFile.id))
    return byFile
  }
  write(rows.filter((row) => row.id !== id))
  return entry
}

export function unarchiveSessionFile(sessionFile: string): boolean {
  const key = normalizeSessionKey(sessionFile)
  if (!key) return false
  const rows = read()
  const next = rows.filter((row) => normalizeSessionKey(row.sessionFile) !== key)
  if (next.length === rows.length) return false
  write(next)
  return true
}

export function removeArchiveEntryByFile(sessionFile: string): void {
  unarchiveSessionFile(sessionFile)
}

/** 只删记录、不动磁盘文件（文件已经丢失时用它清幽灵）。 */
export function removeArchiveEntryById(id: string): boolean {
  if (!id) return false
  const rows = read()
  const next = rows.filter((row) => row.id !== id)
  if (next.length === rows.length) return false
  write(next)
  return true
}

export function isSessionArchived(sessionFile: string): boolean {
  const key = normalizeSessionKey(sessionFile)
  if (!key) return false
  return read().some((row) => normalizeSessionKey(row.sessionFile) === key)
}

export function clearSessionArchiveCacheForTests(): void {
  cache = null
  cacheMtimeMs = -1
  corrupted = false
}

export function archiveFileExists(): boolean {
  return existsSync(archiveFilePath())
}

/** 测试/诊断用：备份一份当前档案（损坏时的兜底）。 */
export function backupArchiveFile(suffix = 'bak'): string | null {
  const file = archiveFilePath()
  if (!existsSync(file)) return null
  const target = `${file}.${suffix}`
  try {
    copyFileSync(file, target)
    return target
  } catch {
    return null
  }
}
