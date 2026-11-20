import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import { normalizeSessionFileKey } from '@shared/session-file-key'
import { base64UrlEncode, encodePairLink, isPrivateHost, type Role } from '@shared/remote'
import { AssetStore } from './assets'
import { AuthStore, type DeviceRecord } from './auth-store'
import { describeCert } from './cert'
import { RemoteConnection } from './connection'
import type { RemoteHostPort, RemoteTapSink } from './host-port'
import { RemoteRpc } from './rpc'
import { SessionHub } from './session-hub'
import { setRemoteTapSink } from './tap'
import { UiRouter } from './ui-router'

export const REMOTE_FEATURES = ['capabilities', 'cacheWarming', 'sessionCreate', 'assets']
const HANDSHAKE_FAILS_PER_MIN = 20

/** `host` / `host:port` / `[v6]:port` → parts, defaulting to `fallback` when no port is given. */
export function splitHostPort(entry: string, fallback: number): [string, number] {
  const text = String(entry || '').trim()
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(text)
  if (v6) return [v6[1], v6[2] ? Number(v6[2]) : fallback]
  const parts = text.split(':')
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return [parts[0], Number(parts[1])]
  return [text, fallback]
}

const isLoopback = (ip: string): boolean => /^(::ffff:)?127\./.test(ip) || ip === '::1'
const MAX_PAYLOAD = 16 * 1024 * 1024

export type GatewayDevice = Omit<DeviceRecord, 'pub'> & { fingerprint: string; online: boolean }

export type GatewayStatus = {
  enabled: boolean
  listening: boolean
  port: number
  error?: string
  endpoints: string[]
  endpointInfo: EndpointInfo[]
  hostId: string
  hostName: string
  hostKeyEphemeral: boolean
  pairing: { link: string; exp: number } | null
  devices: GatewayDevice[]
  projects: string[]
  trustedProjects: string[]
  /** Labels for temporary-chat sandboxes (the folder name is a random id). */
  projectInfo: Record<string, { label?: string; temporary?: boolean }>
  /** Transport security: what the phone pins, plus a few facts for the settings page. */
  tls: GatewayTlsInfo | null
  /** `host:port` entries used for wide-area access (tunnel or port forwarding). */
  publicHosts: string[]
}

export type GatewayTlsInfo = {
  spki: string
  fingerprint: string
  notAfter: number
  subjectAltNames: string[]
  ephemeral: boolean
}

export type EndpointKind = 'lan' | 'tailscale' | 'overlay' | 'public'
export type EndpointInfo = { url: string; kind: EndpointKind }

/** Container bridges, proxy TUNs (Clash/mihomo, sing-box) and VM host-only nets: never reachable from the phone. */
const VIRTUAL_IF = /^(docker|br-|veth|virbr|vmnet|vboxnet|vethernet|tap|meta|clash|mihomo|nekoray|singbox|sing-box|lxc|lxd|podman|cni|flannel|kube)/i
/** Generic tunnels: only overlay addresses on them count (Tailscale's macOS `utun`, OpenVPN `tun`). */
const TUNNEL_IF = /^(tun|utun)/i
/** Mesh VPN adapters the phone can join too: any private address on them is reachable. */
const OVERLAY_IF = /^(tailscale|zt|zerotier|wg|wireguard|feth)/i

const isCgnat = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

/**
 * Addresses for the pairing QR, best first: home Wi-Fi / Ethernet, then mesh overlays (Tailscale,
 * ZeroTier, WireGuard) for use away from the LAN. Proxy TUNs and container bridges are skipped: a
 * phone would spend a connect timeout on each before reaching a real address.
 */
export function hostAddresses(interfaces = networkInterfaces()): { host: string; kind: EndpointKind }[] {
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3)
  const lan: string[] = []
  const overlay = new Map<string, EndpointKind>()
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL_IF.test(name)) continue
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateHost(a.address) || a.address.startsWith('169.254.')) continue
      // 198.18.0.0/15 is the benchmark range TUN proxies hand out (Clash fake-ip).
      if (/^198\.1[89]\./.test(a.address)) continue
      const tailscale = isCgnat(a.address) || /^tailscale/i.test(name)
      if (tailscale || OVERLAY_IF.test(name)) overlay.set(a.address, tailscale ? 'tailscale' : 'overlay')
      else if (!TUNNEL_IF.test(name)) lan.push(a.address)
    }
  }
  const lanSorted = [...new Set(lan)].sort((a, b) => rank(a) - rank(b))
  return [...lanSorted.map((host) => ({ host, kind: 'lan' as const })), ...[...overlay].filter(([h]) => !lan.includes(h)).map(([host, kind]) => ({ host, kind }))]
}

/** LAN and overlay addresses for the pairing QR, best first. */
export function lanAddresses(interfaces = networkInterfaces()): string[] {
  return hostAddresses(interfaces).map((a) => a.host)
}

export class RemoteGateway {
  readonly auth: AuthStore
  readonly ui: UiRouter
  readonly hub: SessionHub
  private readonly assets: AssetStore
  private readonly rpc: RemoteRpc
  private readonly conns = new Set<RemoteConnection>()
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private listenError: string | undefined
  private readonly failures = new Map<string, { count: number; since: number }>()

