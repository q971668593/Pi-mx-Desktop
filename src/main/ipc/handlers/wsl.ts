import { registerHandler, registerHandlerWithSchema } from '../registry'
import { wslProbeDistroSchema } from '../schemas'
import { listWslDistros, probeWslDistro } from '../../wsl/detection'

export function registerWslHandlers(): void {
  registerHandler('ipc:wsl.listDistros', async () => {
    return { distros: await listWslDistros() }
  })

  registerHandlerWithSchema('ipc:wsl.probeDistro', wslProbeDistroSchema, async (req) => {
    const distro = String(req.distro ?? '')
    if (!distro) return { ok: false, error: 'missing distro' }
    return { result: await probeWslDistro(distro, { refresh: req.refresh === true }) }
  })
}
