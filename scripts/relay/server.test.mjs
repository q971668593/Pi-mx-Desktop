import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createRelayServer, decodeRelayData, encodeRelayData, ensureSelfSignedCert, certificatePin } from './server.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import { decodeRelayData as decodeShared, encodeRelayData as encodeShared } from '../../packages/shared/relay'

const servers = []
const sockets = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.close()
    } catch {
      /* already closed */
    }
  }
  for (const relay of servers.splice(0)) await relay.close()
})

async function startRelay(token = 'test-token-0123456789') {
  const relay = createRelayServer({ token, log: () => {} })
  const address = await relay.listen(0, '127.0.0.1')
  servers.push(relay)
  return { relay, port: address.port, token }
}

const inbox = new WeakMap()
const waiters = new WeakMap()

function parseMessage(data, isBinary) {
  if (isBinary) return { binary: true, frame: decodeRelayData(data), data }
  const text = String(data)
  try {
    return { binary: false, control: JSON.parse(text), data: text }
  } catch {
    return { binary: false, control: null, data: text }
  }
}

/** 连上之后立刻开始攒消息：ready 这类控制帧可能在 open 之后下一拍就到，不能等 listener。 */
function open(url, options) {
  const socket = new WebSocket(url, options)
  sockets.push(socket)
  inbox.set(socket, [])
  waiters.set(socket, [])
  // 被拒的连接会触发 error：断言看 close/unexpected-response，这里吞掉免得日志里全是噪音
  socket.on('error', () => {})
  socket.on('message', (data, isBinary) => {
    const value = parseMessage(data, isBinary)
    const list = waiters.get(socket) ?? []
    const hit = list.findIndex((w) => w.predicate(value))
    if (hit >= 0) {
      const [waiter] = list.splice(hit, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(value)
      return
    }
    inbox.get(socket)?.push(value)
  })
  return socket
}

/** 等一条满足条件的消息（先看攒着的，再等新的）；超时让测试自己失败，而不是卡死。 */
function next(socket, predicate = () => true, timeoutMs = 4000) {
  const buffered = inbox.get(socket) ?? []
  const hit = buffered.findIndex((value) => predicate(value))
  if (hit >= 0) return Promise.resolve(buffered.splice(hit, 1)[0])
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const list = waiters.get(socket) ?? []
      waiters.set(socket, list.filter((w) => w.resolve !== resolve))
      reject(new Error('timed out waiting for a relay message'))
    }, timeoutMs)
    waiters.get(socket)?.push({ predicate, resolve, timer })
  })
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function closedWith(socket) {
  return new Promise((resolve) => {
    socket.once('unexpected-response', (_req, res) => resolve(res.statusCode))
    socket.once('close', (code) => resolve(code))
  })
}

describe('relay wire format', () => {
  it('matches the desktop implementation byte for byte', () => {
    const payload = Buffer.from('hs1 payload 中文', 'utf8')
    for (const text of [false, true]) {
      const a = encodeRelayData('c12', payload, text)
      const b = Buffer.from(encodeShared('c12', new Uint8Array(payload), text))
      expect(a.equals(b)).toBe(true)
      expect(decodeRelayData(a)).toEqual({ id: 'c12', payload, text })
      const back = decodeShared(new Uint8Array(a))
      expect(back?.id).toBe('c12')
      expect(Buffer.from(back?.payload ?? []).equals(payload)).toBe(true)
      expect(back?.text).toBe(text)
    }
  })
})

