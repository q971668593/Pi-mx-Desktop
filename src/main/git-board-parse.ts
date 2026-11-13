export type GitChange = {
  staged: string
  unstaged: string
  path: string
  originalPath?: string
  group: 'conflict' | 'staged' | 'unstaged' | 'untracked'
}

export type GitBranchRow = {
  name: string
  current: boolean
  hash: string
  upstream: string | null
  ahead: number
  behind: number
  subject: string
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function splitFields(token: string, count: number): [string[], string] | null {
  const fields: string[] = []
  let rest = token
  for (let index = 0; index < count; index += 1) {
    const at = rest.indexOf(' ')
    if (at < 0) return null
    fields.push(rest.slice(0, at))
    rest = rest.slice(at + 1)
  }
  return [fields, rest]
}

export function parseStatusV2(raw: string): GitChange[] {
  const tokens = raw.split('\0')
  const files: GitChange[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token || token.startsWith('# ')) continue
    if (token.startsWith('? ')) {
      files.push({ staged: '?', unstaged: '?', path: token.slice(2), group: 'untracked' })
      continue
    }
    const kind = token[0]
    const fields = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : 0
    const split = fields ? splitFields(token, fields) : null
    if (!split) continue
    const originalPath = kind === '2' ? tokens[++index] : ''
    const code = split[0][1] || '..'
    const staged = code[0] || '.'
    const unstaged = code[1] || '.'
    const conflict = kind === 'u' || CONFLICT.has(`${staged}${unstaged}`) || staged === 'U' || unstaged === 'U'
    const group = conflict ? 'conflict' : staged !== '.' && staged !== '?' ? 'staged' : 'unstaged'
    files.push({ staged, unstaged, path: split[1], ...(originalPath ? { originalPath } : {}), group })
  }
  return files
}

export function parseStatus(stdout: string): {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  files: GitChange[]
} {
  let branch = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const files: GitChange[] = []
  for (const line of stdout.split(/[\0\r\n]+/).filter(Boolean)) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      if (head && head !== '(detached)') branch = head
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim() || null
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/)
      ahead = Number(match?.[1] || 0)
      behind = Number(match?.[2] || 0)
      continue
    }
    if (line.startsWith('## ')) {
      const [left, tracking] = line.slice(3).split('...')
      branch = left.trim()
      if (tracking) {
        const match = tracking.match(/^(\S+?)(?:\s+\[(.*)\])?$/)
        upstream = match?.[1] || null
        const extra = match?.[2] || ''
        ahead = Number(extra.match(/ahead (\d+)/)?.[1] || 0)
        behind = Number(extra.match(/behind (\d+)/)?.[1] || 0)
      }
      continue
    }
    if (line.length < 4 || line[2] !== ' ') continue
    const staged = line[0]
    const unstaged = line[1]
    const code = `${staged}${unstaged}`
    const group = code === '??'
      ? 'untracked'
      : CONFLICT.has(code) || staged === 'U' || unstaged === 'U'
        ? 'conflict'
        : staged !== ' ' && staged !== '?'
          ? 'staged'
          : 'unstaged'
    files.push({ staged, unstaged, path: line.slice(3), group })
  }
  return { branch, upstream, ahead, behind, files }
}

export type DiffHunk = { header: string; body: string[] }

export function parseDiffHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  for (const line of patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current)
      current = { header: line, body: [] }
    } else if (current && line !== '\\ No newline at end of file') current.body.push(line)
  }
  if (current) hunks.push(current)
  return hunks
}

function recount(header: string, body: string[]): string {
  const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
  if (!match) return header
  const oldCount = body.filter((line) => line.startsWith('-') || line.startsWith(' ')).length
  const newCount = body.filter((line) => line.startsWith('+') || line.startsWith(' ')).length
  return `@@ -${match[1]},${oldCount} +${match[2]},${newCount} @@${match[3]}`
}

