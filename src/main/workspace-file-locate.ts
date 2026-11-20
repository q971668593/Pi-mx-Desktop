/**
 * 按「相对短路径」找回工作区里的真实文件。
 *
 * 会话里出现的图片/附件引用常常是相对**工具 cwd** 的短路径（`honors/honor-1.webp`、
 * `team/group.webp`），按项目根拼出来的路径并不存在，于是缩略图只剩一个灰块。
 * 这里按路径尾巴（多段）在工作区里找唯一匹配：先用 fd 索引（快），没有 fd 就走
 * 有界的目录遍历（深度/条目/时间都有上限，且跳过 node_modules 这类大目录）。
 */
import { existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { primeWorkspaceFileSearchIndex } from './workspace-file-search'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.turbo',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
])

const MAX_ENTRIES = 40_000
const MAX_DEPTH = 10
const MAX_MS = 4_000

function toSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function normalizeRef(value: string): string {
  return toSlashes(value.trim()).replace(/^\.\//, '').replace(/^\/+/, '')
}

/** 候选里挑唯一的那个：完全相等 → 尾巴相等（唯一）→ 只有唯一候选。 */
export function pickLocatedFile(ref: string, candidates: readonly string[]): string | null {
  const usable = candidates.filter(Boolean)
  if (!usable.length) return null
  const target = normalizeRef(ref).toLowerCase()
  const exact = usable.filter((item) => normalizeRef(item).toLowerCase() === target)
  if (exact.length === 1) return exact[0]
  const tail: string[] = []
  for (const item of usable) {
    const normalized = normalizeRef(item).toLowerCase()
    if (target.includes('/') ? normalized.endsWith(`/${target}`) : normalized.split('/').pop() === target) {
      tail.push(item)
    }
  }
  if (tail.length === 1) return tail[0]
  if (tail.length > 1) return null
  return usable.length === 1 ? usable[0] : null
}

async function bfsLocate(workspaceRoot: string, ref: string): Promise<string[]> {
  const target = normalizeRef(ref).toLowerCase()
  const hasSlash = target.includes('/')
  const baseName = hasSlash ? target.split('/').pop()! : target
  const found: string[] = []
  const started = Date.now()
  let seen = 0
  let queue: { dir: string; depth: number }[] = [{ dir: workspaceRoot, depth: 0 }]
  while (queue.length && seen < MAX_ENTRIES && Date.now() - started < MAX_MS && found.length < 5) {
    const next: { dir: string; depth: number }[] = []
    for (const item of queue) {
      let entries
      try {
        entries = await readdir(item.dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        seen += 1
        if (seen >= MAX_ENTRIES) break
        const abs = join(item.dir, entry.name)
        if (entry.isDirectory()) {
          if (item.depth + 1 > MAX_DEPTH || SKIP_DIRS.has(entry.name.toLowerCase())) continue
          next.push({ dir: abs, depth: item.depth + 1 })
          continue
        }
        const lower = entry.name.toLowerCase()
        if (!hasSlash) {
          if (lower === baseName) found.push(abs)
          continue
        }
        if (!lower.endsWith(baseName)) continue
        const rel = toSlashes(abs).toLowerCase()
        if (rel.endsWith(`/${target}`)) found.push(abs)
      }
      if (Date.now() - started > MAX_MS || found.length >= 5) break
    }
    queue = next
  }
  return found
}

/**
 * 把会话里的一段路径解析成工作区内的绝对路径；解析不出来返回 null。
 * `preferSuffix` 为真时允许用「路径尾巴」在多级目录里找（图片引用就是这种）。
 */
export async function locateWorkspaceFile(
  workspaceRoot: string,
  ref: string,
  options: { preferSuffix?: boolean } = {},
): Promise<string | null> {
  const raw = String(ref || '').trim()
  const root = String(workspaceRoot || '').trim()
  if (!raw) return null
  const candidates: string[] = []

  if (isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    candidates.push(raw)
  } else if (root) {
    candidates.push(join(root, normalizeRef(raw)))
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    } catch {
      /* keep looking */
    }
  }
  if (!options.preferSuffix || !root) return null
  if (isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) return null

  // 1) fd 索引：一次遍历、按文件名取候选，再按尾巴消歧
  try {
    const index = await primeWorkspaceFileSearchIndex(root)
    if (index) {
      const base = normalizeRef(raw).split('/').pop()!.toLowerCase()
      const sameName = index
        .filter((entry) => !entry.isDirectory && entry.name.toLowerCase() === base)
        .map((entry) => (toSlashes(entry.path).startsWith(toSlashes(root)) ? entry.path : join(root, entry.path)))
      const picked = pickLocatedFile(raw, sameName)
      if (picked) return picked
    }
  } catch {
    /* 索引不可用：走遍历 */
  }

  // 2) 有界遍历兜底（没有 fd 的机器也能用）
  const found = await bfsLocate(root, raw)
  return pickLocatedFile(raw, found)
}
