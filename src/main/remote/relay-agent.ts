import { createHash } from 'node:crypto'
import { connect as tlsConnect, type PeerCertificate } from 'node:tls'
import WebSocket from 'ws'
import { decodeRelayData, encodeRelayData, parseRelayControl, relayControlText, relayHostUrl } from '@shared/relay'

/**
 * 桌面端 ↔ 自建中转的「宿主」连接：本机 24 小时外向连着中转，手机从任何网络连中转即可进来。
 * 中转只搬字节，会话本身仍是端到端加密；本机这一侧只是把每个手机连接转成一个本地回环客户端，
 * 所以网关、鉴权、限速这些一行都不用改。
 */

export type RelayAgentStatus = {
  url: string
  room: string
  connected: boolean
  /** 宿主 ↔ 中转的往返时延（心跳测得），没测到就是 null。 */
  latencyMs: number | null
  /** 正在承载的手机连接数。 */
  connections: number
  /** 最近一次失败原因（重连中会一直保留，方便设置页给提示）。 */
  error?: string
  since: number
}

export type RelayAgentOptions = {
  url: string
  room: string
  token: string
  /** 自签证书中转的 SPKI 指纹：给了就按指纹认证书（自签也能用），不给就走系统信任链。 */
  pin?: string
  /** 网关真正监听的端口（每次用时读，设置页改端口也能跟上）。 */
  localPort: () => number
  onStatus?: (status: RelayAgentStatus) => void
  log?: (level: 'info' | 'warn', message: string) => void
}

const PONG_TIMEOUT_MS = 90_000

export type RelayCertInfo = { spki: string; fingerprint: string; subject: string; notAfter: number }

/** base64url(sha256(SPKI)) —— 与手机端 pin 的算法一致。 */
function spkiPin(cert: PeerCertificate): string | null {
  const spki = (cert as { pubkey?: Buffer }).pubkey
  if (!spki) return null
  return createHash('sha256').update(spki).digest('base64url')
}

/**
 * 探测中转的 TLS 证书（不校验证书链）。给「没有域名、用自签证书」的场景用：
 * 探到指纹后写进配对链接，手机按指纹认这把证书，跟公网证书一个待遇。
 */
