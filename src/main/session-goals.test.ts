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

  it('writes atomically so a half-written file never lands', () => {
    const dir = tempDir()
    const store = new SessionGoalStore(dir)
    store.set({ sessionFile: 'a', goal: 'g' })
    const raw = readFileSync(join(dir, 'session-goals.json'), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(raw).toContain('"version": 1')
  })
})
