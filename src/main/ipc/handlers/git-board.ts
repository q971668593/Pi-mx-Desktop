import { z } from 'zod'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { authorizeProjectCwd } from '../../trusted-workspace'
import { gitExec, isGitRepository, runGit } from '../../git-workspace'
import { discardGitChanges } from '../../git-conflict-discard'
import { stageSelectedHunks } from '../../git-stage-hunk'
import { clearGitCommandLog, gitCommandLog, isLoggedGitCommand, parseRemotes, parseStatus, parseStatusV2, parseStashes, parseTags, parseWorktrees, recordGitCommand, sanitizeCloneUrl, unstageArgs } from '../../git-board-parse'
import { completeWithPluginModel } from '../../plugin-model'
import { registerHandlerWithSchema } from '../registry'

const cwdSchema = z.object({ cwd: z.string().min(1) }).strict()
const refSchema = z.object({ cwd: z.string().min(1), ref: z.string().trim().min(1).max(300) }).strict()
const commitSchema = z.object({ cwd: z.string().min(1), message: z.string().trim().min(1).max(20_000), paths: z.array(z.string().min(1)).max(5000).optional() }).strict()
const commitActionSchema = commitSchema.extend({ action: z.enum(['commit', 'stage-and-commit', 'commit-and-push']).optional() }).strict()
const partialSchema = z.object({ cwd: z.string().min(1), path: z.string().min(1), hunks: z.array(z.string().min(1)).min(1).max(200) }).strict()
const mergeSchema = z.object({ cwd: z.string().min(1), ref: z.string().trim().min(1).max(300), noFf: z.boolean().optional() }).strict()
const pathsSchema = z.object({ cwd: z.string().min(1), paths: z.array(z.string().min(1)).min(1).max(5000) }).strict()

