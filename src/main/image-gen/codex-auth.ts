/**
 * ChatGPT / Codex 订阅授权的读取与刷新。
 *
 * 只读写 `~/.codex/auth.json`（Codex CLI 与 DSH 的 ChatGPT 登录插件共用同一份授权），
 * 不碰任何其它凭据；刷新成功才回写，回写时保留文件里其它字段。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
// 与本机 Codex/Harness 的公开 OAuth client 一致，用于刷新订阅令牌。
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_AHEAD_MS = 60_000

export type CodexGrant = {
  access: string
  refresh: string
  accountId: string
  expiresAt: number | null
  path: string
}

type AuthFile = {
  OPENAI_API_KEY?: string | null
  auth_mode?: string
  last_refresh?: string
  tokens?: { access_token?: string; refresh_token?: string; account_id?: string; id_token?: string }
  [key: string]: unknown
}

export function codexAuthPath(): string {
  return process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'auth.json') : join(homedir(), '.codex', 'auth.json')
}

function decodeExpiry(accessToken: string): number | null {
  // JWT 的 exp 是秒；拿不到就交给调用方按 401 重试。
  const parts = accessToken.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

export async function readCodexGrant(): Promise<CodexGrant | null> {
  const path = codexAuthPath()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }
  let parsed: AuthFile
  try {
    parsed = JSON.parse(raw) as AuthFile
  } catch {
    return null
  }
  const access = String(parsed.tokens?.access_token || '').trim()
  const refresh = String(parsed.tokens?.refresh_token || '').trim()
  const accountId = String(parsed.tokens?.account_id || '').trim()
  if (!access || !accountId) return null
  return { access, refresh, accountId, expiresAt: decodeExpiry(access), path }
}

/** 刷新订阅令牌；成功才回写 auth.json，失败抛错让上层提示重新登录。 */
export async function refreshCodexGrant(grant: CodexGrant, send: typeof fetch = fetch): Promise<CodexGrant> {
  if (!grant.refresh) throw new Error('ChatGPT 授权缺少 refresh_token，请在 Codex / DSH 插件里重新登录')
  const response = await send(TOKEN_ENDPOINT, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: grant.refresh, client_id: CLIENT_ID }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`ChatGPT 授权刷新失败（HTTP ${response.status}），请重新登录`)
  }
  const token = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string') {
    throw new Error('ChatGPT 授权刷新返回无效结果，请重新登录')
  }
  const next: CodexGrant = {
    ...grant,
    access: token.access_token,
    refresh: token.refresh_token,
    expiresAt: typeof token.expires_in === 'number' ? Date.now() + token.expires_in * 1000 : decodeExpiry(token.access_token),
  }
  try {
    const raw = await readFile(grant.path, 'utf8')
    const parsed = JSON.parse(raw) as AuthFile
    parsed.tokens = { ...(parsed.tokens || {}), access_token: next.access, refresh_token: next.refresh }
    parsed.last_refresh = new Date().toISOString()
    await writeFile(grant.path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  } catch {
    // 回写失败不影响本次请求：内存里的新令牌仍然可用。
  }
  return next
}

/** 拿一个可用令牌：快过期先刷新，调用方遇到 401 再刷新一次重试。 */
export async function ensureCodexGrant(grant: CodexGrant, send: typeof fetch = fetch): Promise<CodexGrant> {
  if (grant.expiresAt && grant.expiresAt <= Date.now() + REFRESH_AHEAD_MS && grant.refresh) {
    return refreshCodexGrant(grant, send)
  }
  return grant
}
