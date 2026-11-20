import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto'

/**
 * Minimal self-signed server certificate (no third-party dependency, no `openssl` on the host).
 *
 * Why hand-rolled: the app has to mint a certificate on first run of the remote gateway, on any
 * Windows/macOS/Linux box, offline. A dependency for ~120 lines of DER is not worth the install
 * risk, and the certificate never acts as a CA — phones pin its SPKI fingerprint at pairing time
 * (`tls.spki` in the pair link), so chain building is not involved at all.
 *
 * Produced certificate: RSA-2048, sha256WithRSAEncryption, v3, self-signed, with
 * basicConstraints(CA:false), keyUsage(digitalSignature, keyEncipherment),
 * extKeyUsage(serverAuth) and subjectAltName from the caller's DNS/IP list.
 */

const ROMAN_OID = (...parts: number[]): Buffer => {
  const out: number[] = [40 * parts[0] + parts[1]]
  for (const value of parts.slice(2)) {
    const chunk: number[] = [value & 0x7f]
    let rest = value >>> 7
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80)
      rest >>>= 7
    }
    out.push(...chunk)
  }
  return Buffer.from(out)
}

function derLength(total: number): Buffer {
  if (total < 0x80) return Buffer.from([total])
  const bytes: number[] = []
  let rest = total
  while (rest > 0) {
    bytes.unshift(rest & 0xff)
    rest >>>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLength(body.length), body])

const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items))
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items))
const octet = (body: Buffer): Buffer => tlv(0x04, body)
const bitString = (body: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.concat([Buffer.from([unused]), body]))
const explicit = (index: number, body: Buffer): Buffer => tlv(0xa0 + index, body)
const boolean = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0x00]))

const oid = (...parts: number[]): Buffer => tlv(0x06, ROMAN_OID(...parts))

const OID = {
  sha256WithRsa: oid(1, 2, 840, 113549, 1, 1, 11),
  commonName: oid(2, 5, 4, 3),
  organization: oid(2, 5, 4, 10),
  basicConstraints: oid(2, 5, 29, 19),
  keyUsage: oid(2, 5, 29, 15),
  extKeyUsage: oid(2, 5, 29, 37),
  subjectAltName: oid(2, 5, 29, 17),
  subjectKeyId: oid(2, 5, 29, 14),
  serverAuth: oid(1, 3, 6, 1, 5, 5, 7, 3, 1),
}

function integer(value: Buffer): Buffer {
  // DER integers are minimal and positive: drop leading zero bytes, never encode an empty body,
  // and prepend 0x00 only when the top bit is set (a leading 0x00 in a serial is "illegal padding").
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  let body = value.subarray(start)
  if (!body.length || body.every((byte) => byte === 0)) body = Buffer.from([1])
  const positive = body[0] & 0x80 ? Buffer.concat([Buffer.from([0]), body]) : Buffer.from(body)
  return tlv(0x02, positive)
}

const utf8 = (text: string): Buffer => tlv(0x0c, Buffer.from(text, 'utf8'))
const ia5 = (text: string): Buffer => tlv(0x16, Buffer.from(text, 'ascii'))

function name(entries: Array<{ oid: Buffer; value: string }>): Buffer {
  return seq(...entries.map((entry) => set(seq(entry.oid, utf8(entry.value)))))
}

/** UTCTime (YYMMDDHHMMSSZ) — valid until 2049; certificates are re-issued long before that. */
function utcTime(date: Date): Buffer {
  const p = (n: number, width = 2) => String(n).padStart(width, '0')
  const text = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  return tlv(0x17, Buffer.from(text, 'ascii'))
}

const isIp = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')

function extension(oid: Buffer, value: Buffer, critical = false): Buffer {
  return critical ? seq(oid, boolean(true), octet(value)) : seq(oid, octet(value))
}

export type SelfSignedCert = {
  keyPem: string
  certPem: string
  /** base64url(sha256(SubjectPublicKeyInfo)) — what the phone pins. */
  spki: string
  /** SHA-256 of the whole DER certificate, colon-separated (shown in settings). */
  fingerprint: string
  subjectAltNames: string[]
  notAfter: number
}

const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

export function spkiFingerprint(certPem: string): string {
  const cert = new X509Certificate(certPem)
  return base64Url(createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest())
}

