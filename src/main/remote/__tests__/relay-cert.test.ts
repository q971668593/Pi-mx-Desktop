import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:https'
import { createSelfSignedCert, spkiFingerprint } from '../cert'
import { probeRelayCert } from '../relay-agent'

/**
 * 没有域名时的路子：中转用自签证书，电脑端探一次指纹，手机按指纹认。
 * 这条测试保证「探到的指纹」和证书真实的 SPKI 一致（不一致手机就永远连不上）。
 */

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function httpsWithSelfSigned(): Promise<{ port: number; spki: string }> {
  const material = createSelfSignedCert(['127.0.0.1', 'localhost'])
  const server = createServer({ key: material.keyPem, cert: material.certPem }, (_req, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { port: (server.address() as { port: number }).port, spki: spkiFingerprint(material.certPem) }
}

describe('probeRelayCert', () => {
  it('reads the SPKI pin of a self-signed relay certificate', async () => {
    const { port, spki } = await httpsWithSelfSigned()
    const info = await probeRelayCert(`wss://127.0.0.1:${port}`)
    expect(info).not.toBeNull()
    expect(info!.spki).toBe(spki)
    expect(info!.fingerprint).toMatch(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/)
    expect(info!.notAfter).toBeGreaterThan(Date.now())
  })

  it('answers null when nothing is listening', async () => {
    // 先占个端口再放掉：这个号基本不会有别的东西在听，探测要快速失败而不是挂住
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
    const port = (probe.address() as { port: number }).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    await expect(probeRelayCert(`wss://127.0.0.1:${port}`, 2_000)).resolves.toBeNull()
  })
})
