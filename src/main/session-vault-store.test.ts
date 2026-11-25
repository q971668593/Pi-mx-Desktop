import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 会话归档 / 回收站 / 教训档案的落盘行为。
 *
 * 这三处都是「用户看不见的保险箱」：坏掉的写盘逻辑不会立刻报错，
 * 只会在某天用户发现对话没了、或者回收站莫名空了的时候才暴露。
 * 所以这里把关键不变量钉成测试：不静默覆盖、不把半截文件当空档案、失败要回滚。
 */
const dirs = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? dirs.userData : dirs.userData) },
}))

import {
  archivedSessionKeys,
  archiveSession,
  clearSessionArchiveCacheForTests,
  listSessionArchive,
  unarchiveSession,
} from './session-archive-store'
import {
  listSessionTrash,
  purgeExpiredSessionTrash,
  restoreSessionFromUndo,
  SESSION_TRASH_TTL_MS,
  stashSessionForUndo,
  trashEntryBytes,
} from './session-trash-store'
import {
  addLesson,
  clearFeedbackCacheForTests,
  listFeedback,
  pendingLessonCount,
  setLessonStatus,
} from './feedback-lessons-store'

beforeEach(async () => {
  dirs.userData = await mkdtemp(join(tmpdir(), 'pi-vault-'))
  clearSessionArchiveCacheForTests()
  clearFeedbackCacheForTests()
})

afterEach(async () => {
  await rm(dirs.userData, { recursive: true, force: true })
})

describe('session archive store', () => {
  it('hides an archived session from the sidebar key set', async () => {
    const file = join(dirs.userData, 'proj', 'a.jsonl')
    await mkdir(join(dirs.userData, 'proj'), { recursive: true })
    await writeFile(file, '{"type":"session"}\n')
    archiveSession({ sessionFile: file, workspaceId: join(dirs.userData, 'proj'), title: '旧对话' })

    expect([...archivedSessionKeys()]).toHaveLength(1)
    expect(listSessionArchive()).toMatchObject([{ title: '旧对话' }])
    expect(unarchiveSession(listSessionArchive()[0]!.id)).toMatchObject({ sessionFile: file })
    expect(archivedSessionKeys().size).toBe(0)
  })

  it('keeps working when the archive file on disk is truncated', async () => {
    const file = join(dirs.userData, 'proj', 'a.jsonl')
    await mkdir(join(dirs.userData, 'proj'), { recursive: true })
    await writeFile(file, '{}\n')
    archiveSession({ sessionFile: file, workspaceId: join(dirs.userData, 'proj'), title: '保留我' })

    // 模拟进程被杀留下的半截 JSON：解析失败时不能把档案当成空的再覆盖掉。
    await writeFile(join(dirs.userData, 'session-archive.json'), '{"entries":[{"id":"x"', 'utf8')
    clearSessionArchiveCacheForTests()
    expect(() => listSessionArchive()).not.toThrow()
    const raw = await readFile(join(dirs.userData, 'session-archive.json'), 'utf8').catch(() => '')
    expect(raw.startsWith('{"entries":[{"id":"x"')).toBe(true)
  })

  it('hides entries whose session file is temporarily unreachable, without deleting the record', async () => {
    const file = join(dirs.userData, 'proj', 'gone.jsonl')
    await mkdir(join(dirs.userData, 'proj'), { recursive: true })
    await writeFile(file, '{}\n')
    archiveSession({ sessionFile: file, workspaceId: join(dirs.userData, 'proj'), title: '幽灵' })
    await rm(file)
    // WSL 未启动/网络盘抖动时 existsSync 瞬时 false：展示过滤即可，记录必须留着。
    expect(listSessionArchive()).toEqual([])
    expect(archivedSessionKeys().size).toBe(1)
    // 文件确认没了才显式清理记录。
    const { dropArchiveEntriesForMissingFile } = await import('./session-archive-store')
    expect(dropArchiveEntriesForMissingFile(file)).toBe(true)
    expect(archivedSessionKeys().size).toBe(0)
  })
})