export function selectedHunkPatch(path: string, patch: string, headers: string[]): string | null {
  const wanted = new Set(headers)
  const hunks = parseDiffHunks(patch).filter((hunk) => wanted.has(hunk.header))
  if (!hunks.length || hunks.length !== wanted.size) return null
  const normalized = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const header = normalized.split("\n@@", 1)[0].split("\n").filter((line) => line.trim() && !line.startsWith("index "))
  const fallback = [
    "diff --git a/" + path + " b/" + path,
    "--- a/" + path,
    "+++ b/" + path,
  ]
  const lines = header.some((line) => line.startsWith("diff --git ")) ? header : fallback
  for (const hunk of hunks) lines.push(recount(hunk.header, hunk.body), ...hunk.body.filter((line, index, body) => index < body.length - 1 || line !== ''))
  return lines.join("\n") + "\n"
}

export type GitCommandLog = { time: number; command: string; repo: string; success: boolean; output: string }

export type GitCommandLogStore = {
  load: () => GitCommandLog[]
  save: (entries: GitCommandLog[]) => void
}

const commandLog: GitCommandLog[] = []
let commandLogLoaded = false
let commandLogStore: GitCommandLogStore | null = null

function ensureCommandLog(): void {
  if (commandLogLoaded) return
  commandLogLoaded = true
  if (!commandLogStore) return
  try {
    commandLog.push(...commandLogStore.load().filter(isCommandLog).slice(-200))
  } catch {
    commandLog.length = 0
  }
}

function isCommandLog(value: unknown): value is GitCommandLog {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<GitCommandLog>
  return typeof entry.time === 'number' && typeof entry.command === 'string' && typeof entry.repo === 'string' && typeof entry.success === 'boolean' && typeof entry.output === 'string'
}

export function configureGitCommandLog(store: GitCommandLogStore): void {
  commandLogStore = store
  commandLogLoaded = false
  commandLog.length = 0
}

export function resetGitCommandLogForTests(): void {
  commandLogStore = null
  commandLogLoaded = true
  commandLog.length = 0
}

export function recordGitCommand(entry: GitCommandLog): void {
  ensureCommandLog()
  commandLog.push(entry)
  if (commandLog.length > 200) commandLog.splice(0, commandLog.length - 200)
  commandLogStore?.save(commandLog)
}

export function gitCommandLog(limit = 200, repo?: string): GitCommandLog[] {
  ensureCommandLog()
  const normalize = (path: string) => process.platform === 'win32' ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : path.replace(/\/$/, '')
  return commandLog.filter((entry) => !repo || normalize(entry.repo) === normalize(repo)).slice(-Math.max(0, limit)).reverse()
}

export function clearGitCommandLog(repo?: string): void {
  ensureCommandLog()
  if (!repo) commandLog.length = 0
  else {
    const normalize = (path: string) => process.platform === 'win32' ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : path.replace(/\/$/, '')
    for (let index = commandLog.length - 1; index >= 0; index--) if (normalize(commandLog[index].repo) === normalize(repo)) commandLog.splice(index, 1)
  }
  commandLogStore?.save(commandLog)
}

const QUIET_GIT_COMMANDS = new Set(['status', 'log', 'show', 'diff', 'diff-tree', 'for-each-ref', 'rev-parse', 'rev-list', 'ls-files'])

function gitWords(args: string[]): string[] {
  const words: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') break
    if (arg === '-c' || arg === '--config') {
      index += 1
      continue
    }
    if (!arg.startsWith('-')) words.push(arg)
  }
  return words
}

/** Read-only probes stay out of the command log; only repository changes are recorded. */
export function isLoggedGitCommand(args: string[]): boolean {
  const [command, action] = gitWords(args)
  if (!command || QUIET_GIT_COMMANDS.has(command)) return false
  if (command === 'stash') return action !== 'list' && action != null
  if (command === 'remote') return action != null
  if (command === 'worktree') return action !== 'list'
  if (command === 'tag') return args.some((arg) => ['-d', '-a', '-m', '-s'].includes(arg)) || action != null
  if (command === 'branch') return args.some((arg) => ['-d', '-D', '-m', '-M', '-u'].includes(arg)) || action != null
  return true
}

