import { registerHandler } from '../registry'
import { readModelsConfigRaw } from '../../pi-models-json'

const QUOTA_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 5_000

let quotaCache: { at: number; baseUrl: string; apiKey: string; data: unknown } | null = null

function readMagpieEndpoint(): { baseUrl: string; apiKey: string } | { error: string } {
  try {
    const { config } = readModelsConfigRaw()
    const provider = config?.providers?.['magpie'] as { baseUrl?: unknown; apiKey?: unknown } | undefined
    if (!provider) return { error: 'magpie-not-configured' }
    const rawBase = typeof provider.baseUrl === 'string' && provider.baseUrl.trim()
      ? provider.baseUrl.trim()
      : 'http://127.0.0.1:3425/v1'
    const baseUrl = rawBase.replace(/\/+$/, '')
    const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
    if (!apiKey) return { error: 'magpie-not-configured' }
    return { baseUrl, apiKey }
  } catch {
    return { error: 'magpie-not-configured' }
  }
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`http-${res.status}`)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url: string, apiKey: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`http-${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

export function registerMagpieQuotaHandlers(): void {
  registerHandler('ipc:magpie.quotas', async () => {
    try {
      const endpoint = readMagpieEndpoint()
      if ('error' in endpoint) return { ok: false, error: endpoint.error }
      if (quotaCache && quotaCache.baseUrl === endpoint.baseUrl && quotaCache.apiKey === endpoint.apiKey && Date.now() - quotaCache.at < QUOTA_TTL_MS) {
        return { ok: true, data: quotaCache.data, cached: true }
      }
      const json = await fetchJson(`${endpoint.baseUrl}/magpie/quotas`, endpoint.apiKey)
      const data = (json as { data?: unknown }).data ?? json
      quotaCache = { at: Date.now(), ...endpoint, data }
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'fetch-failed' }
    }
  })

  registerHandler('ipc:magpie.statusline', async () => {
    try {
      const endpoint = readMagpieEndpoint()
      if ('error' in endpoint) return { ok: false, error: endpoint.error }
      const text = await fetchText(`${endpoint.baseUrl}/magpie/statusline`, endpoint.apiKey)
      return { ok: true, text }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'fetch-failed' }
    }
  })
}