describe('session trash store', () => {
  it('stores a copy and restores it to the original path', async () => {
    const file = join(dirs.userData, 'proj', 'a.jsonl')
    await mkdir(join(dirs.userData, 'proj'), { recursive: true })
    await writeFile(file, '{"content":"keep me"}\n')
    const id = stashSessionForUndo(file, { workspaceId: join(dirs.userData, 'proj'), title: '删掉的对话' })
    expect(id).toBeTruthy()
    expect(trashEntryBytes(id!)).toBeGreaterThan(0)
    await rm(file)

    const restored = restoreSessionFromUndo(id!)
    expect(restored).toMatchObject({ sessionFile: file })
    expect(await readFile(file, 'utf8')).toContain('keep me')
    expect(listSessionTrash()).toEqual([])
  })

  it('does not overwrite a newer file when the target path is occupied', async () => {
    const file = join(dirs.userData, 'proj', 'a.jsonl')
    await mkdir(join(dirs.userData, 'proj'), { recursive: true })
    await writeFile(file, '{"old":true}\n')
    const id = stashSessionForUndo(file, { workspaceId: join(dirs.userData, 'proj') })!
    await writeFile(file, '{"new":true}\n')

    const restored = restoreSessionFromUndo(id)!
    // 目标已有新内容：另存为，绝不覆盖删除后继续对话产生的新消息。
    expect(restored.sessionFile).not.toBe(file)
    expect(await readFile(file, 'utf8')).toContain('"new":true')
    expect(await readFile(restored.sessionFile, 'utf8')).toContain('"old":true')
  })

  it('purges expired entries and orphan payloads', async () => {
    const file = join(dirs.userData, 'proj', 'a.jsonl')
    await mkdir(join(dirs.userData, 'proj'), { recursive: true })
    await writeFile(file, '{}\n')
    const id = stashSessionForUndo(file, { workspaceId: join(dirs.userData, 'proj') })!
    // 把删除时间改成 6 天前
    const sidecar = join(dirs.userData, 'session-trash', `${id}.json`)
    const meta = JSON.parse(await readFile(sidecar, 'utf8')) as Record<string, unknown>
    meta.deletedAt = Date.now() - SESSION_TRASH_TTL_MS - 1000
    await writeFile(sidecar, JSON.stringify(meta))
    // 再伪造一个只有 payload 没有侧车的孤儿
    await writeFile(join(dirs.userData, 'session-trash', 'orphan.jsonl'), '{}')

    expect(purgeExpiredSessionTrash()).toBeGreaterThanOrEqual(2)
    expect(existsSync(sidecar)).toBe(false)
    expect(existsSync(join(dirs.userData, 'session-trash', 'orphan.jsonl'))).toBe(false)
  })
})

describe('feedback lesson store', () => {
  it('keeps manual lessons out of the model verdict path and upgrades duplicates', async () => {
    const auto = addLesson({ text: '你把测试跳过了', source: 'auto' })!
    setLessonStatus(auto.id, 'dropped')
    const manual = addLesson({ text: '你把测试跳过了', source: 'manual' })!
    expect(manual.id).toBe(auto.id)
    expect(manual.status).toBe('kept')
    expect(manual.source).toBe('manual')
    expect(pendingLessonCount()).toMatchObject({ kept: 1, pending: 0 })
  })

  it('trims the oldest dropped lessons before touching kept ones', async () => {
    const kept = addLesson({ text: '改完先跑类型检查再汇报', source: 'manual' })!
    for (let i = 0; i < 420; i += 1) {
      const row = addLesson({ text: `噪声${i}-${Math.random()}`, source: 'auto' })
      if (row) setLessonStatus(row.id, 'dropped')
    }
    const { lessons } = listFeedback()
    expect(lessons.length).toBeLessThanOrEqual(400)
    expect(lessons.some((row) => row.id === kept.id)).toBe(true)
  })

  it('survives a truncated store file without wiping it', async () => {
    addLesson({ text: '先认清现状再动手', source: 'manual' })
    const file = join(dirs.userData, 'feedback-lessons.json')
    await writeFile(file, '{"lessons":[{"id":"half"', 'utf8')
    clearFeedbackCacheForTests()
    expect(() => listFeedback()).not.toThrow()
    expect((await stat(file)).size).toBeGreaterThan(0)
    expect(await readFile(file, 'utf8')).toContain('{"lessons":[{"id":"half"')
  })

  it('clears the stale verdict when a manual report upgrades an auto duplicate', async () => {
    const { applyLessonVerdict } = await import('./feedback-lessons-store')
    const auto = addLesson({ text: '升级清结论', source: 'auto' })!
    applyLessonVerdict(auto.id, {
      worth: false, polarity: 'negative', category: '其他',
      reason: '旧结论', rule: '', judgedAt: Date.now(), error: 'busy',
    })
    const manual = addLesson({ text: '升级清结论', source: 'manual' })!
    expect(manual.status).toBe('kept')
    expect(manual.verdict).toBeUndefined()
  })

  it('cleans dangling rule references when kept lessons are pruned', async () => {
    const { addLessonRule, listFeedback } = await import('./feedback-lessons-store')
    const first = addLesson({ text: '最早的确认条目', source: 'manual' })!
    const rule = addLessonRule({ title: '规则', body: '做事', polarity: 'negative', fromLessonIds: [first.id] })
    expect(rule.fromLessonIds).toContain(first.id)
    for (let i = 0; i < 420; i += 1) {
      const row = addLesson({ text: `挤占${i}-${Math.random()}`, source: 'manual' })
      if (!row) break
    }
    const { lessons, rules } = listFeedback()
    expect(lessons.length).toBeLessThanOrEqual(400)
    const alive = new Set(lessons.map((row) => row.id))
    for (const r of rules) {
      for (const id of r.fromLessonIds) expect(alive.has(id)).toBe(true)
    }
  })
})
