import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  base: '',
  config: { enabled: false, text: '', scope: 'global' as 'global' | 'project' },
}))

vi.mock('electron', () => ({ app: { getPath: () => h.base } }))
vi.mock('./config-store', () => ({
  configStore: {
    get: () => h.config,
    set: (_key: string, value: unknown) => {
      h.config = value as typeof h.config
    },
  },
}))
vi.mock('./agent-dir', () => ({ resolveActiveAgentDir: () => join(h.base, 'agent') }))

let mod: typeof import('./prompt-inject')

beforeAll(async () => {
  h.base = mkdtempSync(join(tmpdir(), 'pi-prompt-inject-'))
  h.config = { enabled: false, text: '', scope: 'global' }
  mod = await import('./prompt-inject')
})

afterAll(() => {
  rmSync(h.base, { recursive: true, force: true })
})

const target = () => join(h.base, 'agent', 'APPEND_SYSTEM.md')
const backups = () => {
  try {
    // 文件名以 ISO 时间戳开头，倒序即最新在前
    return readdirSync(join(h.base, 'prompt-inject-backups'))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

describe('apply / revert against a real file', () => {
  it('writes the block and keeps the agent dir', () => {
    const state = mod.applyPromptInject({ enabled: true, text: '第一版' })
    expect(state.injected).toBe(true)
    expect(state.fileExists).toBe(true)
    expect(readFileSync(target(), 'utf-8')).toContain('第一版')
  })

  it('replaces the block on a second apply and keeps a backup', () => {
    const before = backups().length
    mod.applyPromptInject({ enabled: true, text: '第二版' })
    const content = readFileSync(target(), 'utf-8')
    expect(content.match(/prompt-inject:start/g)).toHaveLength(1)
    expect(content).toContain('第二版')
    expect(content).not.toContain('第一版')
    expect(backups().length).toBeGreaterThan(before)
  })

  it('keeps hand-written content around the block', () => {
    mkdirSync(join(h.base, 'agent'), { recursive: true })
    writeFileSync(target(), '手写内容\n', 'utf-8')
    mod.applyPromptInject({ enabled: true, text: '注入内容' })
    let content = readFileSync(target(), 'utf-8')
    expect(content.startsWith('手写内容')).toBe(true)
    expect(content).toContain('注入内容')

    const state = mod.revertPromptInject()
    content = readFileSync(target(), 'utf-8')
    expect(state.injected).toBe(false)
    expect(content.trim()).toBe('手写内容')
  })

  it('restores a backup over the target', () => {
    writeFileSync(target(), '备份前的内容\n', 'utf-8')
    mod.applyPromptInject({ enabled: true, text: '会被覆盖' })
    const [latest] = backups()
    expect(latest).toBeTruthy()
    mod.restorePromptInjectBackup(latest)
    expect(readFileSync(target(), 'utf-8').trim()).toBe('备份前的内容')
  })

  it('rejects a backup name outside the backup dir', () => {
    expect(() => mod.restorePromptInjectBackup('../../evil.md')).toThrow('invalid_backup_name')
  })

  it('writes into the project .pi dir for the project scope', () => {
    const project = join(h.base, 'proj')
    mkdirSync(project, { recursive: true })
    const state = mod.applyPromptInject({ enabled: true, text: '项目级', scope: 'project' }, project)
    expect(state.targetPath.replace(/\\/g, '/')).toContain('proj/.pi/APPEND_SYSTEM.md')
    expect(readFileSync(join(project, '.pi', 'APPEND_SYSTEM.md'), 'utf-8')).toContain('项目级')
    mod.applyPromptInject({ enabled: false, scope: 'global' })
  })
})
