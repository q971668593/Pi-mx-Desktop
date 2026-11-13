import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('./wsl/runtime-config', () => ({
  getAgentRuntimeConfig: () => ({ mode: 'host', distro: null }),
}))

const { stageSelectedHunks } = await import('./git-stage-hunk')

const repos: string[] = []

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

describe('selected hunk staging', () => {
  afterEach(() => {
    for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true })
  })

  it('stages one hunk while leaving the other change in the file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-hunk-'))
    repos.push(cwd)
    git(cwd, ['init', '-b', 'main'])
    git(cwd, ['config', 'user.email', 'tester@example.com'])
    git(cwd, ['config', 'user.name', 'tester'])
    git(cwd, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(cwd, 'note.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n')
    git(cwd, ['add', 'note.txt'])
    git(cwd, ['commit', '-m', 'base'])
    writeFileSync(join(cwd, 'note.txt'), 'one\nADDED\nthree\nfour\nfive\nsix\nseven\neight\nnine\nCHANGED\n')
    const diff = git(cwd, ['diff', '--', 'note.txt'])
    const headers = diff.split(/\r?\n/).filter((line) => line.startsWith('@@'))
    expect(headers).toHaveLength(2)
    const result = await stageSelectedHunks(cwd, 'note.txt', [headers[1]])
    if (!result.ok) throw new Error(result.error)
    expect(readFileSync(join(cwd, 'note.txt'), 'utf8')).toBe('one\nADDED\nthree\nfour\nfive\nsix\nseven\neight\nnine\nCHANGED\n')
    expect(git(cwd, ['diff', '--cached', '--', 'note.txt'])).toContain('CHANGED')
    expect(git(cwd, ['diff', '--cached', '--', 'note.txt'])).not.toContain('ADDED')
    expect(git(cwd, ['diff', '--', 'note.txt'])).toContain('ADDED')
    expect(git(cwd, ['diff', '--', 'note.txt'])).not.toContain('CHANGED')
  })
})
