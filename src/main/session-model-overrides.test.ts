import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionModelOverrides } from './session-model-overrides'

const dirs: string[] = []
function ledger(options: { now?: () => number; maxEntries?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-model-overrides-'))
  dirs.push(dir)
  return createSessionModelOverrides({ filePath: join(dir, 'session-model-overrides.json'), ...options })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const A = 'C:\\sessions\\a.jsonl'
const B = 'C:\\sessions\\b.jsonl'

describe('session model overrides', () => {
  it('stores the model a session should adopt and reads it back', () => {
    const store = ledger({ now: () => 1000 })
    expect(store.get(A)).toBeNull()
    expect(store.set(A, 'magpie', 'deepseek')).toEqual({ sessionFile: A, provider: 'magpie', modelId: 'deepseek', requestedAt: 1000 })
    expect(store.get(A)).toMatchObject({ provider: 'magpie', modelId: 'deepseek' })
    expect(store.get(B)).toBeNull()
  })

  it('keeps one row per session, newest request wins', () => {
    let clock = 1
    const store = ledger({ now: () => clock++ })
    store.set(A, 'magpie', 'one')
    store.set(A, 'magpie', 'two')
    expect(store.list()).toHaveLength(1)
    expect(store.get(A)?.modelId).toBe('two')
  })

  it('clears only the confirmed session', () => {
    const store = ledger()
    store.set(A, 'p', 'm')
    store.set(B, 'p', 'm')
    store.clear(A)
    expect(store.get(A)).toBeNull()
    expect(store.get(B)?.modelId).toBe('m')
  })

  it('caps the file by dropping the oldest requests', () => {
    let clock = 1
    const store = ledger({ now: () => clock++, maxEntries: 2 })
    store.set(A, 'p', 'm')
    store.set(B, 'p', 'm')
    store.set('C:\\sessions\\c.jsonl', 'p', 'm')
    expect(store.list().map((row) => row.sessionFile)).toEqual(['C:\\sessions\\c.jsonl', B])
  })

  it('survives a corrupt file instead of blocking the switch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-model-overrides-bad-'))
    dirs.push(dir)
    const filePath = join(dir, 'session-model-overrides.json')
    writeFileSync(filePath, '{ not json')
    const store = createSessionModelOverrides({ filePath })
    expect(store.get(A)).toBeNull()
    store.set(A, 'p', 'm')
    expect(JSON.parse(readFileSync(filePath, 'utf8')).overrides).toHaveLength(1)
  })

  it('drops rows written by a different schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-model-overrides-old-'))
    dirs.push(dir)
    const filePath = join(dir, 'session-model-overrides.json')
    writeFileSync(filePath, JSON.stringify({ version: 0, overrides: [{ sessionFile: A }, { sessionFile: B, provider: 'p', modelId: 'm', requestedAt: 1 }] }))
    expect(createSessionModelOverrides({ filePath }).list()).toEqual([{ sessionFile: B, provider: 'p', modelId: 'm', requestedAt: 1 }])
  })
})