  constructor(
    private readonly port: RemoteHostPort,
    private readonly now: () => number = Date.now,
  ) {
    this.auth = new AuthStore(port, now)
    this.ui = new UiRouter(port, (event, payload, sessionKey) => {
      for (const c of this.hub.subscribersOf(sessionKey)) c.sendEvent(event, payload)
      this.hub.onUiChanged(sessionKey)
    })
    this.hub = new SessionHub(port, this.ui, () => this.allowedProjects(), now)
    this.assets = new AssetStore(port)
    this.rpc = new RemoteRpc({
      port,
      hub: this.hub,
      ui: this.ui,
      hostId: () => this.auth.config.hostId,
      assets: () => this.assets.infos(),
      features: REMOTE_FEATURES,
      endpoints: () => this.endpoints(),
    })
  }

  /** Projects remote clients may use: everything the desktop itself trusts. 手机与电脑看同一份列表。 */
  allowedProjects(): string[] {
    return this.port.trustedProjects()
  }

  get sink(): RemoteTapSink {
    return {
      appEvent: (event) => this.hub.onAppEvent(event),
      uiRequest: (request) => this.ui.onDesktopRequest(request),
      uiResolved: (id, by) => this.ui.onResolved(id, by),
      settingsChanged: (key, sessionFile) => {
        for (const c of this.conns) if (c.ready) c.sendEvent('settings.changed', { key, ...(sessionFile ? { sessionKey: sessionFile } : {}) })
      },
    }
  }

  get listening(): boolean {
    return !!this.server?.listening
  }

  /** Port actually bound (differs from the configured one only when tests pass `port: 0`). */
  get boundPort(): number {
    const addr = this.server?.address()
    return addr && typeof addr === 'object' ? addr.port : this.auth.config.port
  }

