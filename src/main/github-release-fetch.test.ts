import { describe, expect, it, vi } from 'vitest'
import { fetchLatestGitHubRelease, htmlToPlainText, parseAssetLinks } from './github-release-fetch'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } })
}

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes</title>
  <entry>
    <id>tag:github.com,2008:Repository/1456328746/v1.0.3</id>
    <link rel="alternate" type="text/html" href="https://github.com/justhil/pi-app/releases/tag/v1.0.3"/>
    <title>v1.0.3</title>
    <content type="html">&lt;h2&gt;pi Desktop v1.0.3&lt;/h2&gt;
&lt;ul&gt;
&lt;li&gt;&lt;strong&gt;图标黑边&lt;/strong&gt;：圆角外恢复真透明&lt;/li&gt;
&lt;/ul&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1456328746/v1.1.0-beta.1</id>
    <link rel="alternate" type="text/html" href="https://github.com/justhil/pi-app/releases/tag/v1.1.0-beta.1"/>
    <title>v1.1.0-beta.1</title>
    <content type="html">&lt;p&gt;beta&lt;/p&gt;</content>
  </entry>
</feed>`

const ASSET_FRAGMENT = `<ul>
  <li><a href="/justhil/pi-app/releases/download/v1.0.3/Pi.mx-Setup-1.0.3-x64.exe" rel="nofollow">Pi.mx-Setup-1.0.3-x64.exe</a><span>80 MB</span></li>
  <li><a href="/justhil/pi-app/releases/download/v1.0.3/Pi.mx-1.0.3-x64.dmg" rel="nofollow">Pi.mx-1.0.3-x64.dmg</a></li>