export function probeRelayCert(url: string, timeoutMs = 8_000): Promise<RelayCertInfo | null> {
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  const port = Number(parsed.port || 443)
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port, servername: /^[0-9.]+$/.test(host) ? undefined : host, rejectUnauthorized: false, timeout: timeoutMs })
    const done = (value: RelayCertInfo | null) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true)
      const spki = cert && spkiPin(cert)
      if (!cert || !spki) return done(null)
      done({
        spki,
        fingerprint: (cert.fingerprint256 || '').toLowerCase(),
        subject: String(cert.subject?.CN ?? ''),
        notAfter: cert.valid_to ? Date.parse(cert.valid_to) : 0,
      })
    })
    socket.once('timeout', () => done(null))
    socket.once('error', () => done(null))
  })
}
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export class RelayAgent {
  private socket: WebSocket | null = null
  private readonly locals = new Map<string, { ws: WebSocket; queue: Array<{ payload: Uint8Array; text: boolean }> }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private stopped = true
  private state: RelayAgentStatus

  constructor(private readonly options: RelayAgentOptions) {
    this.state = { url: options.url, room: options.room, connected: false, latencyMs: null, connections: 0, since: Date.now() }
  }

  status(): RelayAgentStatus {
    return { ...this.state }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempt = 0
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.clearPongTimer()
    this.socket?.close(1000, 'agent stopping')
    this.socket = null
    for (const local of this.locals.values()) local.ws.close(1001, 'relay stopped')
    this.locals.clear()
    this.patch({ connected: false, connections: 0 })
  }

  private patch(next: Partial<RelayAgentStatus>): void {
    this.state = { ...this.state, ...next }
    this.options.onStatus?.(this.status())
  }

  private log(level: 'info' | 'warn', message: string): void {
    this.options.log?.(level, message)
  }

  private connect(): void {
    if (this.stopped || this.socket) return
    void this.open()
  }

  /**
   * 连之前先把证书指纹核一遍（自签中转）。Node 在 `rejectUnauthorized: false` 时会把
   * checkServerIdentity 的错误吞掉，所以自己先握一次 TLS 拿到叶子证书比对。
   */
  private async verifyPin(pin: string): Promise<boolean> {
    const info = await probeRelayCert(this.options.url, 8_000)
    if (this.stopped) return false
    if (!info) {
      this.patch({ error: 'relay_unreachable' })
      return false
    }
    if (info.spki !== pin) {
      this.patch({ error: 'relay_certificate_mismatch' })
      return false
    }
    return true
  }

  private async open(): Promise<void> {
    if (this.stopped || this.socket) return
    const pin = this.options.pin
    if (pin && !(await this.verifyPin(pin))) {
      if (!this.stopped) this.scheduleReconnect()
      return
    }
    if (this.stopped || this.socket) return
    const target = relayHostUrl(this.options.url, this.options.room)
    const socket = new WebSocket(target, {
      headers: { 'x-relay-token': this.options.token },
      handshakeTimeout: 10_000,
      // 指纹已经在上一步核过了：这里只是让自签证书的握手能过，不构成信任判断
      ...(pin ? { rejectUnauthorized: false } : {}),
    })
    this.socket = socket

    socket.on('open', () => {
      this.log('info', `[relay] host connected ${this.options.url}`)
      this.attempt = 0
      this.patch({ connected: true, url: this.options.url, error: undefined, since: Date.now() } as Partial<RelayAgentStatus>)
    })

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const frame = decodeRelayData(data as Buffer)
        if (!frame) return
        const local = this.locals.get(frame.id)
        if (!local) return
        // 本地回环连接可能还在建：握手帧不能丢，先攒着，连上再按顺序发。
        if (local.ws.readyState !== WebSocket.OPEN) {
          local.queue.push({ payload: frame.payload, text: frame.text })
          return
        }
        local.ws.send(frame.payload, { binary: !frame.text })
        return
      }
      const control = parseRelayControl(String(data))
      if (!control) return
      switch (control.t) {
        case 'ready':
          this.patch({ connected: true, room: control.room })
          break
        case 'open':
          this.openLocal(control.id)
          break
        case 'close':
          this.closeLocal(control.id)
          break
        case 'ping':
          this.clearPongTimer()
          socket.send(relayControlText({ t: 'pong', at: control.at }))
          this.patch({ latencyMs: Math.max(1, Date.now() - control.at) })
          this.armPongTimer(socket)
          break
        case 'error':
          this.patch({ error: control.message })
          break
      }
    })

    socket.on('close', (code) => {
      if (this.socket === socket) this.socket = null
      this.clearPongTimer()
      for (const local of this.locals.values()) local.ws.close(1001, 'relay link lost')
      this.locals.clear()
      this.patch({ connected: false, connections: 0, ...(code === 4010 ? { error: 'bad_token' } : {}) })
      this.scheduleReconnect()
    })

    socket.on('error', (error) => {
      this.patch({ error: (error as Error).message })
    })

    // 中转每 15 秒 ping 一次；超时没收到下一个 ping 说明链路死了，主动断开重连。
    this.armPongTimer(socket)
  }

  /** 每个 ping 之后重新计时：90 秒都没等到下一个 ping 就当链路死了。 */
  private armPongTimer(socket: WebSocket): void {
    this.clearPongTimer()
    this.pongTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.OPEN) socket.terminate()
    }, PONG_TIMEOUT_MS)
  }

  private clearPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.pongTimer = null
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return
    const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(this.attempt, 5))
    this.attempt += 1
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, wait)
  }

  /** 一台手机进来：本地开一条回环连接，网关照常做握手与鉴权。 */
  private openLocal(id: string): void {
    const port = this.options.localPort()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { handshakeTimeout: 10_000 })
    const entry = { ws, queue: [] as Array<{ payload: Uint8Array; text: boolean }> }
    this.locals.set(id, entry)
    this.patch({ connections: this.locals.size })

    ws.on('open', () => {
      this.socket?.send(relayControlText({ t: 'open-ack', id }))
      for (const queued of entry.queue.splice(0)) ws.send(queued.payload, { binary: !queued.text })
    })
    ws.on('message', (data, isBinary) => {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
      if (this.socket?.readyState !== WebSocket.OPEN) return
      this.socket.send(encodeRelayData(id, payload, !isBinary), { binary: true })
    })
    ws.on('close', () => {
      this.locals.delete(id)
      this.patch({ connections: this.locals.size })
    })
    ws.on('error', (error) => {
      this.locals.delete(id)
      this.patch({ connections: this.locals.size })
      this.socket?.send(relayControlText({ t: 'open-fail', id, reason: (error as Error).message }))
    })
  }

  private closeLocal(id: string): void {
    const local = this.locals.get(id)
    this.locals.delete(id)
    local?.ws.close(1001, 'phone gone')
    this.patch({ connections: this.locals.size })
  }
}
