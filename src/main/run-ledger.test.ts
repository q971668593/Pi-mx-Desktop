import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunLedger, DEFAULT_MAX_ENTRIES } from './run-ledger'
import { exitLedgerCommands, turnEndCommands } from './worker-lifecycle-machine'

const dirs: string[] = []

function newFile() {
  const dir = mkdtempSync(join(tmpdir(), 'pi-run-ledger-'))
  dirs.push(dir)
  // 故意多一层目录：验证自动创建父目录
  return join(dir, 'nested', 'run-ledger.json')
}

function newLedger(options: { now?: () => number; maxEntries?: number; maxAgeMs?: number; onError?: (e: unknown) => void } = {}) {
  const filePath = newFile()
  return { ledger: createRunLedger({ filePath, ...options }), filePath }
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('run ledger', () => {
  it('records a run and reads it back (creating parent dirs)', () => {
    const { ledger, filePath } = newLedger({ now: () => 1000 })
    expect(ledger.beginRun({ sessionFile: '/tmp/a.jsonl', cwd: '/work', runId: 'run-1' })).toMatchObject({
      sessionFile: '/tmp/a.jsonl',
      startedAt: 1000,
    })

    const rows = ledger.read()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionFile: '/tmp/a.jsonl', cwd: '/work', runId: 'run-1', startedAt: 1000 })
    expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(1)
  })

  it('ignores empty session files', () => {
    const { ledger } = newLedger()
    expect(ledger.beginRun({ sessionFile: '   ' })).toBeNull()
    expect(ledger.read()).toEqual([])
  })

  it('releaseRun removes only the matching session', () => {
    const { ledger } = newLedger()
    ledger.beginRun({ sessionFile: '/a.jsonl' })
    ledger.beginRun({ sessionFile: '/b.jsonl' })

    expect(ledger.releaseRun('/a.jsonl')).toBe(true)
    expect(ledger.releaseRun('/a.jsonl')).toBe(false)
    expect(ledger.read().map((row) => row.sessionFile)).toEqual(['/b.jsonl'])
  })

  it('rebeginning the same session keeps a single entry and refreshes timestamps', () => {
    let clock = 100
    const { ledger } = newLedger({ now: () => clock })
    ledger.beginRun({ sessionFile: '/a.jsonl' })
    clock = 200
    ledger.beginRun({ sessionFile: '/a.jsonl', runId: 'second' })

    const rows = ledger.read()
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe('second')
    expect(rows[0].startedAt).toBe(200)
  })

  it('markOrphaned flags a run and listOrphans respects the age budget', () => {
    let clock = 1000
    const { ledger } = newLedger({ now: () => clock })
    ledger.beginRun({ sessionFile: '/a.jsonl' })
    expect(ledger.markOrphaned('/a.jsonl', { reason: 'worker-crash' })).toBe(true)

    expect(ledger.listOrphans(60_000)).toHaveLength(1)
    expect(ledger.listOrphans(60_000)[0].orphanReason).toBe('worker-crash')

    clock = 1000 + 120_000
    expect(ledger.listOrphans(60_000)).toEqual([])
  })

  it('markOrphaned reports false for unknown sessions', () => {
    const { ledger } = newLedger()
    expect(ledger.markOrphaned('/missing.jsonl')).toBe(false)
  })

  /**
   * 回归：曾经的接线方式把 mark-orphan 和 release 一起执行，releaseRun 按 sessionFile
   * 把整行删掉 → 崩渍归因当场销毁，启动 sweep 与 `ipc:worker-fatal.orphanedRuns` 永远是 0。
   * 这里按 manager 的真实执行方式跑一遍转移表命令，断言孤儿能活到下一次启动。
   */
  it('a crashed run survives as an orphan that the next boot sweep reports', () => {
    const clock = 50_000
    const first = newLedger({ now: () => clock })
    first.ledger.beginRun({ sessionFile: '/a.jsonl', cwd: '/work' })

    const runCommands = (
      ledger: ReturnType<typeof createRunLedger>,
      commands: readonly { type: string; reason?: string }[],
    ) => {
      for (const command of commands) {
        if (command.type === 'run.mark-orphan') ledger.markOrphaned('/a.jsonl', { reason: command.reason })
        else if (command.type === 'run.release') ledger.releaseRun('/a.jsonl')
      }
    }
    runCommands(first.ledger, exitLedgerCommands('busy', 1))

    expect(first.ledger.read()).toHaveLength(1)
    expect(first.ledger.listOrphans()).toHaveLength(1)

    // 另一个进程（重启）打开同一份账本：启动 sweep 必须看得到这条
    const rebooted = createRunLedger({ filePath: first.filePath, now: () => clock + 1_000 })
    expect(rebooted.sweep('app-boot').orphans.map((row) => row.sessionFile)).toEqual(['/a.jsonl'])
    expect(rebooted.listOrphans().map((row) => row.orphanReason)).toEqual(['worker-exit:1'])

    // 正常终态才删行：同样一套执行器，idle 之后不再留孤儿
    rebooted.beginRun({ sessionFile: '/a.jsonl' })
    runCommands(rebooted, turnEndCommands('busy', 'idle'))
    expect(rebooted.listOrphans()).toEqual([])
    expect(rebooted.read()).toEqual([])
  })

  it('sweep marks leftovers as orphans and drops stale entries', () => {
    let clock = 10_000
    const { ledger } = newLedger({ now: () => clock, maxAgeMs: 5_000 })
    ledger.beginRun({ sessionFile: '/stale.jsonl' })
    ledger.markOrphaned('/stale.jsonl')
    clock = 12_000
    ledger.beginRun({ sessionFile: '/fresh.jsonl' })

    // stale 已 6s（> 5s 预算）→ 丢弃；fresh 4s → 标记为孤儿并保留
    clock = 16_000
    const result = ledger.sweep('app-boot')

    expect(result.orphans.map((row) => row.sessionFile)).toEqual(['/fresh.jsonl'])
    expect(result.orphans[0].orphanReason).toBe('app-boot')
    expect(result.kept).toBe(1)
  })

  it('recovers a long-running claim even when it started before the retention window', () => {
    let clock = 10_000
    const { ledger } = newLedger({ now: () => clock, maxAgeMs: 5_000 })
    ledger.beginRun({ sessionFile: '/long.jsonl' })
    ledger.identifyRun('/long.jsonl', 'run-long')
    clock = 50_000
    expect(ledger.sweep('app-boot').orphans).toMatchObject([
      { sessionFile: '/long.jsonl', runId: 'run-long', startedAt: 10_000, orphanedAt: 50_000 },
    ])
  })

  it('sweep keeps an already-orphaned fresh entry without rewriting its reason', () => {
    const clock = 5_000
    const { ledger } = newLedger({ now: () => clock, maxAgeMs: 60_000 })
    ledger.beginRun({ sessionFile: '/a.jsonl' })
    ledger.markOrphaned('/a.jsonl', { reason: 'worker-crash' })

    const result = ledger.sweep('app-boot')
    expect(result.orphans).toHaveLength(1)
    expect(result.orphans[0].orphanReason).toBe('worker-crash')
  })

  it('caps stored entries at maxEntries (oldest dropped first)', () => {
    let clock = 0
    const { ledger } = newLedger({ now: () => clock, maxEntries: 3 })
    for (const name of ['a', 'b', 'c', 'd']) {
      clock += 1
      ledger.beginRun({ sessionFile: `/${name}.jsonl` })
    }
    expect(ledger.read().map((row) => row.sessionFile)).toEqual(['/d.jsonl', '/c.jsonl', '/b.jsonl'])
    expect(DEFAULT_MAX_ENTRIES).toBeGreaterThanOrEqual(3)
  })

  it('treats a corrupt ledger file as empty instead of throwing', () => {
    const onError = vi.fn()
    const filePath = newFile()
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, '{ not json', 'utf8')

    const ledger = createRunLedger({ filePath, onError })
    expect(ledger.read()).toEqual([])
    expect(onError).toHaveBeenCalledTimes(1)

    ledger.beginRun({ sessionFile: '/ok.jsonl' })
    expect(ledger.read()).toHaveLength(1)
  })

  it('never throws when the file cannot be written', () => {
    const onError = vi.fn()
    // 用一个把文件路径当目录的位置制造写入失败
    const filePath = newFile()
    mkdirSync(filePath, { recursive: true })
    const ledger = createRunLedger({ filePath, onError })

    expect(() => ledger.beginRun({ sessionFile: '/a.jsonl' })).not.toThrow()
    expect(onError).toHaveBeenCalled()
  })
})
