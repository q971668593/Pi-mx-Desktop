/**
 * 订阅生图的「第一方身份」。
 *
 * 官方对第三方客户端有一条静默降级路径：请求头不像官方客户端时，图片会发灰、丢透明、
 * 画质骤降，但 HTTP 仍然是 200。这里把身份做成两套可选，并且**不再发任何第三方标记**
 * （旧实现发的 `originator: pi-desktop` / 插件的 `originator: dsh-chatgpt-login` 就是
 * 最明显的第三方指纹）：
 *
 * - web：模拟 chatgpt.com 网页端（Chrome UA + Client Hints + Origin/Referer + oai-device-id），
 *   默认走这套，Cloudflare 看着就是浏览器里的网页请求。
 * - codex：模拟官方 Codex CLI（UA / originator 与 openai/codex 源码一致：
 *   `DEFAULT_ORIGINATOR = "codex_cli_rs"`，UA 形如 `codex_cli_rs/<version> (<os>; <arch>) <terminal>`）。
 *
 * 两套都不带 originator=第三方名字，也不会伪造 Cookie。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ImageGenIdentity = 'web' | 'codex'

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** chatgpt.com 网页端页面上下文会带的头；缺这些是「裸脚本」的典型特征。 */
const WEB_BASE: Record<string, string> = {
  'user-agent': CHROME_UA,
  'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  origin: 'https://chatgpt.com',
  referer: 'https://chatgpt.com/',
  accept: '*/*',
}

function platformTag(): { os: string; arch: string } {
  if (process.platform === 'win32') {
    const release = process.getSystemVersion?.() || ''
    return { os: `Windows ${release || '10'}`, arch: process.arch === 'x64' ? 'x86_64' : process.arch }
  }
  if (process.platform === 'darwin') return { os: `macOS ${process.getSystemVersion?.() || ''}`.trim(), arch: process.arch === 'arm64' ? 'aarch64' : 'x86_64' }
  return { os: `Linux ${process.getSystemVersion?.() || ''}`.trim(), arch: process.arch === 'arm64' ? 'aarch64' : 'x86_64' }
}

/** Codex CLI 的 UA 形态（openai/codex: terminal-detection）。 */
export function codexUserAgent(version = '0.0.0'): string {
  const { os, arch } = platformTag()
  return `codex_cli_rs/${version} (${os}; ${arch}) vscode/1.0.0`
}

/**
 * 稳定的设备 id：网页端每次请求都会带同一个，随机一次即变反而不像浏览器。
 * 存到传入的 userData 目录；读写失败就退回内存值（不影响出图）。
 */
let cachedDeviceId: string | null = null

export function deviceId(userDataDir: string | null): string {
  if (cachedDeviceId) return cachedDeviceId
  const file = userDataDir ? join(userDataDir, 'image-gen-device.json') : ''
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { id?: string }
      if (parsed?.id && /^[0-9a-f-]{16,64}$/i.test(parsed.id)) {
        cachedDeviceId = parsed.id
        return cachedDeviceId
      }
    } catch {
      /* 没有就生成一个 */
    }
  }
  const id = randomUUID()
  cachedDeviceId = id
  if (file) {
    try {
      mkdirSync(userDataDir!, { recursive: true })
      writeFileSync(file, `${JSON.stringify({ id }, null, 2)}\n`, 'utf8')
    } catch {
      /* 写不了就只用内存里的 */
    }
  }
  return id
}

export function buildImageHeaders(input: {
  accessToken: string
  accountId: string
  identity: ImageGenIdentity
  deviceId: string
  sessionId?: string
  codexVersion?: string
}): Record<string, string> {
  const sessionId = input.sessionId || randomUUID()
  const auth = {
    authorization: `Bearer ${input.accessToken}`,
    'chatgpt-account-id': input.accountId,
  }
  if (input.identity === 'codex') {
    // 与 openai/codex 的默认客户端一致：originator=codex_cli_rs、session-id/thread-id，
    // 不带 Origin/Referer（CLI 不是浏览器）。
    return {
      'user-agent': codexUserAgent(input.codexVersion),
      accept: 'application/json',
      'content-type': 'application/json',
      originator: 'codex_cli_rs',
      'session-id': sessionId,
      'thread-id': sessionId,
      ...auth,
    }
  }
  return {
    ...WEB_BASE,
    'content-type': 'application/json',
    // 浏览器端 backend-api 请求会带的会话与设备标识
    'oai-device-id': input.deviceId,
    'oai-language': 'zh-CN',
    'x-client-version': 'prod',
    'session-id': sessionId,
    // 只有非默认 originator 才会被官方客户端发送；网页端不带，这里也不带。
    ...auth,
  }
}

export function resetDeviceIdCacheForTests(): void {
  cachedDeviceId = null
}
