import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }))
vi.mock('electron-store', () => ({
  default: class Store {
    get() { return null }
    set() { return undefined }
  },
}))
const repos: string[] = []
const handlers = new Map<string, (request: Record<string, unknown>) => Promise<Record<string, unknown>>>()
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

vi.mock('../../trusted-workspace', () => ({ authorizeProjectCwd: (cwd: string) => ({ ok: true, cwd }) }))
vi.mock('../../wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => ({ mode: 'host', distro: null }) }))
vi.mock('../registry', () => ({
  registerHandlerWithSchema: (channel: string, _schema: unknown, handler: (request: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
    handlers.set(channel, handler)
  },
}))

const { registerGitBoardHandlers } = await import('./git-board')
registerGitBoardHandlers()

describe('git branch safety', () => {
  afterEach(() => { for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true }) })

  it('refuses the current branch and reports an unmerged branch before force delete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-git-branch-'))
    repos.push(cwd)
    git(cwd, ['init', '-b', 'main'])
    git(cwd, ['config', 'user.email', 'tester@example.com'])
    git(cwd, ['config', 'user.name', 'tester'])
    writeFileSync(join(cwd, 'base.txt'), 'base')
    git(cwd, ['add', 'base.txt'])
    git(cwd, ['commit', '-m', 'base'])
    git(cwd, ['checkout', '-b', 'feature'])
    writeFileSync(join(cwd, 'feature.txt'), 'feature')
    git(cwd, ['add', 'feature.txt'])
    git(cwd, ['commit', '-m', 'feature'])
    git(cwd, ['checkout', 'main'])

    const branch = handlers.get('ipc:gitBoard.branch')!
    await expect(branch({ cwd, action: 'delete', name: 'main' })).resolves.toMatchObject({ ok: false, error: 'current_branch' })
    const unmerged = await branch({ cwd, action: 'delete', name: 'feature' })
    expect(unmerged.ok).toBe(false)
    expect(String(unmerged.error)).toMatch(/not fully merged|未完全合并/i)
    await expect(branch({ cwd, action: 'delete', name: 'feature', force: true })).resolves.toMatchObject({ ok: true })
    expect(git(cwd, ['branch', '--list', 'feature'])).toBe('')
  })

  it('creates a non-fast-forward merge commit', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-git-merge-'))
    repos.push(cwd)
    git(cwd, ['init', '-b', 'main'])
    git(cwd, ['config', 'user.email', 'tester@example.com'])
    git(cwd, ['config', 'user.name', 'tester'])
    writeFileSync(join(cwd, 'base.txt'), 'base')
    git(cwd, ['add', 'base.txt'])
    git(cwd, ['commit', '-m', 'base'])
    git(cwd, ['checkout', '-b', 'feature'])
    writeFileSync(join(cwd, 'feature.txt'), 'feature')
    git(cwd, ['add', 'feature.txt'])
    git(cwd, ['commit', '-m', 'feature'])
    git(cwd, ['checkout', 'main'])
    const merge = handlers.get('ipc:gitBoard.merge')!
    await expect(merge({ cwd, ref: 'feature', noFf: true })).resolves.toMatchObject({ ok: true })
    expect(git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/)).toHaveLength(3)
  })
  it('creates an annotated tag when a message is supplied', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-git-tag-'))
    repos.push(cwd)
    git(cwd, ['init', '-b', 'main'])
    git(cwd, ['config', 'user.email', 'tester@example.com'])
    git(cwd, ['config', 'user.name', 'tester'])
    writeFileSync(join(cwd, 'base.txt'), 'base')
    git(cwd, ['add', 'base.txt'])
    git(cwd, ['commit', '-m', 'base'])
    const tag = handlers.get('ipc:gitBoard.tag')!
    await expect(tag({ cwd, action: 'create', name: 'v1.0.0', message: 'release' })).resolves.toMatchObject({ ok: true })
    expect(git(cwd, ['for-each-ref', '--format=%(objecttype)', 'refs/tags/v1.0.0']).trim()).toBe('tag')
  })})
