import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { clearGitCommandLog, configureGitCommandLog, gitCommandLog, isLoggedGitCommand, parseBranches, parseRemotes, parseStatus, parseStatusV2, parseStashes, parseWorktrees, recordGitCommand, sanitizeCloneUrl, selectedHunkPatch, unstageArgs } from './git-board-parse'

describe('git board parsers', () => {
  it('keeps untracked files and counts ahead and behind', () => {
    const status = parseStatus('## main...origin/main [ahead 2, behind 1]\nM  src/a.ts\n?? src/new.ts\nUU src/conflict.ts\n')
    expect(status).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
    expect(status.files.map((file) => [file.group, file.path])).toEqual([
      ['staged', 'src/a.ts'],
      ['untracked', 'src/new.ts'],
      ['conflict', 'src/conflict.ts'],
    ])
    const porcelain = parseStatus('# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0')
    expect(porcelain).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
  })

  it('keeps spaced and renamed paths from porcelain v2', () => {
    const raw = '1 M. N... 100644 100644 100644 abc def my file.ts\0' +
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\0old.ts\0' +
      '? untracked file.ts\0'
    expect(parseStatusV2(raw).map((file) => [file.group, file.path, file.originalPath || ''])).toEqual([
      ['staged', 'my file.ts', ''],
      ['staged', 'new.ts', 'old.ts'],
      ['untracked', 'untracked file.ts', ''],
    ])
  })

  it('returns the newest git commands first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-git-log-'))
    const file = join(dir, 'log.json')
    configureGitCommandLog({
      load: () => JSON.parse(readFileSync(file, 'utf8')),
      save: (entries) => writeFileSync(file, JSON.stringify(entries)),
    })
    clearGitCommandLog()
    recordGitCommand({ time: 1, command: 'git status', repo: 'C:/repo', success: true, output: '' })
    recordGitCommand({ time: 2, command: 'git commit', repo: 'C:/repo', success: false, output: 'failed' })
    expect(gitCommandLog(1)).toEqual([{ time: 2, command: 'git commit', repo: 'C:/repo', success: false, output: 'failed' }])
    configureGitCommandLog({
      load: () => JSON.parse(readFileSync(file, 'utf8')),
      save: (entries) => writeFileSync(file, JSON.stringify(entries)),
    })
    expect(gitCommandLog(2)[0].command).toBe('git commit')
    recordGitCommand({ time: 3, command: 'git push', repo: 'C:/other', success: true, output: '' })
    expect(gitCommandLog(20, 'C:/repo').map((entry) => entry.command)).toEqual(['git commit', 'git status'])
    clearGitCommandLog('C:/repo')
    expect(gitCommandLog(20).map((entry) => entry.command)).toEqual(['git push'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('parses branches, stashes, remotes and worktrees', () => {
    expect(parseBranches('* main  abc1234 [origin/main: ahead 1] subject\n  old  def5678 subject\n')[0].current).toBe(true)
    expect(parseStashes('stash@{0}\u001fWIP\n')).toEqual([{ ref: 'stash@{0}', message: 'WIP' }])
    expect(parseRemotes('origin git@example.com:repo.git (fetch)\norigin git@example.com:repo.git (push)\n')).toEqual([
      { name: 'origin', fetch: 'git@example.com:repo.git', push: 'git@example.com:repo.git' },
    ])
    expect(parseWorktrees('worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\n')).toEqual([
      { path: 'C:/repo', head: 'abc', branch: 'main' },
    ])
  })


  it('rebuilds only the selected diff hunks with corrected counts', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' one',
      '+added',
      ' two',
      ' three',
      '@@ -8,2 +9,2 @@',
      '-old',
      '+new',
      ' tail',
    ].join('\n')
    expect(selectedHunkPatch('src/a.ts', patch, ['@@ -8,2 +9,2 @@'])).toBe([
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -8,2 +9,2 @@',
      '-old',
      '+new',
      ' tail',
      '',
    ].join('\n'))
    expect(selectedHunkPatch('src/a.ts', patch, ['missing'])).toBeNull()
  })

  it('records repository changes but not status refreshes', () => {
    expect(isLoggedGitCommand(['status', '--porcelain=v2', '-b'])).toBe(false)
    expect(isLoggedGitCommand(['-c', 'core.editor=true', 'merge', '--continue'])).toBe(true)
    expect(isLoggedGitCommand(['stash', 'list'])).toBe(false)
    expect(isLoggedGitCommand(['stash', 'push', '-m', 'wip'])).toBe(true)
    expect(isLoggedGitCommand(['tag', '--sort=-creatordate'])).toBe(false)
    expect(isLoggedGitCommand(['commit', '-m', 'save'])).toBe(true)
  })

  it('unstages files before the first commit without using HEAD', () => {
    expect(unstageArgs(false, ['src/a.ts'])).toEqual(['rm', '--cached', '-r', '--quiet', '--', 'src/a.ts'])
    expect(unstageArgs(true)).toEqual(['restore', '--staged', '.'])
    const cwd = mkdtempSync(join(tmpdir(), 'pi-unstage-'))
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'pipe' })
      writeFileSync(join(cwd, 'note.txt'), 'draft')
      execFileSync('git', ['add', 'note.txt'], { cwd, stdio: 'pipe' })
      execFileSync('git', unstageArgs(false, ['note.txt']), { cwd, stdio: 'pipe' })
      expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' })).toBe('')
      expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toContain('?? note.txt')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('cleans a pasted clone command and rejects option-like input', () => {
    expect(sanitizeCloneUrl('  git clone "https://example.com/repo.git" ')).toBe('https://example.com/repo.git')
    expect(sanitizeCloneUrl('--upload-pack=bad')).toBeNull()
    expect(sanitizeCloneUrl('git clone')).toBeNull()
  })
})
