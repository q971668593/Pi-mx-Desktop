import { errorMessage } from '@shared/error-message'

const API = 'https://api.github.com'
const WEB = 'https://github.com'
const RELEASE_ERROR = '无法读取 GitHub Releases'

export type GhAsset = {
  name?: string
  browser_download_url?: string
  size?: number
}

export type GhRelease = {
  tag_name?: string
  html_url?: string
  body?: string | null
  prerelease?: boolean
  draft?: boolean
  assets?: GhAsset[]
}

export type ReleaseFetch = (input: string, init?: RequestInit) => Promise<Response>

export type GitHubReleaseFetchResult =
  | { ok: true; release: GhRelease & { tag_name: string } }
  | { ok: false; error: string; detail: string }

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pi-desktop',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function webHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/atom+xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'pi-desktop',
  }
}

/** Join attempt details while collapsing a repeated (identical) failure. */
function joinDetail(first: string, second: string): string {
  if (!first) return second
  if (!second || first === second) return first
  return `${first} ${second}`
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code) || 32))
    .replace(/&amp;/g, '&')
}

/** Release body from the Atom feed is escaped HTML; turn it into readable plain text. */
export function htmlToPlainText(html: string): string {
  const text = decodeXmlEntities(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type AtomEntry = { tag: string; url: string; body: string }

export function parseAtomEntries(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = []
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(String(xml || ''))) !== null) {
    const chunk = match[1]
    const idMatch = chunk.match(/<id>([\s\S]*?)<\/id>/i)
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const linkMatch = chunk.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)
    const contentMatch = chunk.match(/<content[^>]*>([\s\S]*?)<\/content>/i)
    const idParts = String(idMatch?.[1] || '')
      .trim()
      .split('/')
    const tag = (idParts[idParts.length - 1] || decodeXmlEntities(String(titleMatch?.[1] || ''))).trim()
    if (!tag) continue
    entries.push({
      tag,
      url: decodeXmlEntities(String(linkMatch?.[1] || '')) || `${WEB}`,
      body: contentMatch ? htmlToPlainText(String(contentMatch[1])) : '',
    })
  }
  return entries
}

/** `v0.5.0-beta.1` style tags are prereleases the atom feed does not flag explicitly. */
export function isPrereleaseTag(tag: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(String(tag).trim().replace(/^v/i, ''))
}

/** Asset anchors rendered by GitHub's lazy "expanded_assets" fragment. */
export function parseAssetLinks(html: string): GhAsset[] {
  const out: GhAsset[] = []
  const seen = new Set<string>()
  const pattern = /href="([^"]*\/releases\/download\/[^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(String(html || ''))) !== null) {
    const href = decodeXmlEntities(match[1])
    if (seen.has(href)) continue
    seen.add(href)
    const fileName = href.split('/').pop() || ''
    if (!fileName) continue
    let name = fileName
    try {
      name = decodeURIComponent(fileName)
    } catch {
      /* keep raw segment */
    }
    out.push({
      name,
      browser_download_url: href.startsWith('http') ? href : `${WEB}${href}`,
      size: 0,
    })
  }
  return out
}

async function fetchAssetsViaWeb(
  slug: string,
  tag: string,
  fetch: ReleaseFetch,
  signal: AbortSignal,
): Promise<GhAsset[]> {
  try {
    const response = await fetch(
      `${WEB}/${slug}/releases/expanded_assets/${encodeURIComponent(tag)}`,
      { headers: webHeaders(), signal },
    )
    if (!response.ok) return []
    return parseAssetLinks(await response.text())
  } catch {
    // The release itself is still usable; the UI can open the release page instead.
    return []
  }
}

