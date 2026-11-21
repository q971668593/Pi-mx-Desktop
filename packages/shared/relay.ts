/**
 * 自建中转（relay）的线格式：桌面端作为「宿主」外向连接到中转，手机再连到中转，
 * 中转只做字节搬运，看不到内容（会话本身已有 X25519 + ChaCha20-Poly1305 端到端加密）。
 *
 * 控制消息走文本 JSON，数据走二进制帧：
 *   [u8 flags][u16be idLen][id ascii][payload ...]
 * flags bit0 = 原始帧是文本帧（握手帧是文本，其余多为二进制），照抄过去才对得上。
 * 这样一条宿主的出站连接就能同时承载多台手机 / 多条会话。
 */

export const RELAY_PROTOCOL_VERSION = 1

/** 中转 → 宿主。 */
export type RelayToHost =
  | { t: 'ready'; room: string; version: number }
  | { t: 'open'; id: string }
  | { t: 'close'; id: string }
  | { t: 'ping'; at: number }
  | { t: 'error'; message: string }

/** 宿主 → 中转。 */
export type RelayFromHost =
  | { t: 'open-ack'; id: string }
  | { t: 'open-fail'; id: string; reason?: string }
  | { t: 'pong'; at: number }
  | { t: 'connections'; count: number }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeRelayData(id: string, payload: Uint8Array, text = false): Uint8Array {
  const key = encoder.encode(id)
  if (key.length > 0xffff) throw new Error('relay id too long')
  const frame = new Uint8Array(3 + key.length + payload.length)
  frame[0] = text ? 1 : 0
  frame[1] = (key.length >> 8) & 0xff
  frame[2] = key.length & 0xff
  frame.set(key, 3)
  frame.set(payload, 3 + key.length)
  return frame
}

export function decodeRelayData(input: Uint8Array): { id: string; payload: Uint8Array; text: boolean } | null {
  if (input.length < 4) return null
  const idLen = (input[1] << 8) | input[2]
  if (idLen === 0 || input.length < 3 + idLen) return null
  const id = decoder.decode(input.subarray(3, 3 + idLen))
  return { id, payload: input.subarray(3 + idLen), text: (input[0] & 1) === 1 }
}

export function parseRelayControl(text: string): RelayToHost | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const t = (raw as { t?: unknown }).t
  switch (t) {
    case 'ready': {
      const room = (raw as { room?: unknown }).room
      const version = (raw as { version?: unknown }).version
      return typeof room === 'string' ? { t: 'ready', room, version: typeof version === 'number' ? version : RELAY_PROTOCOL_VERSION } : null
    }
    case 'open':
    case 'close': {
      const id = (raw as { id?: unknown }).id
      return typeof id === 'string' && id ? ({ t, id } as RelayToHost) : null
    }
    case 'ping': {
      const at = (raw as { at?: unknown }).at
      return { t: 'ping', at: typeof at === 'number' ? at : Date.now() }
    }
    case 'error': {
      const message = (raw as { message?: unknown }).message
      return { t: 'error', message: typeof message === 'string' ? message : 'relay error' }
    }
    default:
      return null
  }
}

export function relayControlText(message: RelayFromHost): string {
  return JSON.stringify(message)
}

/** `relay.example.com:443` / `https://x` / `wss://x:8443` → `wss://x[:port]`（无路径）。 */
export function normalizeRelayBase(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `wss://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (!host) return null
  const port = url.port ? Number(url.port) : 443
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const shown = host.includes(':') ? `[${host}]` : host
  return `wss://${shown}:${port}`
}

/** 手机拨的地址：带房间号，房间号是随机长串，猜不到就进不来。 */
export function relayClientUrl(base: string, room: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return `${trimmed}/c/${encodeURIComponent(room)}`
}

/** 桌面端（宿主）拨的地址。 */
export function relayHostUrl(base: string, room: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return `${trimmed}/host?room=${encodeURIComponent(room)}`
}

/** relay 地址在设置页/配对链接里怎么显示：去掉协议头，留 host:port。 */
export function relayDisplayHost(base: string): string {
  return base.replace(/^wss:\/\//, '').replace(/\/+$/, '')
}
