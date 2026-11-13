import { realpath, rm } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { gitExec } from './git-workspace'

type GitResult = { ok: true; stdout: string } | { ok: false; error: string }
type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null

async function git(cwd: string, args: string[]): Promise<GitResult> {
  const result = await gitExec(cwd, args, { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 })
  if (result.status !== 0) return { ok: false, error: (result.stderr || result.stdout || 'git failed').trim().slice(0, 2000) }
  return { ok: true, stdout: result.stdout }
}

async function currentOperation(cwd: string): Promise<GitOperation> {
  const checks: Array<[Exclude<GitOperation, null>, string]> = [
    ['merge', 'MERGE_HEAD'],
    ['rebase', 'REBASE_HEAD'],
    ['cherry-pick', 'CHERRY_PICK_HEAD'],
    ['revert', 'REVERT_HEAD'],
  ]
  for (const [name, ref] of checks) {
    const result = await gitExec(cwd, ['rev-parse', '--verify', '--quiet', ref], { timeout: 10_000 })
    if (result.status === 0 && result.stdout.trim()) return name
  }
  return null
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.split(sep).includes('..'))
}

export async function discardGitChanges(cwd: string, tracked: string[], untracked: string[]): Promise<GitResult> {
  const root = await realpath(cwd).catch(() => null)
  if (!root) return { ok: false, error: 'invalid_path' }
  for (const path of untracked) {
    const absolute = resolve(cwd, path)
    const target = await realpath(absolute).catch(async () => {
      const parent = await realpath(dirname(absolute)).catch(() => null)
      return parent ? resolve(parent, basename(absolute)) : null
    })
    if (!target || !isInside(root, target)) return { ok: false, error: 'invalid_path' }
  }
  for (const path of untracked) {
    try {
      await rm(resolve(cwd, path), { recursive: true, force: true })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'delete_failed' }
    }
  }
  if (!tracked.length) return { ok: true, stdout: '' }
  const restored = await git(cwd, ['restore', '--worktree', '--source=HEAD', '--', ...tracked])
  const operation = await currentOperation(cwd)
  if (!operation) return restored
  const removed = await git(cwd, ['rm', '-f', '--', ...tracked])
  if (!removed.ok) return removed
  const checked = await git(cwd, ['checkout', 'HEAD', '--', ...tracked])
  return checked.ok ? git(cwd, ['restore', '--staged', '--worktree', '--source=HEAD', '--', ...tracked]) : checked
}
