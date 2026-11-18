import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { MAX_TURN_FILE_BYTES, MAX_TURN_SNAPSHOT_FILES, type TurnSnapshot } from '@shared/turn-file-snapshot'
import { normalizeSessionKey } from './worker-session-key'
import { resolvePathUnderWorkspace, workspaceFsReadText, workspaceFsWriteText } from './workspace-fs'

const MAX_SNAPSHOTS = 24
const fileSchema = z.object({
  path: z.string().min(1).max(2048).refine((path) =>
    !path.includes('\\') && !path.includes(':') && path.split('/').every((part) =>
      part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git',
    )),
  before: z.string().max(MAX_TURN_FILE_BYTES).nullable(),
  after: z.string().max(MAX_TURN_FILE_BYTES),
})
const storedRunSchema = z.object({
  runId: z.string().min(1).max(200),
  files: z.array(fileSchema).max(MAX_TURN_SNAPSHOT_FILES),
  excluded: z.array(z.string()).max(MAX_TURN_SNAPSHOT_FILES),
})
type StoredRun = TurnSnapshot & { excluded: string[] }
let pending: Promise<void> = Promise.resolve()

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const root = () => join(app.getPath('userData'), 'turn-snapshots')
const sessionPrefix = (sessionFile: string) => hash(normalizeSessionKey(sessionFile)) + '-'
const snapshotName = (sessionFile: string, runId: string) => sessionPrefix(sessionFile) + hash(runId) + '.json'

async function parseSnapshot(name: string): Promise<StoredRun | null> {
  try {
    return storedRunSchema.parse(JSON.parse(await readFile(join(root(), name), 'utf8')))
  } catch {
    return null
  }
}

async function recentNames(): Promise<string[]> {
  const names = await readdir(root()).catch(() => [])
  const entries = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map(async (name) => ({ name, time: (await stat(join(root(), name)).catch(() => null))?.mtimeMs ?? 0 })))
  return entries.sort((a, b) => b.time - a.time).map(({ name }) => name)
}

export function recordTurnFileSnapshot(sessionFile: string, runId: unknown, value: unknown): void {
  if (typeof runId !== 'string' || !runId || runId.length > 200) return
  const result = fileSchema.safeParse(value)
  if (!result.success) return
  const file = result.data
  if (Buffer.byteLength(file.before ?? '') > MAX_TURN_FILE_BYTES || Buffer.byteLength(file.after) > MAX_TURN_FILE_BYTES) return
  const name = snapshotName(sessionFile, runId)
  pending = pending.then(async () => {
    await mkdir(root(), { recursive: true })
    const current = await parseSnapshot(name)
    const run: StoredRun = current ?? { runId, files: [], excluded: [] }
    if (run.excluded.includes(file.path)) return
    const index = run.files.findIndex((entry) => entry.path === file.path)
    if (index >= 0) {
      const previous = run.files[index]
      if (previous.after !== file.before) {
        // A different writer intervened between this run's edits.
        run.excluded.push(file.path)
        run.files.splice(index, 1)
      } else {
        run.files[index] = { ...previous, after: file.after }
      }
    } else if (run.files.length + run.excluded.length < MAX_TURN_SNAPSHOT_FILES) {
      run.files.push(file)
    } else {
      return
    }
    const path = join(root(), name)
    const temp = path + '.tmp'
    try {
      await writeFile(temp, JSON.stringify(run), { encoding: 'utf8', mode: 0o600 })
      await rename(temp, path)
    } finally {
      await rm(temp, { force: true }).catch(() => {})
    }
    if (!current) {
      const stale = (await recentNames()).slice(MAX_SNAPSHOTS)
      await Promise.all(stale.map((row) => rm(join(root(), row), { force: true }).catch(() => {})))
    }
  }).catch((error) => console.warn('[TurnSnapshot] capture failed:', error))
}

export async function readTurnSnapshot(sessionFile: string, runId: string): Promise<StoredRun | null> {
  await pending
  const run = await parseSnapshot(snapshotName(sessionFile, runId))
  return run ? { ...run, files: run.files.filter((file) => file.before !== file.after) } : null
}

export async function restoreTurnSnapshotFile(
  workspaceRoot: string,
  sessionFile: string,
  runId: string,
  path: string,
  isRunning: () => boolean,
): Promise<{ ok: boolean; error?: string }> {
  const run = await readTurnSnapshot(sessionFile, runId)
  const file = run?.files.find((entry) => entry.path === path)
  if (!file) return { ok: false, error: 'not_found' }
  const expectedRevision = hash(file.after)
  const req = { workspaceRoot, path }
  const current = await workspaceFsReadText({ ...req, maxBytes: MAX_TURN_FILE_BYTES })
  if (!current.ok || current.revision !== expectedRevision) return { ok: false, error: 'conflict' }
  if (isRunning()) return { ok: false, error: 'busy' }
  if (file.before !== null) {
    return workspaceFsWriteText({ ...req, content: file.before, expectedRevision })
  }
  const target = await resolvePathUnderWorkspace(workspaceRoot, path)
  if (!target.ok) return target
  const latest = await workspaceFsReadText({ ...req, maxBytes: MAX_TURN_FILE_BYTES })
  if (!latest.ok || latest.revision !== expectedRevision) return { ok: false, error: 'conflict' }
  if (isRunning()) return { ok: false, error: 'busy' }
  try {
    await shell.trashItem(target.abs)
    return { ok: true }
  } catch {
    return { ok: false, error: 'write_failed' }
  }
}