  async start(opts: { port?: number; host?: string } = {}): Promise<void> {
    if (this.server) return
    this.auth.hostKey()
    await this.assets.warm()
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false })
    // TLS is transport only: the session itself is already X25519 + ChaCha20-Poly1305, and the
    // phone authenticated the host key from the QR. `wss://` keeps rooms, hotels and carriers out.
    const material = this.auth.tlsMaterial(this.certAltNames())
    this.tlsInfo = { ...describeCert(material.certPem), spki: material.spki, ephemeral: material.ephemeral }
    const server = createHttpsServer({ key: material.keyPem, cert: material.certPem }, (req, res) => void this.onHttp(req, res))
    server.on('upgrade', (req, socket, head) => this.onUpgrade(wss, req, socket, head))
    await new Promise<void>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        reject(e)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(opts.port ?? this.auth.config.port, opts.host ?? '0.0.0.0')
    }).catch((e: NodeJS.ErrnoException) => {
      this.listenError = e.code === 'EADDRINUSE' ? 'port_in_use' : e.code || e.message
      throw e
    })
    this.listenError = undefined
    this.server = server
    this.wss = wss
    setRemoteTapSink(this.sink)
    this.port.log('info', `[remote] gateway listening on :${this.boundPort}`)
  }

  async stop(): Promise<void> {
    setRemoteTapSink(null)
    for (const c of [...this.conns]) c.close(1001, 'gateway stopped')
    this.conns.clear()
    this.hub.dispose()
    this.auth.clearPairing()
    this.tlsInfo = null
    const server = this.server
    const wss = this.wss
    this.server = null
    this.wss = null
    wss?.close()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /**
   * Loopback peers are exempt: a local tunnel client (frpc, `ssh -R`) relays every remote phone from
   * 127.0.0.1, so one shared bucket would let anyone scanning the public port lock the owner out. The
   * handshake itself stays the gate (host key + device key or a one-shot pair token).
   */
  private rateLimited(ip: string): boolean {
    if (isLoopback(ip)) return false
    const f = this.failures.get(ip)
    if (!f) return false
    if (this.now() - f.since > 60_000) {
      this.failures.delete(ip)
      return false
    }
    return f.count >= HANDSHAKE_FAILS_PER_MIN
  }

  private recordFailure(ip: string): void {
    const f = this.failures.get(ip)
    if (!f || this.now() - f.since > 60_000) this.failures.set(ip, { count: 1, since: this.now() })
    else f.count++
  }

  private onUpgrade(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const ip = req.socket.remoteAddress ?? ''
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
      return
    }
    if (this.rateLimited(ip)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = new RemoteConnection(ws, {
        auth: this.auth,
        hub: this.hub,
        rpc: this.rpc,
        port: this.port,
        hostName: () => this.port.hostName(),
        onHandshakeFailure: () => this.recordFailure(ip),
        onClosed: (c) => this.conns.delete(c),
      })
      this.conns.add(conn)
    })
  }

  private async onHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    const m = /^\/assets\/([A-Za-z0-9._-]+)$/.exec(path)
    if (req.method === 'GET' && m) {
      const asset = await this.assets.load(m[1])
      if (asset) {
        res.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'content-length': String(asset.body.length),
          'cache-control': 'public, max-age=86400',
          'x-content-sha256': asset.info.sha256,
        })
        res.end(asset.body)
        return
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }

  // ── Settings page operations ──

  pairLink(): { link: string; exp: number } | null {
    const p = this.auth.currentPairing
    const endpoints = this.endpoints()
    if (!p || !endpoints.length) return null
    return {
      link: encodePairLink({
        v: 1,
        hostId: this.auth.config.hostId,
        hostName: this.port.hostName(),
        hostPub: base64UrlEncode(this.auth.hostKey().pub),
        endpoints,
        ...(this.tlsInfo ? { tls: this.tlsInfo.spki } : {}),
        pairToken: p.token,
        exp: p.exp,
      }),
      exp: p.exp,
    }
  }

  /** Overridable for tests and the dev host (loopback). */
  endpointHosts: () => { host: string; kind: EndpointKind }[] = () => hostAddresses()
  /** This machine's Tailscale MagicDNS name (`pc.tail1234.ts.net`), found once the gateway starts. */
  tailnetName: string | null = null
  private tlsInfo: GatewayTlsInfo | null = null

  /** SAN list for the certificate: every address the phone might dial, plus user-declared public names. */
  private certAltNames(): string[] {
    const hosts = this.endpointHosts().map((e) => e.host)
    if (this.tailnetName) hosts.push(this.tailnetName)
    return [...hosts, ...this.auth.publicHosts.map((h) => h.replace(/:\d+$/, ''))]
  }

  endpointInfo(): EndpointInfo[] {
    const hosts = this.endpointHosts()
    const all: { host: string; kind: EndpointKind }[] = this.tailnetName ? [...hosts, { host: this.tailnetName, kind: 'tailscale' }] : [...hosts]
    // Wide-area entries come last: the phone tries LAN first and falls back here.
    for (const entry of this.auth.publicHosts) all.push({ host: entry, kind: 'public' })
    return all.map(({ host, kind }) => {
      const [name, port] = splitHostPort(host, this.boundPort)
      return { url: `wss://${name.includes(':') ? `[${name}]` : name}:${port}`, kind }
    })
  }

  endpoints(): string[] {
    return this.endpointInfo().map((e) => e.url)
  }

  regeneratePairing(): { link: string; exp: number } | null {
    this.auth.newPairToken()
    return this.pairLink()
  }

  revokeDevice(id: string): boolean {
    const ok = this.auth.revokeDevice(id)
    for (const c of [...this.conns]) if (c.deviceId === id) c.close(4006, 'revoked')
    return ok
  }

  removeDevice(id: string): boolean {
    const ok = this.auth.removeDevice(id)
    for (const c of [...this.conns]) if (c.deviceId === id) c.close(4006, 'removed')
    return ok
  }

  setDeviceRole(id: string, role: Role): boolean {
    return this.auth.setDeviceRole(id, role)
  }

  /** Wide-area `host:port` list (tunnel hostname or a port-forward on the router). */
  setPublicHosts(hosts: string[]): void {
    this.auth.setPublicHosts(hosts)
  }

  /**
   * Mint a new certificate. Only needed when the stored key is lost: every paired phone must scan
   * the QR again because the pinned fingerprint changes.
   */
  regenerateTls(): void {
    this.auth.regenerateTls(this.certAltNames())
    this.tlsInfo = null
    if (this.server) {
      const material = this.auth.tlsMaterial(this.certAltNames())
      this.tlsInfo = { ...describeCert(material.certPem), spki: material.spki, ephemeral: material.ephemeral }
    }
  }

  /** Certificate facts for the settings page (never the key). */
  private tlsStatus(): GatewayTlsInfo | null {
    if (this.tlsInfo) return this.tlsInfo
    const material = this.auth.tlsMaterial(this.certAltNames())
    return { ...describeCert(material.certPem), spki: material.spki, ephemeral: material.ephemeral }
  }

  status(enabled: boolean): GatewayStatus {
    const online = new Set([...this.conns].filter((c) => c.ready).map((c) => c.deviceId))
    return {
      enabled,
      listening: this.listening,
      port: this.auth.config.port,
      ...(this.listenError ? { error: this.listenError } : {}),
      endpoints: this.endpoints(),
      endpointInfo: this.endpointInfo(),
      hostId: this.auth.config.hostId,
      hostName: this.port.hostName(),
      hostKeyEphemeral: this.listening ? this.auth.hostKeyIsEphemeral : false,
      pairing: this.listening ? this.pairLink() : null,
      devices: this.auth.config.devices.map(({ pub, ...d }) => ({ ...d, fingerprint: pub.slice(0, 8), online: online.has(d.id) })),
      projects: this.auth.config.projects,
      trustedProjects: this.port.trustedProjects(),
      tls: this.listening ? this.tlsStatus() : null,
      publicHosts: this.auth.publicHosts,
      projectInfo: Object.fromEntries(
        this.port.trustedProjects().flatMap((p) => {
          const info = this.port.projectInfo?.(p)
          return info && (info.label || info.temporary) ? [[p, info]] : []
        }),
      ),
    }
  }
}
