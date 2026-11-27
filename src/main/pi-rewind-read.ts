/**
 * Read pi-rewind git checkpoints (bounded — avoid N×git on main thread).
 */
import { runGit } from './git-workspace'

const REF_PREFIX = 'refs/pi-checkpoints/'
const MAX_CHECKPOINTS = 24

export type RewindCheckpointRow = {
  id: string
  sessionId: string
  trigger: string
  turnIndex: number
  toolName?: string
  description?: string
  branch: string
  timestamp: number
  worktreeTreeSha: string
}

function parseCommitMessage(msg: string, refName: string): RewindCheckpointRow | null {
  const get = (key: string) => msg.match(new RegExp(`^${key} (.+)$`, 'm'))?.[1]?.trim()
  const sid = get('sessionId')
  const turn = get('turn')
  const wt = get('worktree-tree')
  if (!sid || !turn || !wt) return null
  const created = get('created')
  return {
    id: refName,
    sessionId: sid,
    trigger: get('trigger') || 'turn',
    turnIndex: parseInt(turn, 10),
    toolName: get('toolName'),
    description: get('description'),
    branch: get('branch') || 'unknown',
    timestamp: created ? new Date(created).getTime() : 0,
    worktreeTreeSha: wt,
  }
}

/** List recent checkpoints; caps count and uses one batch cat-file when possible. */
export function listRewindCheckpoints(cwd: string, sessionId?: string): RewindCheckpointRow[] {
  const listR = runGit(
    cwd,
    ['for-each-ref', '--format=%(refname)', 'refs/pi-checkpoints', '--sort=-committerdate'],
    { timeout: 8000 },
  )
  if (!listR.ok) return []

  const refs = listR.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(REF_PREFIX))
    .map((line) => line.slice(REF_PREFIX.length))
    .slice(0, MAX_CHECKPOINTS)

  if (refs.length === 0) return []

  // Batch: rev-parse all SHAs in one call
  const verifyArgs = refs.map((r) => `${REF_PREFIX}${r}`).join(' ')
  const revR = runGit(cwd, ['rev-parse', ...verifyArgs.split(' ').filter(Boolean)], { timeout: 8000 })
  if (!revR.ok) return []
  const shas = revR.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  if (shas.length !== refs.length) return []

  // Batch: 一次 git log 批量读取所有 checkpoint 的 commit 正文，避免循环 24 次起子进程阻塞主线程。
  const shaToRef = new Map<string, string>()
  for (let i = 0; i < shas.length; i++) shaToRef.set(shas[i], refs[i])
  const out: RewindCheckpointRow[] = []
  const batch = runGit(cwd, ['log', '--no-walk=unsorted', '--format=%H%x1f%B%x1e', ...shas], {
    timeout: 6000,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (batch.ok) {
    for (const record of batch.stdout.split('\x1e')) {
      const trimmed = record.trim()
      if (!trimmed) continue
      const sep = trimmed.indexOf('\x1f')
      if (sep <= 0) continue
      const sha = trimmed.slice(0, sep).trim()
      const body = trimmed.slice(sep + 1)
      const ref = shaToRef.get(sha)
      if (!ref) continue
      const row = parseCommitMessage(body, ref)
      if (!row) continue
      if (sessionId && row.sessionId !== sessionId) continue
      out.push(row)
    }
  }
  out.sort((a, b) => b.timestamp - a.timestamp)
  return out
}