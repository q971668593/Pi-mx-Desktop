import { z } from 'zod'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  regenerateRemotePairing,
  regenerateRemoteTls,
  remoteStatus,
  removeRemoteDevice,
  revokeRemoteDevice,
  setRemoteDeviceRole,
  setRemoteEnabled,
  setRemotePort,
  setRemoteProjects,
  probeRemoteRelay,
  setRemotePublicHosts,
  setRemoteRelay,
} from '../../remote-gateway-service'

/** Settings → 手机连接. */
export function registerRemoteHandlers(): void {
  registerHandler('ipc:remote.status', async () => remoteStatus())
  registerHandlerWithSchema('ipc:remote.setEnabled', z.object({ enabled: z.boolean() }), async (req) => setRemoteEnabled(req.enabled))
  registerHandlerWithSchema('ipc:remote.setPort', z.object({ port: z.number().int().min(1024).max(65535) }), async (req) => setRemotePort(req.port))
  registerHandler('ipc:remote.regeneratePairing', async () => regenerateRemotePairing())
  registerHandler('ipc:remote.regenerateTls', async () => regenerateRemoteTls())
  registerHandlerWithSchema('ipc:remote.setPublicHosts', z.object({ hosts: z.array(z.string().max(255)).max(8) }), async (req) =>
    setRemotePublicHosts(req.hosts),
  )
  registerHandlerWithSchema(
    'ipc:remote.setRelay',
    z.object({ url: z.string().max(300), token: z.string().max(200), pin: z.string().max(200).optional() }).strict(),
    async (req) => setRemoteRelay({ url: req.url, token: req.token, ...(req.pin ? { pin: req.pin } : {}) }),
  )
  // 自签证书的中转：先探指纹，用户点「信任」再随 setRelay 存下来
  registerHandlerWithSchema('ipc:remote.relayProbe', z.object({ url: z.string().max(300) }).strict(), async (req) => probeRemoteRelay(req.url))
  registerHandlerWithSchema('ipc:remote.setProjects', z.object({ projects: z.array(z.string()).max(200) }), async (req) => setRemoteProjects(req.projects))
  registerHandlerWithSchema('ipc:remote.revokeDevice', z.object({ id: z.string() }), async (req) => revokeRemoteDevice(req.id))
  registerHandlerWithSchema('ipc:remote.removeDevice', z.object({ id: z.string() }), async (req) => removeRemoteDevice(req.id))
  registerHandlerWithSchema(
    'ipc:remote.setDeviceRole',
    z.object({ id: z.string(), role: z.enum(['viewer', 'operator']) }),
    async (req) => setRemoteDeviceRole(req.id, req.role),
  )
}
