import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunTaskAiManifest } from './run-task-ai-manifest'

const dirs: string[] = []
const dir = (): string => {
  const next = mkdtempSync(join(tmpdir(), 'pi-ai-manifest-'))
  dirs.push(next)
  return next
}
afterEach(() => {
  for (const item of dirs.splice(0)) rmSync(item, { recursive: true, force: true })
})

describe('RunTaskAiManifest', () => {
  it('remembers the labels the last AI draft wrote, per workspace', () => {
    const store = new RunTaskAiManifest(dir())
    store.set('/proj/a', ['一键运行', 'api'])
    store.set('/proj/b', ['发布'])

    expect(store.get('/proj/a')).toEqual(['一键运行', 'api'])
    expect(store.get('/proj/b')).toEqual(['发布'])
    expect(store.get('/proj/missing')).toEqual([])
  })

  it('survives a cold start and drops stale labels on the next write', () => {
    const root = dir()
    const first = new RunTaskAiManifest(root)
    first.set('/proj/a', ['api', 'web', 'api'])

    const reloaded = new RunTaskAiManifest(root)
    expect(reloaded.get('/proj/a')).toEqual(['api', 'web']) // 去重

    reloaded.set('/proj/a', ['web'])
    expect(new RunTaskAiManifest(root).get('/proj/a')).toEqual(['web'])

    reloaded.clear('/proj/a')
    expect(new RunTaskAiManifest(root).get('/proj/a')).toEqual([])
  })

  it('treats a corrupt or foreign file as empty instead of failing the save', () => {
    const root = dir()
    const path = join(root, 'run-task-ai-manifest.json')
    writeFileSync(path, '{ this is not json', 'utf8')
    expect(new RunTaskAiManifest(root).get('/proj/a')).toEqual([])

    writeFileSync(path, JSON.stringify({ version: 99, workspaces: 'nope' }), 'utf8')
    expect(new RunTaskAiManifest(root).get('/proj/a')).toEqual([])

    const store = new RunTaskAiManifest(root)
    store.set('/proj/a', ['api'])
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version: number; workspaces: Record<string, unknown> }
    expect(parsed.version).toBe(1)
    expect(Object.keys(parsed.workspaces)).toEqual([process.platform === 'win32' ? resolve('/proj/a').toLowerCase() : resolve('/proj/a')])
  })

  it('does not keep an entry once nothing is generated for that workspace', () => {
    const root = dir()
    const store = new RunTaskAiManifest(root)
    store.set('/proj/a', ['api'])
    store.set('/proj/a', [])
    expect(new RunTaskAiManifest(root).get('/proj/a')).toEqual([])
  })
})
