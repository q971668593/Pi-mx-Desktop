import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { net } from 'electron'
import type { MagpieQuotaEntry, MagpieQuotaWindow } from '@shared/ipc-contract'
import { registerHandler } from '../registry'
import { resolveActiveAgentDir } from '../../agent-dir'
import { readModelsConfigRaw } from '../../pi-models-json'
import { chatGptAccountIdFromAccessToken, isJwtExpired } from '../../codex-transcribe/jwt-account-id'

const QUOTA_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 15_000
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

let quotaCache: { at: number; credSig: string; data: MagpieQuotaEntry[] } | null = null

type AuthRecord = Record<string, Record<string, unknown>>

function authJsonPath(): string {
  return join(resolveActiveAgentDir(), 'auth.json')
}

function readAuthFile(): AuthRecord {
  try {
    const file = authJsonPath()
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as AuthRecord) : {}
  } catch {
    return {}
  }
}

function resolveEnvRef(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('$')) return (process.env[trimmed.slice(1)] || '').trim()
  return trimmed
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function toIsoFromEpochSec(sec: unknown): string | undefined {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return undefined
  const ms = sec > 1e12 ? sec : sec * 1000
  return new Date(ms).toISOString()
}

function toIsoFromOffsetSec(sec: unknown): string | undefined {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return undefined
  return new Date(Date.now() + sec * 1000).toISOString()
}

async function fetchJsonWithHeaders(url: string, headers: Record<string, string>): Promise<{ status: number; json?: unknown }> {
  const tryOne = async (fn: typeof fetch): Promise<{ status: number; json?: unknown }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fn(url, { headers, signal: controller.signal })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.warn(`[quota] ${url} -> HTTP ${res.status}`, body.slice(0, 160))
        return { status: res.status }
      }
      return { status: res.status, json: (await res.json()) as unknown }
    } finally {
      clearTimeout(timer)
    }
  }

  if (net && typeof net.fetch === 'function') {
    try {
      const r = await tryOne((u, i) => net.fetch(u, i))
      if (r.json || r.status === 401) return r
    } catch (err) {
      console.warn(`[quota] net.fetch failed for ${url}, falling back to fetch:`, err)
    }
  }
  return await tryOne(fetch)
}

type CodexCred = {
  access: string
  refresh: string
  expires: number | null
  accountId: string | null
}

function readCodexCred(auth: AuthRecord): CodexCred | null {
  const entry = auth['openai-codex']
  if (!entry || typeof entry !== 'object') return null
  const access = typeof entry.access === 'string' ? entry.access.trim() : typeof entry.access_token === 'string' ? entry.access_token.trim() : ''
  if (!access) return null
  const refresh = typeof entry.refresh === 'string' ? entry.refresh.trim() : typeof entry.refresh_token === 'string' ? entry.refresh_token.trim() : ''
  const rawExp = typeof entry.expires === 'number' && Number.isFinite(entry.expires) ? entry.expires : null
  const accountId =
    (typeof entry.accountId === 'string' && entry.accountId.trim()) ||
    (typeof entry.account_id === 'string' && entry.account_id.trim()) ||
    chatGptAccountIdFromAccessToken(access)
  return { access, refresh, expires: rawExp, accountId }
}

function isCodexExpired(cred: CodexCred): boolean {
  if (cred.expires !== null) {
    const expMs = cred.expires > 1e12 ? cred.expires : cred.expires * 1000
    if (Date.now() >= expMs - 60_000) return true
  }
  return isJwtExpired(cred.access, 60)
}

