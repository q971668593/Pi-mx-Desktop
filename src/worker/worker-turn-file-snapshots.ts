import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { MAX_TURN_FILE_BYTES, MAX_TURN_SNAPSHOT_FILES, type TurnFileSnapshot } from '@shared/turn-file-snapshot'

type PendingFile = { root: string; absolute: string; relative: string; before: string | null; invalid?: boolean }
const pending = new Map<string, PendingFile>()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

// Resolve the deepest existing ancestor so a write may legitimately create a new directory.
function resolveLivePath(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    const parent = dirname(path)
    if (!isMissing(error) || parent === path) throw error
    return resolve(resolveLivePath(parent), relative(parent, path))
  }
}

function readText(path: string): string | null {
  let fd: number
  try {
    const meta = statSync(path)
    if (!meta.isFile() || meta.size > MAX_TURN_FILE_BYTES) throw new Error('Unsupported snapshot file')
    fd = openSync(path, 'r')
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_TURN_FILE_BYTES) throw new Error('Unsupported snapshot file')
    const bytes = Buffer.alloc(stat.size)
    if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length || fstatSync(fd).size !== stat.size || bytes.includes(0)) {
      throw new Error('Unstable or binary snapshot file')
    }
    return decoder.decode(bytes)
  } finally {
    closeSync(fd)
  }
}

export function beginTurnFileSnapshot(toolCallId: string, cwd: string, args: unknown): void {
  const path = (args as { path?: unknown } | null)?.path
  if (typeof path !== 'string' || !path || pending.size >= MAX_TURN_SNAPSHOT_FILES) return
  try {
    const root = realpathSync(cwd)
    const absolute = resolveLivePath(resolve(root, path))
    const rel = relative(root, absolute).split('\\').join('/')
    if (!rel || rel.startsWith('../') || rel === '..' || isAbsolute(rel) || rel.split('/').includes('.git')) return
    const overlapping = [...pending.values()].filter((file) => file.absolute === absolute)
    if (overlapping.length) {
      for (const file of overlapping) file.invalid = true
      return
    }
    pending.set(toolCallId, { root, absolute, relative: rel, before: readText(absolute) })
  } catch {
    // Capturing a file is best effort. The tool keeps its own error and result.
  }
}

export function finishTurnFileSnapshot(toolCallId: string, failed: boolean): TurnFileSnapshot | undefined {
  const item = pending.get(toolCallId)
  pending.delete(toolCallId)
  if (!item || item.invalid || failed) return undefined
  try {
    const live = resolveLivePath(resolve(item.root, item.relative))
    if (live !== item.absolute) return undefined
    const after = readText(live)
    if (after === null || after === item.before) return undefined
    return { path: item.relative, before: item.before, after }
  } catch {
    return undefined
  }
}

export function resetTurnFileSnapshots(): void {
  pending.clear()
}