/** Normalises the SAN list: DNS names and IPv4/IPv6 addresses, de-duplicated, always with `localhost`. */
export function normalizeAltNames(hosts: string[]): { dns: string[]; ips: string[] } {
  const dns = new Set<string>(['localhost'])
  const ips = new Set<string>(['127.0.0.1', '::1'])
  for (const raw of hosts) {
    const text = String(raw || '').trim()
    // `[fe80::1]:47900` keeps its IPv6 body; a bare `host:port` loses only the port.
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text)
    const host = bracketed ? bracketed[1] : text.includes('::') ? text : text.replace(/:\d+$/, '')
    if (!host) continue
    if (isIp(host)) ips.add(host)
    else if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host)) dns.add(host.toLowerCase())
  }
  return { dns: [...dns], ips: [...ips] }
}

function generalNames(hosts: { dns: string[]; ips: string[] }): Buffer {
  const entries: Buffer[] = []
  for (const host of hosts.dns) entries.push(tlv(0x82, Buffer.from(host, 'ascii'))) // [2] dNSName
  for (const ip of hosts.ips) {
    const bytes = ip.includes(':') ? ipv6Bytes(ip) : Buffer.from(ip.split('.').map(Number))
    entries.push(tlv(0x87, bytes)) // [7] iPAddress
  }
  return seq(...entries)
}

function ipv6Bytes(ip: string): Buffer {
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':').filter(Boolean) : []
  const right = tail ? tail.split(':').filter(Boolean) : []
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  const out = Buffer.alloc(16)
  groups.slice(0, 8).forEach((group, index) => out.writeUInt16BE(parseInt(group || '0', 16), index * 2))
  return out
}

const colonHex = (digest: string) => (digest.replace(/[^0-9a-f]/gi, '').match(/.{2}/g) ?? []).join(':')

/**
 * Mints a fresh self-signed certificate. Callers persist it (the key is sealed with safeStorage)
 * so the pinned fingerprint stays stable across restarts.
 */
export function createSelfSignedCert(hosts: string[] = [], days = 3650): SelfSignedCert {
  const altNames = normalizeAltNames(hosts)
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  const subject = name([
    { oid: OID.organization, value: 'Pi mx Desktop' },
    { oid: OID.commonName, value: altNames.dns[0] ?? 'pi-desktop' },
  ])
  const now = new Date()
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  const serial = randomBytes(16)
  serial[0] &= 0x7f

  const extensions = explicit(
    3,
    seq(
      extension(OID.basicConstraints, seq(), true),
      // digitalSignature(0) + keyEncipherment(2)
      extension(OID.keyUsage, bitString(Buffer.from([0xa0]), 5), true),
      extension(OID.extKeyUsage, seq(OID.serverAuth)),
      extension(OID.subjectAltName, generalNames(altNames)),
      extension(OID.subjectKeyId, octet(createHash('sha1').update(spkiDer).digest())),
    ),
  )

  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    seq(OID.sha256WithRsa),
    subject,
    seq(utcTime(now), utcTime(notAfter)),
    subject,
    spkiDer,
    extensions,
  )
  const signature = sign('sha256', tbs, privateKey)
  const der = seq(tbs, seq(OID.sha256WithRsa), bitString(signature))
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
  const keyPem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const parsed = new X509Certificate(certPem)

  return {
    keyPem,
    certPem,
    spki: spkiFingerprint(certPem),
    fingerprint: colonHex(parsed.fingerprint256.toLowerCase()),
    subjectAltNames: [...altNames.dns, ...altNames.ips],
    notAfter: Date.parse(parsed.validTo),
  }
}

/** Facts the settings page shows (never the key). */
export function describeCert(certPem: string): { fingerprint: string; notAfter: number; subjectAltNames: string[] } {
  const cert = new X509Certificate(certPem)
  const san = cert.subjectAltName ?? ''
  const names = [...san.matchAll(/(?:DNS|IP Address):([^,]+)/g)].map((m) => m[1].trim())
  return {
    fingerprint: colonHex(cert.fingerprint256.toLowerCase()),
    notAfter: Date.parse(cert.validTo),
    subjectAltNames: [...new Set(names)],
  }
}
