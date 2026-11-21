#!/usr/bin/env node
/**
 * Pi 自建中转（relay）服务器 —— 放到一台你能访问到的 VPS 上跑，手机和电脑都主动连它。
 *
 *   node scripts/relay/server.mjs --port 8443 --token "$(openssl rand -hex 24)"
 *
 * 只做字节搬运：真正的会话是端到端加密的（X25519 + ChaCha20-Poly1305），中转看不到内容。
 * 控制消息是文本 JSON，数据是二进制帧 `[u16be idLen][id][payload]`。
 *
 * 传输加密两种用法：
 *   1. 前面挂 nginx / caddy 反代（推荐，证书自动续）：node 只监听 127.0.0.1；
 *   2. 自己带证书：--cert fullchain.pem --key privkey.pem（Let's Encrypt 签发即可，手机会走系统信任链）。
 */
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { WebSocketServer } from 'ws'


/** base64url(sha256(SPKI))：和手机端/电脑端 pin 的算法一致。 */
export function certificatePin(certPem) {
  const cert = new X509Certificate(certPem)
  return createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64url')
}

/** 没域名也能用：用 openssl 生成一张自签证书（只需要 CN，手机认的是指纹不是名字）。 */
export function ensureSelfSignedCert(certPath, keyPath, commonName = 'pi-relay') {
  if (existsSync(certPath) && existsSync(keyPath)) return { cert: certPath, key: keyPath }
  const dir = resolve(certPath, '..')
  mkdirSync(dir, { recursive: true })
  const result = spawnSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', `/CN=${commonName}`,
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`openssl failed: ${(result.stderr || result.stdout || '').trim() || result.status}`)
  }
  return { cert: certPath, key: keyPath }
}

const RELAY_VERSION = 1
const MAX_BUFFER = 1024 * 1024 // 手机在宿主 ack 之前最多先攒 1MB
const PING_MS = 15_000
const PONG_TIMEOUT_MS = 45_000
const MAX_CONNS_PER_ROOM = 64
const MAX_ROOMS = 512
const AUTH_FAILS_PER_MIN = 10

/** 定时比较，不在长度/位置上漏时间信息（口令是唯一凭据，别给爆破留侧信道）。 */
function sameSecret(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

/** 数据帧：与 packages/shared/relay.ts 的 encodeRelayData 一一对应（flags + id + payload）。 */
export function encodeRelayData(id, payload, text = false) {
  const key = Buffer.from(id, 'utf8')
  const frame = Buffer.allocUnsafe(3 + key.length + payload.length)
  frame[0] = text ? 1 : 0
  frame[1] = (key.length >> 8) & 0xff
  frame[2] = key.length & 0xff
  key.copy(frame, 3)
  payload.copy(frame, 3 + key.length)
  return frame
}

export function decodeRelayData(input) {
  if (input.length < 4) return null
  const idLen = (input[1] << 8) | input[2]
  if (idLen === 0 || input.length < 3 + idLen) return null
  return { id: input.subarray(3, 3 + idLen).toString('utf8'), payload: input.subarray(3 + idLen), text: (input[0] & 1) === 1 }
}

function parseArgs(argv) {
  const out = { port: 8443, host: '0.0.0.0', token: process.env.RELAY_TOKEN || '', cert: '', key: '', selfSigned: false, tlsDir: '' }
  const take = (index) => {
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`missing value for ${argv[index]}`)
    return value
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') {
      out.port = Number(take(i))
      i += 1
    } else if (arg === '--host') {
      out.host = take(i)
      i += 1
    } else if (arg === '--token') {
      out.token = take(i)
      i += 1
    } else if (arg === '--cert') {
      out.cert = take(i)
      i += 1
    } else if (arg === '--key') {
      out.key = take(i)
      i += 1
    } else if (arg === '--self-signed') {
      out.selfSigned = true
    } else if (arg === '--tls-dir') {
      out.tlsDir = take(i)
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      out.help = true
    }
  }
  return out
}

const usage = `Pi 自建中转

  node scripts/relay/server.mjs --port 8443 --token <一串随机长口令>

  --port    监听端口（默认 8443；反代场景里写 127.0.0.1:18443 这种）
  --host    监听地址（默认 0.0.0.0）
  --token   宿主（电脑）注册用的口令，必须与设置页里填的一致；也读环境变量 RELAY_TOKEN
  --cert    TLS 证书链（PEM），给了就自己开 https/wss
  --key     TLS 私钥（PEM）
  --self-signed  没有域名时用它：用 openssl 生成自签证书（首次），电脑端点「检测证书」信任即可
  --tls-dir      自签证书放在哪个目录（默认 ./relay-tls）
`