async function fetchViaWeb(
  slug: string,
  fetch: ReleaseFetch,
  signal: AbortSignal,
  includePrerelease: boolean,
): Promise<GitHubReleaseFetchResult> {
  const response = await fetch(`${WEB}/${slug}/releases.atom`, {
    headers: webHeaders(),
    signal,
  })
  if (!response.ok) {
    return { ok: false, error: RELEASE_ERROR, detail: `atom_http_${response.status}` }
  }
  const entries = parseAtomEntries(await response.text())
  if (entries.length === 0) return { ok: false, error: RELEASE_ERROR, detail: 'no_release' }
  const entry = includePrerelease
    ? entries[0]
    : (entries.find((row) => !isPrereleaseTag(row.tag)) ?? entries[0])
  const assets = await fetchAssetsViaWeb(slug, entry.tag, fetch, signal)
  return {
    ok: true,
    release: {
      tag_name: entry.tag,
      html_url: entry.url,
      body: entry.body,
      prerelease: isPrereleaseTag(entry.tag),
      assets,
    },
  }
}

async function fetchViaApi(
  slug: string,
  fetch: ReleaseFetch,
  headers: Record<string, string>,
  signal: AbortSignal,
  includePrerelease: boolean,
): Promise<GitHubReleaseFetchResult> {
  if (includePrerelease) {
    const list = await fetch(`${API}/repos/${slug}/releases?per_page=10`, { headers, signal })
    if (!list.ok) {
      return { ok: false, error: RELEASE_ERROR, detail: `list_http_${list.status}` }
    }
    const releases = (await list.json()) as GhRelease[]
    const release = releases.find((row) => row?.tag_name && !row.draft)
    if (!release?.tag_name) return { ok: false, error: RELEASE_ERROR, detail: 'no_release' }
    return { ok: true, release: release as GhRelease & { tag_name: string } }
  }
  const response = await fetch(`${API}/repos/${slug}/releases/latest`, { headers, signal })
  if (response.status === 404) {
    const list = await fetch(`${API}/repos/${slug}/releases?per_page=5`, { headers, signal })
    if (!list.ok) {
      return { ok: false, error: RELEASE_ERROR, detail: `list_http_${list.status}` }
    }
    const releases = (await list.json()) as GhRelease[]
    const release = releases.find(
      (row) => row?.tag_name && !row.draft && !row.prerelease && !String(row.tag_name).includes('draft'),
    )
    if (!release?.tag_name) return { ok: false, error: RELEASE_ERROR, detail: 'no_release' }
    return { ok: true, release: release as GhRelease & { tag_name: string } }
  }
  if (!response.ok) {
    return { ok: false, error: RELEASE_ERROR, detail: `latest_http_${response.status}` }
  }
  const release = (await response.json()) as GhRelease
  if (!release?.tag_name) return { ok: false, error: RELEASE_ERROR, detail: 'no_release' }
  return { ok: true, release: release as GhRelease & { tag_name: string } }
}

/**
 * Reads the newest release twice, because api.github.com is capped at 60 unauthenticated
 * requests per hour per IP: once through the REST API (rich payload) and once through the
 * public release feed (github.com HTML/Atom, no API quota), which also works when a proxy
 * blocks api.github.com.
 */
export async function fetchLatestGitHubRelease(
  slug: string,
  fetch: ReleaseFetch,
  includePrerelease = false,
): Promise<GitHubReleaseFetchResult> {
  const headers = githubHeaders()

  let apiDetail = ''
  try {
    const api = await fetchViaApi(
      slug,
      fetch,
      headers,
      AbortSignal.timeout(20_000),
      includePrerelease,
    )
    if (api.ok) return api
    apiDetail = api.detail
  } catch (error: unknown) {
    apiDetail = errorMessage(error)
  }

  try {
    // Fresh signal: a timed-out API attempt must not cancel the fallback.
    const web = await fetchViaWeb(slug, fetch, AbortSignal.timeout(20_000), includePrerelease)
    if (web.ok) return web
    return { ok: false, error: RELEASE_ERROR, detail: joinDetail(apiDetail, web.detail) }
  } catch (error: unknown) {
    return { ok: false, error: RELEASE_ERROR, detail: joinDetail(apiDetail, errorMessage(error)) }
  }
}
