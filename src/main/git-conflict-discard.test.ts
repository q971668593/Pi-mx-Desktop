import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

vi.mock('./wsl/runtime-config', () => ({
  getAgentRuntimeConfig: () => ({ mode: 'host', distro: null }),
}))

import { discardGitChanges } from './git-conflict-discard'

const repos: string[] = []

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function conflictRepo() {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-conflict-'))
  repos.push(cwd)
  git(cwd, ['init', '-b', 'main'])
  git(cwd, ['config', 'user.email', 'tester@example.com'])
  git(cwd, ['config', 'user.name', 'tester'])
  writeFileSync(join(cwd, 'note.txt'), 'base\n')
  git(cwd, ['add', 'note.txt'])
  git(cwd, ['commit', '-m', 'base'])
  git(cwd, ['checkout', '-b', 'other'])
  writeFileSync(join(cwd, 'note.txt'), 'theirs\n')
  git(cwd, ['commit', '-am', 'theirs'])
  git(cwd, ['checkout', 'main'])
  writeFileSync(join(cwd, 'note.txt'), 'ours\n')
  git(cwd, ['commit', '-am', 'ours'])
  expect(() => git(cwd, ['merge', 'other'])).toThrow()
  return cwd
}

describe('conflict discard', () => {
  afterEach(() => {
    for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true })
  })

  it('returns a conflicted file to our committed version', async () => {
    const cwd = conflictRepo()
    expect(readFileSync(join(cwd, 'note.txt'), 'utf8')).toContain('<<<<<<<')

    const result = await discardGitChanges(cwd, ['note.txt'], [])

    expect(result.ok).toBe(true)
    expect(readFileSync(join(cwd, 'note.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('ours\n')
    expect(git(cwd, ['status', '--porcelain'])).not.toContain('note.txt')
  })
})