const SAFE_REF = /^(?![-./])(?!.*\.\.)(?!.*[@{])[\w./+-]+$/
const SAFE_PATH = /^(?![-/])(?!.*(?:^|[\\/])\.\.(?:$|[\\/]))[^\0]+$/

function safeRef(value: string): string | null {
  const ref = value.trim()
  return SAFE_REF.test(ref) ? ref : null
}

function safePaths(paths: string[] | undefined): string[] | null {
  if (!paths) return []
  return paths.every((path) => SAFE_PATH.test(path)) ? paths : null
}

async function authorized(cwd: string) {
  const result = authorizeProjectCwd(cwd)
  if (!result.ok) return result
  if (!isGitRepository(result.cwd)) return { ok: false as const, error: 'not_repo' }
  return result
}

async function git(cwd: string, args: string[], input?: string) {
  const result = await gitExec(cwd, args, { timeout: 120_000, maxBuffer: 20 * 1024 * 1024, input })
  const output = `${result.stdout}${result.stderr}`.trim().slice(0, 20_000)
  if (isLoggedGitCommand(args)) recordGitCommand({ time: Math.floor(Date.now() / 1000), command: `git ${args.join(' ')}`, repo: cwd, success: result.status === 0, output })
  if (result.status !== 0) return { ok: false as const, error: (result.stderr || result.stdout || 'git failed').trim().slice(0, 2000) }
  return { ok: true as const, stdout: result.stdout }
}

function parseGraph(stdout: string) {
  return stdout.split('\0').filter(Boolean).map((row) => {
    const [hash, short, parents, author, email, time, subject, decorations] = row.split('\x1f')
    return {
      hash, short, parents: parents ? parents.split(' ').filter(Boolean) : [],
      author, email, time: Number(time) || 0, subject, decorations: decorations || '',
    }
  })
}

const COMMIT_PROMPT = `根据 git diff 写一条简短提交说明。只输出说明正文，不要代码块或解释。第一行不超过 72 个字符，需要时再用短正文说明原因。不要编造未出现的改动。`

export function registerGitBoardHandlers(): void {
  registerHandlerWithSchema('ipc:gitBoard.overview', z.object({ cwd: z.string().min(1), skip: z.number().int().min(0).max(100_000).optional(), ref: z.string().trim().max(300).optional(), author: z.string().trim().max(200).optional() }).strict(), async ({ cwd, skip, ref, author }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return { ok: false, error: repo.error }
    const reference = ref?.trim() ? safeRef(ref) : null
    if (ref?.trim() && !reference) return { ok: false, error: 'invalid_ref' }
    const graphArgs = ['log', '--topo-order', '--decorate=full', ...(reference ? [reference] : ['--all']), ...(author?.trim() ? [`--author=${author.trim()}`] : []), '--max-count=301', `--skip=${skip || 0}`, '--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D', '-z']
    const [status, branches, graph, stashes, tags, remotes, worktrees, operation] = await Promise.all([
      git(repo.cwd, ['status', '--porcelain=v2', '-b', '--untracked-files=all', '-z']),
      git(repo.cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(subject)', 'refs/heads', 'refs/remotes']),
      git(repo.cwd, graphArgs),
      git(repo.cwd, ['stash', 'list', '--format=%gd%x1f%gs']),
      git(repo.cwd, ['tag', '--sort=-creatordate']),
      git(repo.cwd, ['remote', '-v']),
      git(repo.cwd, ['worktree', 'list', '--porcelain']),
      gitOperation(repo.cwd),
    ])
    if (!status.ok || !branches.ok || !graph.ok || !stashes.ok || !tags.ok || !remotes.ok || !worktrees.ok) {
      return [status, branches, graph, stashes, tags, remotes, worktrees].find((result) => !result.ok) || status
    }
    return {
      ok: true,
      status: parseStatus(status.stdout),
      files: parseStatusV2(status.stdout),
      branches: parseBranchRefs(branches.stdout, parseStatus(status.stdout).branch),
      commits: parseGraph(graph.stdout).slice(0, 300),
      hasMore: parseGraph(graph.stdout).length > 300,
      stashes: parseStashes(stashes.stdout),
      tags: parseTags(tags.stdout),
      remotes: parseRemotes(remotes.stdout),
      worktrees: parseWorktrees(worktrees.stdout),
      operation,
    }
  })

  registerHandlerWithSchema('ipc:gitBoard.stage', pathsSchema, async ({ cwd, paths }) => {
    const repo = await authorized(cwd)
    const safe = safePaths(paths)
    if (!repo.ok || !safe) return { ok: false, error: repo.ok ? 'invalid_path' : repo.error }
    return git(repo.cwd, ['add', '-A', '--', ...safe])
  })

  registerHandlerWithSchema('ipc:gitBoard.unstage', pathsSchema, async ({ cwd, paths }) => {
    const repo = await authorized(cwd)
    const safe = safePaths(paths)
    if (!repo.ok || !safe) return { ok: false, error: repo.ok ? 'invalid_path' : repo.error }
    const head = await git(repo.cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    return git(repo.cwd, unstageArgs(head.ok, safe))
  })

  registerHandlerWithSchema('ipc:gitBoard.stagePatch', partialSchema, async ({ cwd, path, hunks }) => {
    const repo = await authorized(cwd)
    if (!repo.ok || !SAFE_PATH.test(path)) return { ok: false, error: 'invalid_path' }
    const staged = await stageSelectedHunks(repo.cwd, path, hunks)
    recordGitCommand({ time: Math.floor(Date.now() / 1000), command: `git apply --cached -- ${path}`, repo: repo.cwd, success: staged.ok, output: staged.ok ? '' : staged.error })
    return staged.ok ? { ok: true, stdout: staged.stdout } : staged
  })

  registerHandlerWithSchema('ipc:gitBoard.commit', commitActionSchema, async ({ cwd, message, paths, action }) => {
    const repo = await authorized(cwd)
    const safe = safePaths(paths)
    if (!repo.ok || !safe) return { ok: false, error: repo.ok ? 'invalid_path' : repo.error }
    if (action === 'commit-and-push') {
      const staged = await git(repo.cwd, ['add', '-A'])
      if (!staged.ok) return staged
    } else if (action === 'stage-and-commit') {
      const cached = await git(repo.cwd, ['diff', '--cached', '--name-only'])
      if (!cached.ok) return cached
      if (!cached.stdout.trim()) {
        const staged = await git(repo.cwd, ['add', '-A'])
        if (!staged.ok) return staged
      }
    } else if (safe.length) {
      const staged = await git(repo.cwd, ['add', '--', ...safe])
      if (!staged.ok) return staged
    }
    const committed = await git(repo.cwd, ['commit', '-m', message])
    if (!committed.ok || action !== 'commit-and-push') return committed
    const status = await git(repo.cwd, ['status', '--porcelain=v2', '-b'])
    if (!status.ok) return status
    const upstream = status.stdout.match(/^# branch\.upstream (.+)$/m)?.[1]
    if (upstream) return git(repo.cwd, ['push'])
    const branch = status.stdout.match(/^# branch\.head (.+)$/m)?.[1]
    const remote = branch ? safeRef(branch) : null
    if (!remote) return { ok: false, error: 'detached_head' }
    const remotes = await git(repo.cwd, ['remote'])
    const remoteName = remotes.ok ? safeRef(remotes.stdout.split(/\r?\n/).find(Boolean) || '') : null
    return remoteName ? git(repo.cwd, ['push', '-u', remoteName, remote]) : { ok: false, error: 'no_remote' }
  })

  registerHandlerWithSchema('ipc:gitBoard.suggestCommit', cwdSchema.extend({ prompt: z.string().trim().max(8000).optional() }), async ({ cwd, prompt }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    const diff = runGit(repo.cwd, ['diff', '--cached', '--stat', '--patch', '--', '.'], { maxBuffer: 300_000 })
    const source = diff.ok && diff.stdout.trim() ? diff : runGit(repo.cwd, ['diff', '--stat', '--patch'], { maxBuffer: 300_000 })
    if (!source.ok || !source.stdout.trim()) return { ok: false, error: 'no_changes' }
    return completeWithPluginModel({ system: prompt || COMMIT_PROMPT, user: source.stdout.slice(0, 80_000), maxTokens: 1500, temperature: 0.2 })
  })

  registerHandlerWithSchema('ipc:gitBoard.sync', z.object({ cwd: z.string().min(1), action: z.enum(['fetch', 'pull', 'push']) }).strict(), async ({ cwd, action }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    const args = action === 'fetch' ? ['fetch', '--prune'] : action === 'pull' ? ['pull', '--no-edit'] : ['push']
    return git(repo.cwd, args)
  })

  registerHandlerWithSchema('ipc:gitBoard.branch', z.object({ cwd: z.string().min(1), action: z.enum(['create', 'rename', 'delete', 'track']), name: z.string().trim().min(1).max(250), from: z.string().trim().max(250).optional(), force: z.boolean().optional() }).strict(), async ({ cwd, action, name, from, force }) => {
    const repo = await authorized(cwd)
    const target = safeRef(name)
    const source = from ? safeRef(from) : null
    if (!repo.ok || !target || (from && !source)) return { ok: false, error: 'invalid_ref' }
    if (action === 'create') return git(repo.cwd, source ? ['checkout', '-b', target, source] : ['checkout', '-b', target])
    if (action === 'rename') return source ? git(repo.cwd, ['branch', '-m', source, target]) : { ok: false, error: 'invalid_ref' }
    if (action === 'track') return source ? git(repo.cwd, ['checkout', '-b', target, '--track', source]) : { ok: false, error: 'invalid_ref' }
    const head = await git(repo.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (head.ok && head.stdout.trim() === target) return { ok: false, error: 'current_branch' }
    return git(repo.cwd, ['branch', force ? '-D' : '-d', target])
  })

  registerHandlerWithSchema('ipc:gitBoard.merge', mergeSchema, async ({ cwd, ref, noFf }) => {
    const repo = await authorized(cwd)
    const target = safeRef(ref)
    if (!repo.ok || !target) return { ok: false, error: 'invalid_ref' }
    return git(repo.cwd, ['merge', ...(noFf ? ['--no-ff'] : []), '--no-edit', target])
  })

  registerHandlerWithSchema('ipc:gitBoard.rebase', refSchema, async ({ cwd, ref }) => {
    const repo = await authorized(cwd)
    const target = safeRef(ref)
    if (!repo.ok || !target) return { ok: false, error: 'invalid_ref' }
    return git(repo.cwd, ['rebase', target])
  })

  registerHandlerWithSchema('ipc:gitBoard.cherryPick', refSchema, async ({ cwd, ref }) => {
    const repo = await authorized(cwd)
    const target = safeRef(ref)
    if (!repo.ok || !target) return { ok: false, error: 'invalid_ref' }
    return git(repo.cwd, ['cherry-pick', target])
  })

  registerHandlerWithSchema('ipc:gitBoard.operation', z.object({ cwd: z.string().min(1), operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert']), action: z.enum(['continue', 'abort']) }).strict(), async ({ cwd, operation, action }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    return git(repo.cwd, ['-c', 'core.editor=true', '-c', 'sequence.editor=true', operation, `--${action}`])
  })

  registerHandlerWithSchema('ipc:gitBoard.stash', z.object({ cwd: z.string().min(1), action: z.enum(['list', 'save', 'pop', 'apply', 'drop']), message: z.string().max(500).optional(), ref: z.string().max(100).optional(), includeUntracked: z.boolean().optional() }).strict(), async ({ cwd, action, message, ref, includeUntracked }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    if (action === 'list') return git(repo.cwd, ['stash', 'list', '--format=%gd%x1f%gs'])
    if (action === 'save') return git(repo.cwd, ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), ...(message?.trim() ? ['-m', message.trim()] : [])])
    const selector = ref?.trim() || 'stash@{0}'
    if (!/^stash@\{\d+\}$/.test(selector)) return { ok: false, error: 'invalid_ref' }
    return git(repo.cwd, ['stash', action === 'pop' ? 'pop' : action, selector])
  })

  registerHandlerWithSchema('ipc:gitBoard.tag', z.object({ cwd: z.string().min(1), action: z.enum(['list', 'create', 'delete', 'push']), name: z.string().max(250).optional(), target: z.string().max(300).optional(), message: z.string().max(1000).optional(), remote: z.string().max(100).optional() }).strict(), async ({ cwd, action, name, target, message, remote }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    if (action === 'list') return git(repo.cwd, ['tag', '--sort=-creatordate'])
    const tag = name ? safeRef(name) : null
    const at = target ? safeRef(target) : null
    const remoteName = remote ? safeRef(remote) : 'origin'
    if (!tag || (target && !at) || !remoteName) return { ok: false, error: 'invalid_ref' }
    if (action === 'create') return git(repo.cwd, message?.trim() ? ['tag', '-a', tag, ...(at ? [at] : []), '-m', message.trim()] : ['tag', tag, ...(at ? [at] : [])])
    if (action === 'delete') return git(repo.cwd, ['tag', '-d', tag])
    return git(repo.cwd, ['push', remoteName, tag])
  })

  registerHandlerWithSchema('ipc:gitBoard.worktree', z.object({ cwd: z.string().min(1), action: z.enum(['list', 'add', 'remove']), path: z.string().max(1000).optional(), branch: z.string().max(250).optional(), create: z.boolean().optional() }).strict(), async ({ cwd, action, path, branch, create }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    if (action === 'list') return git(repo.cwd, ['worktree', 'list', '--porcelain'])
    if (!path?.trim()) return { ok: false, error: 'invalid_path' }
    const ref = branch ? safeRef(branch) : null
    if (branch && !ref) return { ok: false, error: 'invalid_ref' }
    if (action === 'add') return git(repo.cwd, ['worktree', 'add', ...(create && ref ? ['-b', ref] : []), path, ...(!create && ref ? [ref] : [])])
    const removed = await git(repo.cwd, ['worktree', 'remove', path])
    return removed.ok ? removed : git(repo.cwd, ['worktree', 'remove', '--force', path])
  })

  registerHandlerWithSchema('ipc:gitBoard.diff', z.object({ cwd: z.string().min(1), path: z.string().min(1), staged: z.boolean().optional(), commit: z.string().max(100).optional() }).strict(), async ({ cwd, path, staged, commit }) => {
    const repo = await authorized(cwd)
    if (!repo.ok || !SAFE_PATH.test(path)) return { ok: false, error: 'invalid_path' }
    if (commit && !/^[0-9a-f]{7,64}$/i.test(commit)) return { ok: false, error: 'invalid_ref' }
    const args = commit ? ['show', '--format=', commit, '--', path] : ['diff', ...(staged ? ['--cached'] : []), '--', path]
    return git(repo.cwd, args)
  })

  registerHandlerWithSchema('ipc:gitBoard.init', cwdSchema, async ({ cwd }) => {
    const project = authorizeProjectCwd(cwd)
    if (!project.ok) return project
    if (isGitRepository(project.cwd)) return { ok: false, error: 'already_repo' }
    return git(project.cwd, ['init', '-b', 'main'])
  })

  registerHandlerWithSchema('ipc:gitBoard.clone', z.object({ cwd: z.string().min(1), url: z.string().trim().min(1).max(1000), path: z.string().trim().min(1).max(1000) }).strict(), async ({ cwd, url, path }) => {
    const project = authorizeProjectCwd(cwd)
    if (!project.ok) return project
    const source = sanitizeCloneUrl(url)
    if (!source) return { ok: false, error: 'invalid_url' }
    const target = resolve(path)
    const parent = dirname(target)
    const parentInfo = await stat(parent).catch(() => null)
    if (!parentInfo?.isDirectory()) return { ok: false, error: 'invalid_path' }
    const existing = await readdir(target).catch(() => null)
    if (existing && existing.length) return { ok: false, error: 'target_not_empty' }
    const cloned = await git(parent, ['-c', 'credential.helper=', 'clone', '--', source, target])
    return cloned.ok ? { ...cloned, path: target, name: basename(target) } : cloned
  })

  registerHandlerWithSchema('ipc:gitBoard.exclude', pathsSchema, async ({ cwd, paths }) => {
    const repo = await authorized(cwd)
    const safe = safePaths(paths)
    if (!repo.ok || !safe) return { ok: false, error: 'invalid_path' }
    const metadata = await git(repo.cwd, ['rev-parse', '--absolute-git-dir'])
    if (!metadata.ok) return metadata
    const infoDir = resolve(metadata.stdout.trim(), 'info')
    const excludeFile = resolve(infoDir, 'exclude')
    await mkdir(infoDir, { recursive: true })
    const current = await readFile(excludeFile, 'utf8').catch(() => '')
    const rules = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    for (const path of safe) {
      const absolute = resolve(repo.cwd, path)
      const relativePath = relative(repo.cwd, absolute)
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.split(sep).includes('..')) return { ok: false, error: 'invalid_path' }
      const info = await stat(absolute).catch(() => null)
      rules.add(relativePath.split(sep).join('/') + (info?.isDirectory() ? '/' : ''))
    }
    await writeFile(excludeFile, `${[...rules].join('\n')}\n`, 'utf8')
    return { ok: true, stdout: '' }
  })

  registerHandlerWithSchema('ipc:gitBoard.log', z.object({ cwd: z.string().min(1), limit: z.number().int().min(1).max(200).optional() }).strict(), async ({ cwd, limit }) => {
    const repo = await authorized(cwd)
    return repo.ok ? { ok: true, entries: gitCommandLog(limit || 200, repo.cwd) } : repo
  })
  registerHandlerWithSchema('ipc:gitBoard.clearLog', cwdSchema, async ({ cwd }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    clearGitCommandLog(repo.cwd)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:gitBoard.stageAll', cwdSchema, async ({ cwd }) => {
    const repo = await authorized(cwd)
    return repo.ok ? git(repo.cwd, ['add', '-A']) : repo
  })

  registerHandlerWithSchema('ipc:gitBoard.unstageAll', cwdSchema, async ({ cwd }) => {
    const repo = await authorized(cwd)
    if (!repo.ok) return repo
    const head = await git(repo.cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    return git(repo.cwd, unstageArgs(head.ok))
  })

  registerHandlerWithSchema('ipc:gitBoard.checkout', refSchema, async ({ cwd, ref }) => {
    const repo = await authorized(cwd)
    const target = safeRef(ref)
    return repo.ok && target ? git(repo.cwd, ['checkout', target]) : { ok: false, error: 'invalid_ref' }
  })

  registerHandlerWithSchema('ipc:gitBoard.revert', refSchema, async ({ cwd, ref }) => {
    const repo = await authorized(cwd)
    if (!repo.ok || !/^[0-9a-f]{7,64}$/i.test(ref)) return { ok: false, error: 'invalid_ref' }
    return git(repo.cwd, ['revert', '--no-edit', ref])
  })

  registerHandlerWithSchema('ipc:gitBoard.reset', z.object({ cwd: z.string().min(1), hash: z.string().min(7).max(64), mode: z.enum(['soft', 'mixed', 'hard']) }).strict(), async ({ cwd, hash, mode }) => {
    const repo = await authorized(cwd)
    if (!repo.ok || !/^[0-9a-f]{7,64}$/i.test(hash)) return { ok: false, error: 'invalid_ref' }
    return git(repo.cwd, ['reset', `--${mode}`, hash])
  })

  registerHandlerWithSchema('ipc:gitBoard.discard', z.object({ cwd: z.string().min(1), tracked: z.array(z.string().min(1)).max(5000).optional(), untracked: z.array(z.string().min(1)).max(5000).optional() }).strict(), async ({ cwd, tracked, untracked }) => {
    const repo = await authorized(cwd)
    const trackedPaths = safePaths(tracked)
    const untrackedPaths = safePaths(untracked)
    if (!repo.ok || !trackedPaths || !untrackedPaths || trackedPaths.length + untrackedPaths.length === 0) return { ok: false, error: 'invalid_path' }
    const discarded = await discardGitChanges(repo.cwd, trackedPaths, untrackedPaths)
    recordGitCommand({ time: Math.floor(Date.now() / 1000), command: `discard ${[...trackedPaths, ...untrackedPaths].join(' ')}`, repo: repo.cwd, success: discarded.ok, output: discarded.ok ? '' : discarded.error })
    return discarded.ok ? { ok: true, stdout: discarded.stdout } : discarded
  })

  registerHandlerWithSchema('ipc:gitBoard.resolve', z.object({ cwd: z.string().min(1), paths: z.array(z.string().min(1)).min(1).max(5000), side: z.enum(['ours', 'theirs']) }).strict(), async ({ cwd, paths, side }) => {
    const repo = await authorized(cwd)
    const safe = safePaths(paths)
    if (!repo.ok || !safe) return { ok: false, error: 'invalid_path' }
    const checked = await git(repo.cwd, ['checkout', `--${side}`, '--', ...safe])
    return checked.ok ? git(repo.cwd, ['add', '--', ...safe]) : checked
  })

  registerHandlerWithSchema('ipc:gitBoard.remote', z.object({ cwd: z.string().min(1), action: z.enum(['add', 'remove', 'setUrl', 'rename', 'publish', 'deleteBranch']), name: z.string().min(1).max(250), url: z.string().max(1000).optional(), to: z.string().max(250).optional(), branch: z.string().max(250).optional() }).strict(), async ({ cwd, action, name, url, to, branch }) => {
    const repo = await authorized(cwd)
    const remote = safeRef(name)
    const next = to ? safeRef(to) : null
    const ref = branch ? safeRef(branch) : null
    if (!repo.ok || !remote || (to && !next) || (branch && !ref)) return { ok: false, error: 'invalid_ref' }
    if (action === 'add') return url?.trim() ? git(repo.cwd, ['remote', 'add', remote, url.trim()]) : { ok: false, error: 'invalid_url' }
    if (action === 'remove') return git(repo.cwd, ['remote', 'remove', remote])
    if (action === 'setUrl') return url?.trim() ? git(repo.cwd, ['remote', 'set-url', remote, url.trim()]) : { ok: false, error: 'invalid_url' }
    if (action === 'rename') return next ? git(repo.cwd, ['remote', 'rename', remote, next]) : { ok: false, error: 'invalid_ref' }
    if (action === 'publish') return ref ? git(repo.cwd, ['push', '-u', remote, ref]) : { ok: false, error: 'invalid_ref' }
    return ref ? git(repo.cwd, ['push', remote, '--delete', ref]) : { ok: false, error: 'invalid_ref' }
  })

  registerHandlerWithSchema('ipc:gitBoard.commitDetail', refSchema, async ({ cwd, ref }) => {
    const repo = await authorized(cwd)
    if (!repo.ok || !/^[0-9a-f]{7,64}$/i.test(ref)) return { ok: false, error: 'invalid_ref' }
    const meta = await git(repo.cwd, ['show', '-s', '--format=%s%x1f%b%x1f%an%x1f%ae%x1f%at%x1f%P', ref])
    const files = await git(repo.cwd, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', ref])
    if (!meta.ok || !files.ok) return meta.ok ? files : meta
    const [subject, body, author, email, time, parents] = meta.stdout.split('\x1f')
    return {
      ok: true,
      subject,
      body: body || '',
      author,
      email,
      time: Number(time) || 0,
      parents: (parents || '').trim().split(/\s+/).filter(Boolean),
      files: files.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        const [status, path] = line.split('\t')
        return path ? [{ status, path }] : []
      }),
    }
  })
}

function parseBranchRefs(stdout: string, currentBranch: string) {
  return stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [refname, name, hash, short, upstream, track, subject] = line.split('\0')
    if (!name || name.endsWith('/HEAD') || (!refname.startsWith('refs/heads/') && !refname.startsWith('refs/remotes/'))) return []
    return [{
      name,
      kind: refname.startsWith('refs/heads/') ? 'local' as const : 'remote' as const,
      current: refname.startsWith('refs/heads/') && name === currentBranch,
      hash,
      short,
      upstream: upstream || null,
      ahead: Number(track?.match(/ahead (\d+)/)?.[1] || 0),
      behind: Number(track?.match(/behind (\d+)/)?.[1] || 0),
      subject: subject || '',
    }]
  })
}

async function gitOperation(cwd: string): Promise<'merge' | 'rebase' | 'cherry-pick' | 'revert' | null> {
  const checks: Array<['merge' | 'rebase' | 'cherry-pick' | 'revert', string]> = [
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

