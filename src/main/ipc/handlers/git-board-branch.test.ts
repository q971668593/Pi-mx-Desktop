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

  it('fetches incoming commits without updating HEAD or the working tree', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pi-git-fetch-'))
    repos.push(base)
    git(base, ['init', '-b', 'main'])
    git(base, ['config', 'user.email', 'tester@example.com'])
    git(base, ['config', 'user.name', 'tester'])
    writeFileSync(join(base, 'note.txt'), 'before')
    git(base, ['add', '.'])
    git(base, ['commit', '-m', 'base'])
    const local = join(base, 'clone')
    git(base, ['clone', '--no-local', '.', local])
    const head = git(local, ['rev-parse', 'HEAD'])
    writeFileSync(join(base, 'note.txt'), 'after')
    git(base, ['commit', '-am', 'incoming change'])

    const fetchRemote = handlers.get('ipc:gitBoard.sync')!
    await expect(fetchRemote({ cwd: local, action: 'fetch' })).resolves.toMatchObject({
      ok: true, tracking: true, incomingCount: 1, incoming: [{ subject: 'incoming change' }],
    })
    expect(git(local, ['rev-parse', 'HEAD'])).toBe(head)
    expect(git(local, ['show', 'HEAD:note.txt'])).toBe('before')
    expect(git(local, ['status', '--porcelain'])).toBe('')
  })

  it('does not list the remote default-branch alias as a separate branch', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-git-branch-'))
    repos.push(cwd)
    git(cwd, ['init', '-b', 'main'])
    git(cwd, ['config', 'user.email', 'tester@example.com'])
    git(cwd, ['config', 'user.name', 'tester'])
    writeFileSync(join(cwd, 'base.txt'), 'base')
    git(cwd, ['add', 'base.txt'])
    git(cwd, ['commit', '-m', 'base 1'])
    const head = git(cwd, ['rev-parse', 'HEAD']).trim()
    git(cwd, ['update-ref', 'refs/remotes/origin/main', head])
    git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])

    const overview = await handlers.get('ipc:gitBoard.overview')!({ cwd, query: '1' })
    expect(overview.ok).toBe(true)
    expect((overview.branches as Array<{ name: string }>).map((branch) => branch.name).sort()).toEqual(['main', 'origin/main'])
    expect((overview.commits as Array<{ subject: string }>).map((commit) => commit.subject)).toEqual(['base 1'])
  })

  it('checks out a commit detached only when the working tree is clean', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-git-checkout-'))
    repos.push(cwd)
    git(cwd, ['init', '-b', 'main'])
    git(cwd, ['config', 'user.email', 'tester@example.com'])
    git(cwd, ['config', 'user.name', 'tester'])
    writeFileSync(join(cwd, 'base.txt'), 'base')
    git(cwd, ['add', 'base.txt'])
    git(cwd, ['commit', '-m', 'base'])
    const firstCommit = git(cwd, ['rev-parse', 'HEAD']).trim()
    writeFileSync(join(cwd, 'base.txt'), 'next')
    git(cwd, ['commit', '-am', 'next'])
    const checkout = handlers.get('ipc:gitBoard.checkoutCommit')!
    await expect(checkout({ cwd, ref: firstCommit })).resolves.toMatchObject({ ok: true })
    expect(git(cwd, ['status', '--short', '--branch'])).toContain('## HEAD (no branch)')
    writeFileSync(join(cwd, 'base.txt'), 'local edit')
    await expect(checkout({ cwd, ref: git(cwd, ['rev-parse', 'main']).trim() })).resolves.toMatchObject({ ok: false, error: 'working_tree_dirty' })
  })

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