function trimCloneQuotes(value: string): string {
  return value.trim().replace(/^["']+/, '').replace(/["']+$/, '').trim()
}

function stripCloneWords(value: string, words: string[]): string | null {
  let rest = value
  for (const word of words) {
    rest = rest.replace(/^\s+/, '')
    if (rest.length < word.length || rest.slice(0, word.length).toLowerCase() !== word.toLowerCase()) return null
    const tail = rest.slice(word.length)
    if (tail && !/^\s/.test(tail)) return null
    rest = tail
  }
  return rest
}

/** Accept a pasted `git clone <url>` while rejecting option-like values. */
export function sanitizeCloneUrl(value: string): string | null {
  let url = trimCloneQuotes(value)
  for (;;) {
    const rest = stripCloneWords(url, ['git', 'clone'])
    if (rest == null) break
    const cleaned = trimCloneQuotes(rest)
    if (!cleaned) return null
    url = cleaned
  }
  if (!url || /^[-\s]|[\r\n\0]/.test(url)) return null
  if (/^(?:git|clone)$/i.test(url)) return null
  return url
}

/** Before the first commit there is no HEAD, so staged paths leave the index directly. */
export function unstageArgs(hasHead: boolean, paths?: string[]): string[] {
  if (hasHead) return paths?.length ? ['restore', '--staged', '--', ...paths] : ['restore', '--staged', '.']
  return paths?.length ? ['rm', '--cached', '-r', '--quiet', '--', ...paths] : ['rm', '--cached', '-r', '--quiet', '.']
}

export function parseBranches(stdout: string): GitBranchRow[] {
  return stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const current = line.startsWith('*')
    const body = line.replace(/^\*?\s+/, '')
    if (body.startsWith('(')) return []
    const match = body.match(/^(\S+)\s+([0-9a-f]+)\s*(?:\[(.*?)\])?\s*(.*)$/i)
    if (!match || match[1].includes('->')) return []
    const bracket = match[3] || ''
    const upstream = bracket.split(':')[0]?.trim() || null
    return [{
      name: match[1],
      current,
      hash: match[2],
      upstream: upstream && upstream !== 'gone' ? upstream : null,
      ahead: Number(bracket.match(/ahead (\d+)/)?.[1] || 0),
      behind: Number(bracket.match(/behind (\d+)/)?.[1] || 0),
      subject: match[4] || '',
    }]
  })
}

export function parseStashes(stdout: string): Array<{ ref: string; message: string }> {
  return stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [ref, message = ''] = line.split('\x1f')
    return /^stash@\{\d+\}$/.test(ref) ? [{ ref, message }] : []
  })
}

export function parseRemotes(stdout: string): Array<{ name: string; fetch: string; push: string }> {
  const map = new Map<string, { name: string; fetch: string; push: string }>()
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!match) continue
    const item = map.get(match[1]) || { name: match[1], fetch: '', push: '' }
    item[match[3] as 'fetch' | 'push'] = match[2]
    map.set(match[1], item)
  }
  return [...map.values()]
}

export function parseWorktrees(stdout: string): Array<{ path: string; head: string; branch: string | null }> {
  return stdout.split(/\r?\n\r?\n/).flatMap((block) => {
    const path = block.match(/^worktree (.+)$/m)?.[1] || ''
    if (!path) return []
    return [{
      path,
      head: block.match(/^HEAD (.+)$/m)?.[1] || '',
      branch: block.match(/^branch (.+)$/m)?.[1]?.replace(/^refs\/heads\//, '') || null,
    }]
  })
}

export function parseTags(stdout: string): string[] {
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}
