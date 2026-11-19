/**
 * Recognize file references in assistant output so the UI can turn them into links.
 *
 * Two shapes matter:
 *  - a whole string that is one path (`D:\w\V1\.docs\对接\清单.xlsx`, `./tools/run.py`, `收件.xlsx`)
 *  - paths inside running text (handled by MarkdownPathText via `findPathSegments`)
 *
 * Deliberately conservative: a bare name only counts when it carries a known extension, so prose
 * like "完成" or a version string never becomes a link.
 */

/** Extensions that are documents, images, archives or code — the ones worth opening. */
const FILE_EXTENSIONS = [
  // documents / data
  'xlsx', 'xlsm', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'pdf', 'md', 'mdx', 'txt', 'rtf', 'csv', 'tsv',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'xml', 'sql', 'db', 'sqlite',
  // images / media
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'mp4', 'mov', 'mp3', 'wav',
  // archives
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz',
  // code
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'css', 'scss', 'less', 'html', 'htm',
  'py', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rb', 'php', 'sh',
  'bash', 'ps1', 'bat', 'cmd', 'lock', 'env',
] as const

const EXTENSION_SET = new Set<string>(FILE_EXTENSIONS)
const MAX_PATH_LENGTH = 512

/** `D:\…`, `C:/…`, `\\server\share\…`, `/home/…`, `~/…`, `./…`, `../…` or a bare `a/b.ext`. */
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/
const SYSTEM_ABSOLUTE = /^[/\\]{1,2}/
const RELATIVE_PREFIX = /^\.{1,2}[\\/]/

/** Quotes, backticks and trailing punctuation that wrap a path rather than belong to it. */
const WRAPPERS = /^[\s`"'“”‘’（(【[]+|[\s`"'“”‘’）)】\]，,。;；:：]+$/gu

export function pathExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const at = name.lastIndexOf('.')
  return at > 0 ? name.slice(at + 1).toLowerCase() : ''
}

export function hasKnownFileExtension(path: string): boolean {
  return EXTENSION_SET.has(pathExtension(path))
}

/** Trim quotes/backticks and trailing sentence punctuation, then drop a `:line[:col]` suffix. */
export function normalizePathCandidate(raw: string): string {
  let value = String(raw ?? '').trim().replace(WRAPPERS, '')
  if (!value) return ''
  // `src/app.ts:12:3` — only strip when an extension came before the line numbers.
  value = value.replace(/^(.+\.[A-Za-z0-9]{1,8})(?::\d+){1,2}$/u, '$1')
  return value
}

/**
 * The path when the whole string is one file reference, otherwise null.
 * Whitespace is allowed inside an explicit absolute/relative path (`2026 - 高新国资上报`).
 */
export function singleFilePath(raw: string): string | null {
  const value = normalizePathCandidate(raw)
  if (!value || value.length > MAX_PATH_LENGTH) return null
  if (/[\r\n]/u.test(value)) return null
  if (/^(?:https?|file|data|javascript):/iu.test(value)) return null
  if (!hasKnownFileExtension(value)) return null
  const explicit = WINDOWS_ABSOLUTE.test(value) || SYSTEM_ABSOLUTE.test(value) || RELATIVE_PREFIX.test(value)
  // Bare names and workspace-relative paths (`src/app.ts`) cannot contain spaces: that is prose.
  if (!explicit && /\s/u.test(value)) return null
  return value
}

export type PathSegment = { kind: 'text'; text: string } | { kind: 'path'; path: string }

/**
 * Split running text into plain text and file references. A reference needs a separator and no
 * whitespace (runs of prose are far more common than paths with spaces), and must end in a known
 * extension; trailing `:line` is included so the caller can jump to it.
 */
export function splitPaths(text: string): PathSegment[] {
  if (!text) return []
  const segments: PathSegment[] = []
  const skip = (start: number, candidate: string): boolean => {
    // Inside a URL: `https://example.com/a.pdf` is a web link, not a workspace file. Any path glued
    // to a word (`com/a.pdf`, `https:/…`) is part of something longer, not a standalone reference.
    const previous = text.slice(0, start).slice(-1)
    if (previous && /[A-Za-z0-9_.\/\\:-]/u.test(previous)) return true
    if (/^\/\/[\w-]+\.[\w.-]+\//u.test(candidate)) return true
    // Package aliases (`@renderer/features/x.ts`) are module specifiers, not workspace files.
    if (candidate.startsWith('@')) return true
    return false
  }
  // One character class for "not a delimiter": keeps Chinese directory names (`.docs/对接/…`).
  // Two literals (absolute / relative) instead of one hand-escaped string: easier to verify.
  const ABSOLUTE = /(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/])[^\s`"'<>|*?（）()【】\[\]{}，。；：、]+?\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?/gu
  const RELATIVE = /[^\s`"'<>|*?（）()【】\[\]{}，。；：、]+?(?:[\\/][^\s`"'<>|*?（）()【】\[\]{}，。；：、]+?)+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?/gu
  const matches: Array<{ start: number; text: string }> = []
  for (const pattern of [ABSOLUTE, RELATIVE]) {
    for (const match of text.matchAll(pattern)) {
      matches.push({ start: match.index ?? 0, text: match[0] })
    }
  }
  // Absolute and relative patterns both match `src/app.ts` (as `src/app.ts` and `/app.ts`); keep the
  // leftmost-longest one instead of letting whichever ran first hide the other.
  matches.sort((left, right) => left.start - right.start || right.text.length - left.text.length)
  const picked: Array<{ start: number; text: string }> = []
  let covered = -1
  for (const match of matches) {
    if (match.start < covered) continue
    picked.push(match)
    covered = match.start + match.text.length
  }
  let last = 0
  for (const { start, text: candidate } of picked) {
    const path = normalizePathCandidate(candidate)
    if (!path || !hasKnownFileExtension(path)) continue
    if (skip(start, candidate)) continue
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) })
    segments.push({ kind: 'path', path })
    last = start + candidate.length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments.length ? segments : [{ kind: 'text', text }]
}
