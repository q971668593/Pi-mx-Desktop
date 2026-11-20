import { createServer } from 'node:https'
import { X509Certificate } from 'node:crypto'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import { createSelfSignedCert, describeCert, normalizeAltNames, spkiFingerprint } from '../cert'

const servers: ReturnType<typeof createServer>[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

describe('self-signed certificate', () => {
  it('parses as an X.509 v3 leaf with the requested names', () => {
    const cert = createSelfSignedCert(['192.168.1.10', '10.0.0.5', 'pc.tail1234.ts.net'])
    const parsed = new X509Certificate(cert.certPem)
    expect(parsed.ca).toBe(false)
    expect(parsed.subjectAltName).toContain('IP Address:192.168.1.10')
    expect(parsed.subjectAltName).toContain('IP Address:10.0.0.5')
    expect(parsed.subjectAltName).toContain('DNS:pc.tail1234.ts.net')
    // localhost is always there so a dev host on the same machine still verifies
    expect(parsed.subjectAltName).toContain('DNS:localhost')
    expect(parsed.keyUsage).toEqual(expect.arrayContaining(['1.3.6.1.5.5.7.3.1']))
    expect(Date.parse(parsed.validTo)).toBeGreaterThan(Date.now())
  })

  it('survives random serial numbers (leading zeros are the classic DER trap)', () => {
    // 60 draws: a serial starting with 0x00 used to break OpenSSL parsing 1 time in 4 runs.
    for (let index = 0; index < 60; index++) expect(() => createSelfSignedCert(['10.0.0.1'])).not.toThrow()
  })

  it('normalises alt names and never duplicates them', () => {
    expect(normalizeAltNames(['192.168.1.10:47900', '[fe80::1]', 'PC.Lan', 'localhost', ''])).toEqual({
      dns: ['localhost', 'pc.lan'],
      ips: ['127.0.0.1', '::1', '192.168.1.10', 'fe80::1'],
    })
  })

  it('reports the SPKI the phone pins and the display fingerprint', () => {
    const cert = createSelfSignedCert([])
    expect(spkiFingerprint(cert.certPem)).toBe(cert.spki)
    const info = describeCert(cert.certPem)
    expect(info.fingerprint).toBe(cert.fingerprint)
    expect(info.subjectAltNames).toEqual(expect.arrayContaining(['localhost', '127.0.0.1']))
    expect(info.notAfter).toBeGreaterThan(Date.now())
  })

  it('serves TLS: a client trusting this certificate is accepted, one trusting nothing is not', async () => {
    const cert = createSelfSignedCert(['127.0.0.1'])
    const server = createServer({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => res.end('ok'))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port

    const probe = (ca?: string) =>
      new Promise<{ socket: TLSSocket; fingerprint: string }>((resolve, reject) => {
        const socket = tlsConnect({ host: '127.0.0.1', port, servername: 'localhost', ...(ca ? { ca } : {}) }, () => {
          const peer = socket.getPeerCertificate()
          resolve({ socket, fingerprint: peer.fingerprint256 })
        })
        socket.on('error', reject)
      })

    const ok = await probe(cert.certPem)
    expect(ok.socket.authorized).toBe(true)
    expect(ok.fingerprint.toLowerCase()).toBe(cert.fingerprint)
    ok.socket.destroy()

    await expect(probe()).rejects.toBeTruthy()
  })
})
