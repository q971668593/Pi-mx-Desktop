import QRCode from 'qrcode'
import type { Role } from '@shared/remote'
import { RemoteGateway, type GatewayStatus } from './remote/gateway'
import { createElectronRemoteHost } from './remote-host-electron'
import { detectTailnetName } from './remote/tailnet'
import { probeRelayCert, type RelayCertInfo } from './remote/relay-agent'
import { normalizeRelayBase } from '@shared/relay'

/**
 * Owns the single RemoteGateway: created lazily, started when the user enables it (or at boot
 * if it was left on), stopped on disable / quit. While off nothing listens and every tap is a no-op.
 */

let gateway: RemoteGateway | null = null

function instance(): RemoteGateway {
  if (!gateway) gateway = new RemoteGateway(createElectronRemoteHost())
  return gateway
}

const TAILNET_TTL_MS = 60_000
let tailnetCheckedAt = 0

/** Refresh the MagicDNS endpoint at most once a minute (the CLI call takes a few ms to seconds). */
async function refreshTailnet(gw: RemoteGateway): Promise<void> {
  if (Date.now() - tailnetCheckedAt < TAILNET_TTL_MS) return
  tailnetCheckedAt = Date.now()
  gw.tailnetName = await detectTailnetName().catch(() => null)
}

export type RemoteStatus = GatewayStatus & { qrSvg?: string }

async function withQr(status: GatewayStatus): Promise<RemoteStatus> {
  if (!status.pairing) return status
  const qrSvg = await QRCode.toString(status.pairing.link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { ...status, qrSvg }
}

export async function startRemoteGatewayIfEnabled(): Promise<void> {
  const gw = instance()
  if (!gw.auth.config.enabled) return
  try {
    await gw.start()
    void refreshTailnet(gw)
  } catch (error) {
    console.warn('[remote] gateway failed to start:', error)
  }
}

export async function stopRemoteGateway(): Promise<void> {
  await gateway?.stop()
}

export async function remoteStatus(): Promise<RemoteStatus> {
  const gw = instance()
  if (gw.listening) await refreshTailnet(gw)
  return withQr(gw.status(gw.auth.config.enabled))
}

export async function setRemoteEnabled(enabled: boolean): Promise<RemoteStatus> {
  const gw = instance()
  gw.auth.setEnabled(enabled)
  if (enabled) {
    try {
      await gw.start()
      if (!gw.auth.currentPairing) gw.regeneratePairing()
    } catch {
      /* status carries the error */
    }
  } else await gw.stop()
  return remoteStatus()
}

export async function setRemotePort(port: number): Promise<RemoteStatus> {
  const gw = instance()
  gw.auth.setPort(port)
  if (gw.listening) {
    await gw.stop()
    try {
      await gw.start()
      gw.regeneratePairing()
    } catch {
      /* status carries the error */
    }
  }
  return remoteStatus()
}

export async function regenerateRemotePairing(): Promise<RemoteStatus> {
  const gw = instance()
  if (gw.listening) gw.regeneratePairing()
  return remoteStatus()
}

export async function setRemoteProjects(projects: string[]): Promise<RemoteStatus> {
  instance().auth.setProjects(projects)
  return remoteStatus()
}

/**
 * 自建中转：电脑主动连出去，手机再从任何网络连进来（不用装任何第三方隧道，也不用一直挂 VPN）。
 * 传 null 或空地址＝关掉，回到原来的局域网 / 手工公网入口。
 */
export async function setRemoteRelay(config: { url: string; token: string; pin?: string } | null): Promise<RemoteStatus> {
  const gw = instance()
  const url = config?.url?.trim() ?? ''
  if (!url) {
    gw.setRelay(null)
    return remoteStatus()
  }
  // 口令留空＝沿用已保存的那个（设置页不把口令读回前端）。
  const token = config?.token?.trim() || gw.auth.relay?.token || ''
  gw.setRelay({ url, token, ...(config?.pin ? { pin: config.pin } : {}) })
  return remoteStatus()
}

/**
 * 探测中转的 TLS 证书指纹（不校验证书链）：自签证书的中转靠这把指纹让手机认。
 * 拿到的指纹在设置页点「信任」时随 `setRelay` 存下来，并写进配对链接。
 */
export async function probeRemoteRelay(url: string): Promise<RelayCertInfo | null> {
  const base = normalizeRelayBase(url)
  if (!base) return null
  return probeRelayCert(base)
}

/** Wide-area `host:port` list: tunnel hostname or a forwarded port on the router. */
export async function setRemotePublicHosts(hosts: string[]): Promise<RemoteStatus> {
  instance().setPublicHosts(hosts)
  return remoteStatus()
}

/**
 * Re-issue the TLS certificate and restart the listener. Every paired phone must scan the QR again
 * (its pin no longer matches), so the settings page asks for confirmation first.
 */
export async function regenerateRemoteTls(): Promise<RemoteStatus> {
  const gw = instance()
  const listening = gw.listening
  if (listening) await gw.stop()
  gw.regenerateTls()
  if (listening) {
    try {
      await gw.start()
      gw.regeneratePairing()
    } catch {
      /* status carries the error */
    }
  }
  return remoteStatus()
}

export async function revokeRemoteDevice(id: string): Promise<RemoteStatus> {
  instance().revokeDevice(id)
  return remoteStatus()
}

export async function removeRemoteDevice(id: string): Promise<RemoteStatus> {
  instance().removeDevice(id)
  return remoteStatus()
}

export async function setRemoteDeviceRole(id: string, role: Role): Promise<RemoteStatus> {
  instance().setDeviceRole(id, role)
  return remoteStatus()
}
