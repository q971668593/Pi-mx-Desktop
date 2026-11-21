import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { rememberConfirmRule } from '../../extension-ui-confirm-rules'

export function registerExtensionUiHandlers(): void {
  registerHandler('ipc:extension.respondUI', async (req) => {
    workerManager.respondExtensionUI(req)
    return { ok: true }
  })

  // 「本次会话都允许」：记下这条规则，Worker 下次同类确认由主进程直接应答。
  registerHandler('ipc:extension.rememberConfirm', async (req) => {
    rememberConfirmRule(
      typeof req.sessionFile === 'string' ? req.sessionFile : undefined,
      typeof req.title === 'string' ? req.title : '',
      req.confirmed === true,
    )
    return { ok: true }
  })

  registerHandler('ipc:extension.cancelUI', async (req) => {
    workerManager.cancelExtensionUI(req.id, req.reason ?? 'renderer-cancel')
    return { ok: true }
  })

  registerHandler('ipc:extension.config.get', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { config: configStore.getExtensionConfig(workspaceId, req.extensionId) || {} }
  })

  registerHandler('ipc:extension.config.set', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    configStore.setExtensionConfig(workspaceId, req.extensionId, req.config || {})
    return { ok: true }
  })
}