describe('self-signed relay certificate', () => {
  it('generates once, keeps the same pin, and serves TLS with it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-relay-tls-'))
    try {
      const made = ensureSelfSignedCert(join(dir, 'cert.pem'), join(dir, 'key.pem'))
      const pin = certificatePin(readFileSync(made.cert, 'utf8'))
      expect(pin).toMatch(/^[A-Za-z0-9_-]{43}$/)
      // 第二次调用复用同一张证书：指纹不能变，否则手机要重配
      expect(certificatePin(readFileSync(ensureSelfSignedCert(join(dir, 'cert.pem'), join(dir, 'key.pem')).cert, 'utf8'))).toBe(pin)

      const relay = createRelayServer({ token: 'tls-token-0123456789', cert: made.cert, key: made.key, log: () => {} })
      const address = await relay.listen(0, '127.0.0.1')
      servers.push(relay)
      const seen = await new Promise((resolve, reject) => {
        const socket = tlsConnect({ host: '127.0.0.1', port: address.port, rejectUnauthorized: false }, () => {
          const cert = socket.getPeerCertificate(true)
          socket.destroy()
          resolve(cert && Buffer.isBuffer(cert.pubkey) ? 'ok' : 'no-pubkey')
        })
        socket.on('error', reject)
      })
      expect(seen).toBe('ok')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('relay server', () => {
  it('pipes a phone through the desktop host connection', async () => {
    const { port, token } = await startRelay()
    const host = open(`ws://127.0.0.1:${port}/host?room=room-abc`, { headers: { 'x-relay-token': token } })
    await opened(host)
    const ready = await next(host)
    expect(ready.control).toMatchObject({ t: 'ready', room: 'room-abc' })
    expect(ready.control.version).toBe(1)

    const phone = open(`ws://127.0.0.1:${port}/c/room-abc`)
    await opened(phone)
    const openControl = await next(host, (m) => m.control?.t === 'open')
    const id = openControl.control.id

    // 手机在宿主 ack 之前先发了一帧：中转要先攒住，ack 之后原样补上（顺序不能乱）
    phone.send('hs1 handshake')
    await new Promise((r) => setTimeout(r, 60))
    host.send(JSON.stringify({ t: 'open-ack', id }))
    const firstFrame = await next(host, (m) => m.binary)
    expect(firstFrame.frame.id).toBe(id)
    expect(firstFrame.frame.text).toBe(true)
    expect(Buffer.from(firstFrame.frame.payload).toString()).toBe('hs1 handshake')

    // 宿主 → 手机
    host.send(encodeRelayData(id, Buffer.from('hs2 reply'), true), { binary: true })
    // 文本帧原样还原成文本帧（手机那边的协议就是文本/二进制混着用的）
    const reply = await next(phone, (m) => !m.binary)
    expect(reply.data).toBe('hs2 reply')

    // 手机 → 宿主（ack 之后走直通）
    phone.send(Buffer.from([1, 2, 3]))
    const second = await next(host, (m) => m.binary && Buffer.from(m.frame.payload).length === 3)
    expect(second.frame.text).toBe(false)

    // 手机断开：宿主收到 close，中转把连接清掉
    phone.close()
    const closeControl = await next(host, (m) => m.control?.t === 'close')
    expect(closeControl.control.id).toBe(id)
  })

  it('accepts the /ws suffix the phone appends to an endpoint', async () => {
    const { port, token } = await startRelay()
    const host = open(`ws://127.0.0.1:${port}/host?room=room-abc`, { headers: { 'x-relay-token': token } })
    await opened(host)
    await next(host)
    const phone = open(`ws://127.0.0.1:${port}/c/room-abc/ws`)
    await opened(phone)
    const openControl = await next(host, (m) => m.control?.t === 'open')
    expect(openControl.control.id).toMatch(/^c\d+$/)
  })

  it('refuses a host without the right token', async () => {
    const { port } = await startRelay()
    const host = open(`ws://127.0.0.1:${port}/host?room=room-abc`, { headers: { 'x-relay-token': 'nope' } })
    expect(await closedWith(host)).toBe(401)
  })

  it('throttles repeated wrong tokens from the same address', async () => {
    const { port } = await startRelay()
    const codes = []
    for (let i = 0; i < 12; i += 1) {
      const host = open(`ws://127.0.0.1:${port}/host?room=r${i}`, { headers: { 'x-relay-token': 'wrong' } })
      codes.push(await closedWith(host))
    }
    // 前几次 401，超过阈值后直接 429
    expect(codes.slice(0, 10).every((code) => code === 401)).toBe(true)
    expect(codes.slice(10).every((code) => code === 429)).toBe(true)
  })

  it('refuses a phone for a room nobody hosts', async () => {
    const { port } = await startRelay()
    const phone = open(`ws://127.0.0.1:${port}/c/nobody-home`)
    expect(await closedWith(phone)).toBe(404)
  })

  it('answers healthz with live counters', async () => {
    const { port, token } = await startRelay()
    const host = open(`ws://127.0.0.1:${port}/host?room=r1`, { headers: { 'x-relay-token': token } })
    await opened(host)
    await next(host)
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(await res.json()).toMatchObject({ ok: true, rooms: 1 })
  })
})