async function refreshCodexAccessToken(cred: CodexCred): Promise<CodexCred | null> {
  if (!cred.refresh) return null
  try {
    const fn = net && typeof net.fetch === 'function' ? (u: string, i?: RequestInit) => net.fetch(u, i) : fetch
    const res = await fn(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: cred.refresh,
        client_id: CODEX_OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    if (typeof data.access_token !== 'string' || !data.access_token) return null
    const nextAccess = data.access_token
    const nextRefresh = typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : cred.refresh
    const nextExpires = typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : cred.expires
    const nextAccountId = chatGptAccountIdFromAccessToken(nextAccess) || cred.accountId
    // 写回 auth.json，保留其余字段
    try {
      const file = authJsonPath()
      const current = readAuthFile()
      const prev = current['openai-codex'] || { type: 'oauth' }
      current['openai-codex'] = {
        ...prev,
        type: 'oauth',
        access: nextAccess,
        refresh: nextRefresh,
        ...(nextExpires !== null ? { expires: nextExpires } : {}),
        ...(nextAccountId ? { accountId: nextAccountId } : {}),
      }
      writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    } catch {
      // 回写失败不影响当次使用
    }
    return { access: nextAccess, refresh: nextRefresh, expires: nextExpires, accountId: nextAccountId }
  } catch {
    return null
  }
}

function formatCodexWindowName(seconds: unknown, fallback: string): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return fallback
  if (seconds === 18000) return '5h'
  if (seconds === 604800) return '7d'
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 60)}m`
}

function parseCodexUsage(payload: unknown): MagpieQuotaEntry | null {
  if (!payload || typeof payload !== 'object') return null
  const data = payload as {
    plan_type?: unknown
    rate_limit?: {
      primary_window?: { used_percent?: unknown; limit_window_seconds?: unknown; reset_at?: unknown; reset_after_seconds?: unknown } | null
      secondary_window?: { used_percent?: unknown; limit_window_seconds?: unknown; reset_at?: unknown; reset_after_seconds?: unknown } | null
    } | null
    credits?: { has_credits?: unknown; balance?: unknown } | null
  }
  const windows: MagpieQuotaWindow[] = []
  const pushWindow = (
    raw: { used_percent?: unknown; limit_window_seconds?: unknown; reset_at?: unknown; reset_after_seconds?: unknown } | null | undefined,
    fallbackName: string,
  ) => {
    if (!raw || typeof raw.used_percent !== 'number' || !Number.isFinite(raw.used_percent)) return
    const used = round1(clampPct(raw.used_percent))
    windows.push({
      name: formatCodexWindowName(raw.limit_window_seconds, fallbackName),
      usedPercent: used,
      remainingPercent: round1(Math.max(0, 100 - used)),
      resetsAt: toIsoFromEpochSec(raw.reset_at) ?? toIsoFromOffsetSec(raw.reset_after_seconds),
    })
  }

  pushWindow(data.rate_limit?.primary_window, '5h')
  pushWindow(data.rate_limit?.secondary_window, '7d')
  const plan = typeof data.plan_type === 'string' && data.plan_type.trim() ? data.plan_type.trim() : undefined
  const creditsBalance =
    data.credits?.has_credits && data.credits.balance != null && String(data.credits.balance).trim() !== ''
      ? `$${data.credits.balance}`
      : undefined
  if (windows.length === 0 && !creditsBalance) return null
  return {
    provider: 'codex',
    ...(plan ? { plan } : {}),
    ...(creditsBalance ? { balance: creditsBalance } : plan ? { balance: plan.toUpperCase() } : {}),
    windows,
  }
}

async function fetchCodexQuota(auth: AuthRecord): Promise<MagpieQuotaEntry | null> {
  let cred = readCodexCred(auth)
  if (!cred) return null
  if (isCodexExpired(cred)) {
    const refreshed = await refreshCodexAccessToken(cred)
    if (refreshed) cred = refreshed
  }
  const buildHeaders = (c: CodexCred): Record<string, string> => ({
    Authorization: `Bearer ${c.access}`,
    Accept: 'application/json',
    originator: 'codex_cli_rs',
    ...(c.accountId ? { 'ChatGPT-Account-Id': c.accountId } : {}),
  })
  let res = await fetchJsonWithHeaders(CODEX_USAGE_URL, buildHeaders(cred))
  if (res.status === 401 && cred.refresh) {
    const refreshed = await refreshCodexAccessToken(cred)
    if (refreshed) {
      res = await fetchJsonWithHeaders(CODEX_USAGE_URL, buildHeaders(refreshed))
    }
  }
  if (!res.json) return null
  return parseCodexUsage(res.json)
}

function readOpenCodeGoKey(auth: AuthRecord): string {
  for (const id of ['opencode-go', 'opencode']) {
    const entry = auth[id]
    if (entry && typeof entry === 'object') {
      const key = resolveEnvRef(entry.key ?? entry.apiKey ?? entry.access)
      if (key) return key
    }
  }
  const envKey = (process.env.OPENCODE_API_KEY || '').trim()
  if (envKey) return envKey
  try {
    const { config } = readModelsConfigRaw()
    const fromModels = resolveEnvRef(config?.providers?.['opencode-go']?.apiKey ?? config?.providers?.['opencode']?.apiKey)
    if (fromModels) return fromModels
  } catch {
    // ignore
  }
  return ''
}

type OpenCodeWindowRaw = {
  percent?: unknown
  usageDollars?: unknown
  limitDollars?: unknown
  resetInSec?: unknown
  resetsAt?: unknown
}

function parseOpenCodeGoUsage(payload: unknown): MagpieQuotaEntry | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as { usage?: Record<string, OpenCodeWindowRaw>; rolling?: OpenCodeWindowRaw; weekly?: OpenCodeWindowRaw; monthly?: OpenCodeWindowRaw }
  const usage = root.usage && typeof root.usage === 'object' ? root.usage : root
  const defs: Array<[string, string]> = [
    ['rolling', '5h'],
    ['weekly', '7d'],
    ['monthly', '月度'],
  ]
  const windows: MagpieQuotaWindow[] = []
  let monthlySummary: string | undefined

  for (const [key, label] of defs) {
    const w = usage[key]
    if (!w || typeof w !== 'object') continue
    const usedDollar = typeof w.usageDollars === 'number' && Number.isFinite(w.usageDollars) ? w.usageDollars : null
    const limitDollar = typeof w.limitDollars === 'number' && Number.isFinite(w.limitDollars) ? w.limitDollars : null
    let pct: number | null =
      typeof w.percent === 'number' && Number.isFinite(w.percent) ? w.percent : null
    if (pct === null && usedDollar !== null && limitDollar !== null && limitDollar > 0) {
      pct = (usedDollar / limitDollar) * 100
    }
    if (pct === null) continue
    const used = round1(clampPct(pct))
    const resetsAt =
      typeof w.resetsAt === 'string' && w.resetsAt.trim()
        ? w.resetsAt.trim()
        : toIsoFromOffsetSec(w.resetInSec)
    windows.push({
      name: label,
      usedPercent: used,
      remainingPercent: round1(Math.max(0, 100 - used)),
      resetsAt,
    })
    if (key === 'monthly' && usedDollar !== null && limitDollar !== null) {
      const left = Math.max(0, limitDollar - usedDollar)
      monthlySummary = `余 $${left.toFixed(2)} / $${limitDollar.toFixed(0)}`
    }
  }

  if (windows.length === 0) return null
  return {
    provider: 'opencode-go',
    ...(monthlySummary ? { balance: monthlySummary } : {}),
    windows,
  }
}

async function fetchOpenCodeGoQuota(auth: AuthRecord): Promise<MagpieQuotaEntry | null> {
  const key = readOpenCodeGoKey(auth)
  if (!key) return null
  const res = await fetchJsonWithHeaders(OPENCODE_GO_USAGE_URL, {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  })
  if (!res.json) return null
  return parseOpenCodeGoUsage(res.json)
}

export function registerMagpieQuotaHandlers(): void {
  registerHandler('ipc:magpie.quotas', async (req?: { force?: boolean }) => {
    try {
      const auth = readAuthFile()
      const codexCred = readCodexCred(auth)
      const openCodeKey = readOpenCodeGoKey(auth)
      if (!codexCred && !openCodeKey) {
        console.warn('[quota] no codex or opencode-go credentials found in', authJsonPath())
        return { ok: true, data: [] }
      }
      const credSig = `${codexCred?.access || ''}|${openCodeKey}`
      if (!req?.force && quotaCache && quotaCache.credSig === credSig && Date.now() - quotaCache.at < QUOTA_TTL_MS) {
        return { ok: true, data: quotaCache.data, cached: true }
      }

      const [codexRes, openCodeRes] = await Promise.allSettled([
        fetchCodexQuota(auth),
        fetchOpenCodeGoQuota(auth),
      ])
      const data: MagpieQuotaEntry[] = []
      if (codexRes.status === 'fulfilled' && codexRes.value) {
        data.push(codexRes.value)
      } else if (codexRes.status === 'rejected') {
        console.warn('[quota] codex fetch failed:', codexRes.reason)
      }
      if (openCodeRes.status === 'fulfilled' && openCodeRes.value) {
        data.push(openCodeRes.value)
      } else if (openCodeRes.status === 'rejected') {
        console.warn('[quota] opencode-go fetch failed:', openCodeRes.reason)
      }

      console.log(`[quota] fetched ${data.length} provider(s):`, data.map((d) => `${d.provider}(${d.windows.length}w)`).join(', ') || 'none')
      if (data.length > 0) {
        quotaCache = { at: Date.now(), credSig, data }
      }
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'fetch-failed' }
    }
  })

  registerHandler('ipc:magpie.statusline', async () => {
    return { ok: false, error: 'disabled' }
  })
}
