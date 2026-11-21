import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import WebSocket, { WebSocketServer } from 'ws'
import { decodeRelayData, encodeRelayData } from '../../../../packages/shared/relay'
import { createSelfSignedCert, spkiFingerprint } from '../cert'
import { RelayAgent } from '../relay-agent'

/**
 * 桌面端 <-> 中转的宿主连接：这里用一个最小的中转 + 本地回显服务把它跑通，
 * 真正的中转服务器（scripts/relay/server.mjs）另有自己的测试。
 */

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function echoGateway(): Promise<number> {
  const server = createServer()
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  cleanups.push(() => new Promise<void>((resolve) => wss.close(() => server.close(() => resolve()))))
  return port
}

/** 最小中转：一条宿主连接 + 按 id 转发，够验证 agent 的行为。给 tls 就走 https/wss。 */
async function miniRelay(token: string, opts: { tls?: { certPem: string; keyPem: string } } = {}) {
  const server = opts.tls ? createHttpsServer({ cert: opts.tls.certPem, key: opts.tls.keyPem }) : createServer()
  const wss = new WebSocketServer({ server })
  let host: WebSocket | null = null
  const pending = new Map<string, WebSocket>()
  let seq = 0

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://relay.local')
    if (url.pathname === '/host') {
      if (String(req.headers['x-relay-token'] ?? '') !== token) {
        ws.close(4010, 'bad token')
        return
      }
      host = ws
      ws.send(JSON.stringify({ t: 'ready', room: url.searchParams.get('room'), version: 1 }))
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return
        const frame = decodeRelayData(data as Buffer)
        if (!frame) return
        pending.get(frame.id)?.send(frame.payload, { binary: !frame.text })
      })
      ws.on('close', () => {
        host = null
      })
      return
    }
    const room = /^\/c\/([^/]+)$/.exec(url.pathname)
    if (!room || !host) {
      ws.close(4004, 'no such room')
      return
    }
    const id = `c${(seq += 1)}`
    pending.set(id, ws)
    host.send(JSON.stringify({ t: 'open', id }))
    ws.on('message', (data, isBinary) => {
      if (host?.readyState !== WebSocket.OPEN) return
      host.send(encodeRelayData(id, Buffer.isBuffer(data) ? data : Buffer.from(String(data)), !isBinary), { binary: true })
    })
    ws.on('close', () => {
      pending.delete(id)
      if (host?.readyState === WebSocket.OPEN) host.send(JSON.stringify({ t: 'close', id }))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  cleanups.push(() => new Promise<void>((resolve) => wss.close(() => server.close(() => resolve()))))
  return port
}

function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (check()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('condition not met in time'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('RelayAgent', () => {
  it('carries a phone through to the local gateway, text and binary intact', async () => {
    const gatewayPort = await echoGateway()
    const relayPort = await miniRelay('relay-secret-0123456789')
    const agent = new RelayAgent({
      url: `ws://127.0.0.1:${relayPort}`,
      room: 'room-test',
      token: 'relay-secret-0123456789',
      localPort: () => gatewayPort,
    })
    agent.start()
    cleanups.push(() => agent.stop())
    await waitFor(() => agent.status().connected)
    expect(agent.status()).toMatchObject({ room: 'room-test', connected: true, connections: 0 })

    const phone = new WebSocket(`ws://127.0.0.1:${relayPort}/c/room-test`)
    cleanups.push(() => phone.close())
    const received: Array<{ text: boolean; body: string }> = []
    phone.on('message', (data, isBinary) => received.push({ text: !isBinary, body: Buffer.isBuffer(data) ? data.toString('utf8') : String(data) }))

    await new Promise<void>((resolve) => phone.once('open', () => resolve()))
    // 握手帧是文本（协议里 hs1/hs2 就是文本），回显也要以文本回来
    phone.send('hs1 hello')
    phone.send(Buffer.from([9, 8, 7]))
    await waitFor(() => received.length >= 2)
    expect(received[0]).toEqual({ text: true, body: 'hs1 hello' })
    expect(received[1].text).toBe(false)
    expect(Buffer.from(received[1].body, 'utf8').toJSON()).toBeDefined()
    expect(agent.status().connections).toBe(1)

    phone.close()
    await waitFor(() => agent.status().connections === 0)
  })

  it('works with a self-signed relay when the pin matches, and refuses a wrong pin', async () => {
    const gatewayPort = await echoGateway()
    const material = createSelfSignedCert(['127.0.0.1', 'localhost'])
    const pin = spkiFingerprint(material.certPem)
    const relayPort = await miniRelay('relay-secret-0123456789', { tls: material })

    const wrong = new RelayAgent({
      url: `wss://127.0.0.1:${relayPort}`,
      room: 'room-tls',
      token: 'relay-secret-0123456789',
      pin: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      localPort: () => gatewayPort,
    })
    wrong.start()
    cleanups.push(() => wrong.stop())
    await waitFor(() => !!wrong.status().error)
    expect(wrong.status().connected).toBe(false)

    const agent = new RelayAgent({
      url: `wss://127.0.0.1:${relayPort}`,
      room: 'room-tls',
      token: 'relay-secret-0123456789',
      pin,
      localPort: () => gatewayPort,
    })
    agent.start()
    cleanups.push(() => agent.stop())
    await waitFor(() => agent.status().connected)

    const phone = new WebSocket(`wss://127.0.0.1:${relayPort}/c/room-tls`, { rejectUnauthorized: false })
    cleanups.push(() => phone.close())
    const received: string[] = []
    phone.on('message', (data, isBinary) => received.push(isBinary ? Buffer.from(data as Buffer).toString('hex') : String(data)))
    await new Promise<void>((resolve) => phone.once('open', () => resolve()))
    phone.send('hs1 tls hello')
    await waitFor(() => received.includes('hs1 tls hello'))
  })

  it('keeps trying when the relay refuses the token, and reports why', async () => {
    const gatewayPort = await echoGateway()
    const relayPort = await miniRelay('the-right-token-0123456789')
    const agent = new RelayAgent({
      url: `ws://127.0.0.1:${relayPort}`,
      room: 'room-test',
      token: 'wrong-token',
      localPort: () => gatewayPort,
    })
    agent.start()
    cleanups.push(() => agent.stop())
    await waitFor(() => !!agent.status().error)
    expect(agent.status().connected).toBe(false)
  })
})