</ul>`

/** Routes each request by URL so API and web fallbacks get their own answers. */
function routedFetch(routes: {
  api?: () => Response
  atom?: () => Response
  assets?: () => Response
}): (input: string, init?: RequestInit) => Promise<Response> {
  return vi.fn(async (input: string): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/releases.atom')) return routes.atom?.() ?? textResponse('', 500)
    if (url.includes('/releases/expanded_assets/')) return routes.assets?.() ?? textResponse('', 404)
    return routes.api?.() ?? textResponse('', 500)
  })
}

describe('fetchLatestGitHubRelease', () => {
  it('should_forward_github_token_to_latest_and_fallback_requests', async () => {
    const previousToken = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'test-token'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([{ tag_name: 'v0.4.20' }]))

    try {
      await fetchLatestGitHubRelease('justhil/pi-app', fetch)

      expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer test-token',
      })
      expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
        Authorization: 'Bearer test-token',
      })
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previousToken
    }
  })

  it('should_fall_back_to_gh_token_and_prefer_github_token', async () => {
    const previousGitHubToken = process.env.GITHUB_TOKEN
    const previousGhToken = process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    process.env.GH_TOKEN = 'gh-token'
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.4.20' }))

    try {
      await fetchLatestGitHubRelease('justhil/pi-app', fetch)
      expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer gh-token',
      })

      process.env.GITHUB_TOKEN = 'github-token'
      await fetchLatestGitHubRelease('justhil/pi-app', fetch)
      expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
        Authorization: 'Bearer github-token',
      })
    } finally {
      if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previousGitHubToken
      if (previousGhToken === undefined) delete process.env.GH_TOKEN
      else process.env.GH_TOKEN = previousGhToken
    }
  })

  it('should_parse_latest_release_when_latest_returns_200', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        tag_name: 'v0.4.21',
        html_url: 'https://github.com/justhil/pi-app/releases/tag/v0.4.21',
        body: '## Fixes',
        assets: [
          {
            name: 'pi Desktop-Setup-0.4.21-x64.exe',
            browser_download_url: 'https://example.test/setup.exe',
            size: 42,
          },
        ],
      }),
    )

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: true,
      release: {
        tag_name: 'v0.4.21',
        html_url: 'https://github.com/justhil/pi-app/releases/tag/v0.4.21',
        body: '## Fixes',
        assets: [
          {
            name: 'pi Desktop-Setup-0.4.21-x64.exe',
            browser_download_url: 'https://example.test/setup.exe',
            size: 42,
          },
        ],
      },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/\/releases\/latest$/)
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pi-desktop',
    })
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('should_fall_back_to_release_list_when_latest_returns_404', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse([
          {},
          { tag_name: 'v0.4.20', html_url: 'https://example.test/release', assets: [] },
        ]),
      )

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: true,
      release: {
        tag_name: 'v0.4.20',
        html_url: 'https://example.test/release',
        assets: [],
      },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toMatch(/\/releases\?per_page=5$/)
    expect(fetch.mock.calls[1][1]?.signal).toBe(fetch.mock.calls[0][1]?.signal)
  })

  it('should_read_the_public_release_feed_when_the_api_is_rate_limited', async () => {
    const fetch = routedFetch({
      api: () => jsonResponse({ message: 'API rate limit exceeded' }, 403),
      atom: () => textResponse(ATOM_FEED),
      assets: () => textResponse(ASSET_FRAGMENT),
    })
    const calls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.release.tag_name).toBe('v1.0.3')
    expect(result.release.html_url).toBe('https://github.com/justhil/pi-app/releases/tag/v1.0.3')
    // HTML notes are turned into readable text, not markup.
    expect(result.release.body).toContain('图标黑边')
    expect(result.release.body).not.toContain('<')
    expect(result.release.assets).toEqual([
      {
        name: 'Pi.mx-Setup-1.0.3-x64.exe',
        browser_download_url:
          'https://github.com/justhil/pi-app/releases/download/v1.0.3/Pi.mx-Setup-1.0.3-x64.exe',
        size: 0,
      },
      {
        name: 'Pi.mx-1.0.3-x64.dmg',
        browser_download_url:
          'https://github.com/justhil/pi-app/releases/download/v1.0.3/Pi.mx-1.0.3-x64.dmg',
        size: 0,
      },
    ])
    expect(calls.map((call) => String(call[0]))).toEqual([
      'https://api.github.com/repos/justhil/pi-app/releases/latest',
      'https://github.com/justhil/pi-app/releases.atom',
      'https://github.com/justhil/pi-app/releases/expanded_assets/v1.0.3',
    ])
  })

  it('should_skip_prerelease_tags_in_the_feed_unless_requested', async () => {
    const stableFeed = ATOM_FEED
    const feedWithPrereleaseFirst = `<?xml version="1.0"?><feed>
      <entry><id>tag:github.com,2008:Repository/1/v1.1.0-beta.1</id><link rel="alternate" href="https://github.com/justhil/pi-app/releases/tag/v1.1.0-beta.1"/><title>v1.1.0-beta.1</title></entry>
      <entry><id>tag:github.com,2008:Repository/1/v1.0.3</id><link rel="alternate" href="https://github.com/justhil/pi-app/releases/tag/v1.0.3"/><title>v1.0.3</title></entry>
    </feed>`

    const stable = await fetchLatestGitHubRelease(
      'justhil/pi-app',
      routedFetch({ api: () => textResponse('', 403), atom: () => textResponse(feedWithPrereleaseFirst) }),
      false,
    )
    expect(stable.ok && stable.release.tag_name).toBe('v1.0.3')

    const withPrerelease = await fetchLatestGitHubRelease(
      'justhil/pi-app',
      routedFetch({ api: () => textResponse('', 403), atom: () => textResponse(feedWithPrereleaseFirst) }),
      true,
    )
    expect(withPrerelease.ok && withPrerelease.release.tag_name).toBe('v1.1.0-beta.1')
    expect(stableFeed).toContain('v1.0.3')
  })

  it('should_keep_the_release_when_the_asset_fragment_is_unavailable', async () => {
    const result = await fetchLatestGitHubRelease(
      'justhil/pi-app',
      routedFetch({
        api: () => textResponse('', 403),
        atom: () => textResponse(ATOM_FEED),
        assets: () => textResponse('', 500),
      }),
    )

    expect(result.ok && result.release.tag_name).toBe('v1.0.3')
    expect(result.ok && result.release.assets).toEqual([])
  })

  it('should_return_http_detail_when_both_the_api_and_the_feed_fail', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: 'latest_http_503 atom_http_503',
    })
  })

  it('should_return_list_http_detail_when_release_list_returns_non_success', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: 'list_http_502 atom_http_502',
    })
  })

  it('should_return_no_release_detail_when_release_list_is_empty', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(textResponse('<feed></feed>'))

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: 'no_release',
    })
  })

  it('should_use_release_list_when_prerelease_is_requested', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { tag_name: 'v0.5.0-beta.1', prerelease: true, draft: false },
        { tag_name: 'v0.4.21', prerelease: false, draft: false },
      ]),
    )

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch, true)

    expect(result).toEqual({
      ok: true,
      release: { tag_name: 'v0.5.0-beta.1', prerelease: true, draft: false },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/\/releases\?per_page=10$/)
  })

  it.each([
    ['network', new TypeError('fetch failed'), 'fetch failed'],
    ['abort', new DOMException('The operation was aborted', 'AbortError'), 'The operation was aborted'],
  ])('should_return_stable_failure_when_%s_error_is_thrown', async (_kind, error, message) => {
    const fetch = vi.fn().mockRejectedValue(error)

    const result = await fetchLatestGitHubRelease('justhil/pi-app', fetch)

    expect(result).toEqual({
      ok: false,
      error: '无法读取 GitHub Releases',
      detail: message,
    })
  })
})

describe('release feed parsing', () => {
  it('should_turn_escaped_html_notes_into_plain_text', () => {
    const text = htmlToPlainText('&lt;h2&gt;标题&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;修复 A&lt;/li&gt;&lt;/ul&gt;')
    expect(text).toContain('标题')
    expect(text).toContain('修复 A')
    expect(text).not.toContain('<')
  })

  it('should_extract_absolute_asset_urls_from_the_fragment', () => {
    expect(parseAssetLinks(ASSET_FRAGMENT)).toEqual([
      {
        name: 'Pi.mx-Setup-1.0.3-x64.exe',
        browser_download_url:
          'https://github.com/justhil/pi-app/releases/download/v1.0.3/Pi.mx-Setup-1.0.3-x64.exe',
        size: 0,
      },
      {
        name: 'Pi.mx-1.0.3-x64.dmg',
        browser_download_url:
          'https://github.com/justhil/pi-app/releases/download/v1.0.3/Pi.mx-1.0.3-x64.dmg',
        size: 0,
      },
    ])
  })
})