/**
 * 起一个中转服务。
 * @param {{ port?: number; host?: string; token: string; cert?: string; key?: string; log?: (line: string) => void }} options
 */
export function createRelayServer(options) {
  const token = String(options.token || '')
  const log = options.log || ((line) => console.log(line))
  const rooms = new Map() // room → { host, conns: Map<id, client>, seq }
  const useTls = Boolean(options.cert && options.key)
  const server = useTls
    ? createHttpsServer({ cert: readFileSync(options.cert), key: readFileSync(options.key) }, onHttp)
    : createHttpServer(onHttp)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false })
  const stats = { hosts: 0, clients: 0, rooms: 0, opened: 0, rejected: 0 }
  const authFails = new Map() // ip → { count, since }

  /** 口令试错限速：一分钟内同一 IP 失败 10 次就 429，爆破成本立刻变得不划算。 */
  function authThrottled(ip) {
    const entry = authFails.get(ip)
    if (!entry) return false
    if (Date.now() - entry.since > 60_000) {
      authFails.delete(ip)
      return false
    }
    return entry.count >= AUTH_FAILS_PER_MIN
  }

  function recordAuthFail(ip) {
    const entry = authFails.get(ip)
    if (!entry || Date.now() - entry.since > 60_000) authFails.set(ip, { count: 1, since: Date.now() })
    else entry.count += 1
  }

  function onHttp(req, res) {
    const path = (req.url || '').split('?')[0]
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, version: RELAY_VERSION, rooms: rooms.size, hosts: stats.hosts, clients: stats.clients, opened: stats.opened, rejected: stats.rejected }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Pi relay\n')
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://relay.local')
    if (url.pathname === '/host') {
      const room = url.searchParams.get('room') || ''
      const ip = req.socket.remoteAddress || 'unknown'
      const given = req.headers['x-relay-token'] || url.searchParams.get('token') || ''
      // 口令试错限速：同一地址一分钟失败 10 次就 429，定时比较不给爆破留时间侧信道
      if (authThrottled(ip)) {
        stats.rejected += 1
        socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n')
        return
      }
      if (!token || !sameSecret(given, token)) {
        recordAuthFail(ip)
        stats.rejected += 1
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
        return
      }
      if (!room || room.length > 128) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
        return
      }
      if (!rooms.has(room) && rooms.size >= MAX_ROOMS) {
        stats.rejected += 1
        socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n')
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => attachHost(room, ws, req))
      return
    }
    // 手机端会把 `/ws` 拼在端点后面（wss://relay:443/c/<房间>/ws），这里两种都认
    const match = /^\/c\/([^/]+)(?:\/ws)?\/?$/.exec(url.pathname)
    if (match) {
      const room = decodeURIComponent(match[1])
      const entry = rooms.get(room)
      if (!entry || entry.host.readyState !== 1) {
        stats.rejected += 1
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => attachClient(room, entry, ws, req))
      return
    }
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
  })

  function attachHost(room, ws, req) {
    const existing = rooms.get(room)
    if (existing && existing.host.readyState === 1) {
      // 同一个房间只留一条宿主连接：新连接顶掉旧的（电脑重连/换网络时不会卡在僵尸上）
      try {
        existing.host.close(4009, 'replaced by a new host connection')
      } catch {
        /* already gone */
      }
    }
    const entry = { host: ws, conns: new Map(), seq: 0, room, alive: true, ip: req.socket.remoteAddress || '' }
    rooms.set(room, entry)
    stats.hosts = [...rooms.values()].filter((r) => r.host.readyState === 1).length
    log(`[relay] host online room=${room} ip=${entry.ip}`)
    send(ws, { t: 'ready', room, version: RELAY_VERSION })

    const ping = setInterval(() => {
      if (ws.readyState !== 1) return clearInterval(ping)
      entry.pingAt = Date.now()
      send(ws, { t: 'ping', at: entry.pingAt })
      if (entry.pingAt && Date.now() - entry.lastPong > PONG_TIMEOUT_MS) {
        log(`[relay] host silent, closing room=${room}`)
        ws.close(4008, 'heartbeat timeout')
      }
    }, PING_MS)

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const frame = decodeRelayData(Buffer.isBuffer(data) ? data : Buffer.from(data))
        if (!frame) return
        const client = entry.conns.get(frame.id)
        if (!client || client.ws.readyState !== 1) return
        client.ws.send(frame.payload, { binary: !frame.text })
        return
      }
      let control
      try {
        control = JSON.parse(String(data))
      } catch {
        return
      }
      if (control.t === 'pong') {
        entry.lastPong = Date.now()
        entry.latencyMs = entry.lastPong - (entry.pingAt || entry.lastPong)
        return
      }
      if (control.t === 'open-ack' && typeof control.id === 'string') {
        const client = entry.conns.get(control.id)
        if (!client) return
        client.ready = true
        // 先把手机在 ack 之前发的帧（握手）转给宿主，顺序不能乱
        for (const buffered of client.buffer.splice(0)) {
          ws.send(encodeRelayData(control.id, buffered.payload, buffered.text), { binary: true })
        }
        return
      }
      if (control.t === 'open-fail' && typeof control.id === 'string') {
        const client = entry.conns.get(control.id)
        entry.conns.delete(control.id)
        stats.clients = countClients()
        if (client) client.ws.close(1011, control.reason || 'host could not open a local connection')
      }
    })

    ws.on('close', () => {
      clearInterval(ping)
      for (const client of entry.conns.values()) client.ws.close(1012, 'host went away')
      entry.conns.clear()
      if (rooms.get(room) === entry) rooms.delete(room)
      stats.hosts = [...rooms.values()].filter((r) => r.host.readyState === 1).length
      stats.clients = countClients()
      log(`[relay] host offline room=${room}`)
    })
    ws.on('error', () => ws.close())
  }

  function attachClient(room, entry, ws, req) {
    if (entry.conns.size >= MAX_CONNS_PER_ROOM) {
      stats.rejected += 1
      ws.close(1013, 'too many connections on this host')
      return
    }
    const id = `c${(entry.seq += 1)}`
    const conn = { ws, buffer: [], ready: false, ip: req.socket.remoteAddress || '' }
    entry.conns.set(id, conn)
    stats.clients = countClients()
    stats.opened += 1
    send(entry.host, { t: 'open', id })
    log(`[relay] phone attached room=${room} id=${id} ip=${conn.ip}`)

    ws.on('message', (data, isBinary) => {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (!conn.ready) {
        // 宿主那边还在拉本地连接：先攒着，手机一上来就发的握手不能丢
        if (conn.buffer.reduce((n, b) => n + b.payload.length, 0) < MAX_BUFFER) conn.buffer.push({ payload, text: !isBinary })
        return
      }
      if (entry.host.readyState === 1) entry.host.send(encodeRelayData(id, payload, !isBinary), { binary: true })
    })
    ws.on('close', () => {
      entry.conns.delete(id)
      stats.clients = countClients()
      if (entry.host.readyState === 1) send(entry.host, { t: 'close', id })
    })
    ws.on('error', () => ws.close())
  }

  function countClients() {
    let n = 0
    for (const entry of rooms.values()) n += entry.conns.size
    return n
  }

  function send(ws, message) {
    if (ws.readyState !== 1) return
    ws.send(typeof message === 'string' ? message : JSON.stringify(message))
  }

  return {
    server,
    wss,
    stats: () => ({ ...stats, rooms: rooms.size }),
    listen(port = options.port ?? 8443, host = options.host ?? '0.0.0.0') {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          resolve(server.address())
        })
      })
    },
    close() {
      for (const entry of rooms.values()) {
        for (const client of entry.conns.values()) client.ws.close(1001, 'relay stopping')
        entry.host.close(1001, 'relay stopping')
      }
      rooms.clear()
      wss.close()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.mjs')) {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage)
    process.exit(0)
  }
  if (!args.token || args.token.length < 16) {
    console.error('缺少 --token（至少 16 个字符）：宿主连接要靠它认证。\n')
    console.log(usage)
    process.exit(1)
  }
  if (args.selfSigned && !args.cert) {
    const dir = resolve(args.tlsDir || 'relay-tls')
    const made = ensureSelfSignedCert(join(dir, 'cert.pem'), join(dir, 'key.pem'))
    args.cert = made.cert
    args.key = made.key
    const pin = certificatePin(readFileSync(made.cert, 'utf8'))
    console.log(`[relay] 自签证书: ${made.cert}`)
    console.log(`[relay] 证书指纹(设置页点「检测证书」会自动取): ${pin}`)
  }
  const relay = createRelayServer(args)
  relay
    .listen(args.port, args.host)
    .then((address) => {
      const where = address && typeof address === 'object' ? `${address.address}:${address.port}` : String(address)
      console.log(`[relay] listening on ${where}${args.cert ? ' (tls)' : ''}`)
      console.log('[relay] 电脑端设置：中转地址填你自己的域名:端口，口令填这里的 --token')
    })
    .catch((error) => {
      console.error('[relay] failed to start:', error.message)
      process.exit(1)
    })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      relay.close().then(() => process.exit(0))
    })
  }
}
