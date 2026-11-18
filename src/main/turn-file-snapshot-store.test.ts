import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginTurnFileSnapshot, finishTurnFileSnapshot } from '../worker/worker-turn-file-snapshots'

const config = vi.hoisted(() => ({ directory: '', trash: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => config.directory },
  shell: { trashItem: config.trash },
}))

const { readTurnSnapshot, recordTurnFileSnapshot, restoreTurnSnapshotFile } = await import('./turn-file-snapshot-store')

describe('turn file snapshots', () => {
  beforeEach(async () => {
    config.directory = await mkdtemp(join(tmpdir(), 'pi-turn-snapshot-'))
    config.trash.mockReset()
    config.trash.mockImplementation((path: string) => rm(path))
  })
  afterEach(() => rm(config.directory, { recursive: true, force: true }))

  it('keeps original bytes across consecutive tool edits and restores only the reviewed version', async () => {
    const root = config.directory
    const file = join(root, 'note.txt')
    const session = join(root, 'session.jsonl')
    await writeFile(file, 'original\r\n')
    for (const next of ['first edit', 'second edit']) {
      beginTurnFileSnapshot(next, root, { path: 'note.txt' })
      await writeFile(file, next)
      recordTurnFileSnapshot(session, 'run-a', finishTurnFileSnapshot(next, false))
    }
    expect(await readTurnSnapshot(session, 'run-a')).toMatchObject({
      runId: 'run-a', files: [{ path: 'note.txt', before: 'original\r\n', after: 'second edit' }],
    })
    await expect(readTurnSnapshot(session, 'run-without-edits')).resolves.toBeNull()
    await writeFile(file, 'an external edit')
    const restore = () => restoreTurnSnapshotFile(root, session, 'run-a', 'note.txt', () => false)
    await expect(restore()).resolves.toEqual({ ok: false, error: 'conflict' })
    await expect(readFile(file, 'utf8')).resolves.toBe('an external edit')
    await writeFile(file, 'second edit')
    await expect(restore()).resolves.toEqual({ ok: true })
    await expect(readFile(file, 'utf8')).resolves.toBe('original\r\n')
  })

  it('excludes edits that cross another writer and does not trash an unrelated file', async () => {
    const root = config.directory
    const session = join(root, 'session.jsonl')
    recordTurnFileSnapshot(session, 'overlap', { path: 'note.txt', before: 'a', after: 'b' })
    recordTurnFileSnapshot(session, 'overlap', { path: 'note.txt', before: 'c', after: 'd' })
    expect((await readTurnSnapshot(session, 'overlap'))?.files).toEqual([])

    beginTurnFileSnapshot('addition', root, { path: 'new.txt' })
    await writeFile(join(root, 'new.txt'), 'new file')
    recordTurnFileSnapshot(session, 'addition', finishTurnFileSnapshot('addition', false))
    await expect(restoreTurnSnapshotFile(root, session, 'addition', 'new.txt', () => true))
      .resolves.toEqual({ ok: false, error: 'busy' })
    expect(config.trash).not.toHaveBeenCalled()
    await expect(restoreTurnSnapshotFile(root, session, 'addition', 'new.txt', () => false))
      .resolves.toEqual({ ok: true })
    expect(config.trash).toHaveBeenCalledTimes(1)
  })
})
