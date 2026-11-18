import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionGoalStore } from './session-goals'

let dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mx-goals-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('SessionGoalStore', () => {
  it('round-trips a goal with criteria across instances', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    const saved = store.set({
      sessionFile: 'C:/w/a.jsonl',
      goal: '首页 banner 抽成组件',
      criteria: ['背景图已生成', '高度 700px'],
      now: 1000,
    })
    expect(saved).toMatchObject({ goal: '首页 banner 抽成组件', createdAt: 1000 })
    expect(saved?.criteria).toEqual([
      { text: '背景图已生成', done: false },
      { text: '高度 700px', done: false },
    ])

    const reopened = new SessionGoalStore(dir)
    expect(reopened.get('C:/w/a.jsonl')?.goal).toBe('首页 banner 抽成组件')
    expect(reopened.remaining('C:/w/a.jsonl')).toBe(2)
  })

  it('preserves done flags and createdAt when the goal is edited', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    store.set({ sessionFile: 'a', goal: 'g1', criteria: ['x', 'y'], now: 100 })
    store.toggleCriterion('a', 0, 200)
    const edited = store.set({ sessionFile: 'a', goal: 'g1', criteria: ['x', 'y'], now: 300 })
    expect(edited?.createdAt).toBe(100)
    expect(edited?.updatedAt).toBe(300)
    expect(edited?.criteria).toEqual([
      { text: 'x', done: true },
      { text: 'y', done: false },
    ])
    expect(store.remaining('a')).toBe(1)
  })

  it('toggles a criterion and reports completion at zero remaining', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    store.set({ sessionFile: 'a', goal: 'g', criteria: ['only'] })
    expect(store.remaining('a')).toBe(1)
    store.toggleCriterion('a', 0)
    expect(store.remaining('a')).toBe(0)
    store.toggleCriterion('a', 0)
    expect(store.remaining('a')).toBe(1)
  })

  it('ignores empty input and unknown sessions', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    expect(store.set({ sessionFile: 'a', goal: '   ' })).toBeNull()
    expect(store.set({ sessionFile: null, goal: 'g' })).toBeNull()
    expect(store.get('missing')).toBeNull()
    expect(store.remaining('missing')).toBe(0)
    expect(store.toggleCriterion('missing', 0)).toBeNull()
    expect(store.clear('missing')).toBe(false)
  })

  it('recovers from a corrupted file instead of throwing', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'session-goals.json'), '{ not json', 'utf8')
    const store = new SessionGoalStore(dir)
    expect(store.get('a')).toBeNull()
    expect(store.set({ sessionFile: 'a', goal: 'g' })?.goal).toBe('g')
  })

  it('clears a goal and persists the removal', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    store.set({ sessionFile: 'a', goal: 'g', criteria: ['x'] })
    expect(store.clear('a')).toBe(true)
    expect(new SessionGoalStore(dir).get('a')).toBeNull()
  })

  it('marks reported criteria done (1-based) and reports the change', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    store.set({ sessionFile: 'a', goal: 'g', criteria: ['x', 'y', 'z'], now: 100 })
    const next = store.markCriteriaDone('a', [1, 3], 200)
    expect(next?.criteria).toEqual([
      { text: 'x', done: true },
      { text: 'y', done: false },
      { text: 'z', done: true },
    ])
    expect(next?.updatedAt).toBe(200)
    expect(store.remaining('a')).toBe(1)
    // Same report again: no change, so no new updatedAt (no needless prompt-section churn).
    const same = store.markCriteriaDone('a', [1, 3], 300)
    expect(same?.updatedAt).toBe(200)
    // Out-of-range / non-integer indices are ignored, never throwing.
    expect(store.markCriteriaDone('a', [0, 9, 1.5], 400)?.updatedAt).toBe(200)
    expect(store.markCriteriaDone('missing', [1])).toBeNull()
  })

  it('exposes the same prompt section the worker injects', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    expect(store.promptSection('a')).toBeNull()
    store.set({ sessionFile: 'a', goal: 'banner 抽组件', criteria: ['背景图'] })
    const section = store.promptSection('a')
    expect(section).toContain('banner 抽组件')
    expect(section).toContain('[未达成] 背景图')
  })

  it('resolves the same session for native and normalized spellings of its path', () => {
    // 回归：写入用的键（渲染层归一化）与 prompt.send 带的原生路径曾经不是同一个字符串，
    // promptSection() 返回 null → worker 的 goal 段被当成「已清掉」而撑下。
    const store = new SessionGoalStore(tempDir())
    const saved = store.set({ sessionFile: 'C:\\w\\b\\a.jsonl', goal: 'banner 抽组件', criteria: ['背景图'] })
    expect(saved?.sessionFile).toBe('C:/w/b/a.jsonl')

    for (const spelling of ['C:\\w\\b\\a.jsonl', 'C:/w/b/a.jsonl', 'c:/w/b/a.jsonl']) {
      expect(store.get(spelling)?.goal).toBe('banner 抽组件')
      expect(store.promptSection(spelling)).toContain('banner 抽组件')
      expect(store.remaining(spelling)).toBe(1)
    }
    // 写入也走同一个键：不会因为拼写差异多出一份
    store.toggleCriterion('C:\\w\\b\\a.jsonl', 0)
    expect(store.remaining('C:/w/b/a.jsonl')).toBe(0)
  })

  it('migrates keys persisted by the pre-normalization build', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'session-goals.json'),
      JSON.stringify({
        version: 1,
        goals: {
          'C:\\old\\path.jsonl': {
            sessionFile: 'C:\\old\\path.jsonl',
            goal: '旧目标',
            criteria: [{ text: 'x', done: false }],
            createdAt: 1,
            updatedAt: 2,
          },
        },
      }),
      'utf8',
    )

    const store = new SessionGoalStore(dir)
    expect(store.get('C:/old/path.jsonl')?.goal).toBe('旧目标')
    // 一次写入就把存量键换掉，不再留两份
    store.toggleCriterion('C:/old/path.jsonl', 0, 10)
    const raw = JSON.parse(readFileSync(join(dir, 'session-goals.json'), 'utf8')) as {
      goals: Record<string, { sessionFile: string }>
    }
    expect(Object.keys(raw.goals)).toEqual(['C:/old/path.jsonl'])
    expect(raw.goals['C:/old/path.jsonl'].sessionFile).toBe('C:/old/path.jsonl')
  })

  it('writes atomically so a half-written file never lands', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    store.set({ sessionFile: 'a', goal: 'g' })
    const raw = readFileSync(join(dir, 'session-goals.json'), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(raw).toContain('"version": 1')
  })
})
