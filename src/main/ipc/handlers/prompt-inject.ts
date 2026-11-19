import { registerHandlerWithSchema } from '../registry'
import { configStore } from '../../config-store'
import { promptInjectRestoreBackupSchema, promptInjectSaveSchema, promptInjectTargetSchema } from '../schemas'
import {
  applyPromptInject,
  getPromptInjectState,
  restorePromptInjectBackup,
  revertPromptInject,
} from '../../prompt-inject'

function workspaceOf(request: { workspaceId?: string } | undefined): string {
  return String(request?.workspaceId || configStore.get('currentProject') || '')
}

export function registerPromptInjectHandlers(): void {
  registerHandlerWithSchema('ipc:promptInject.get', promptInjectTargetSchema, async (req) => {
    return { state: getPromptInjectState(workspaceOf(req)) }
  })

  registerHandlerWithSchema('ipc:promptInject.save', promptInjectSaveSchema, async (req) => {
    const state = applyPromptInject(
      { enabled: req.enabled, text: req.text, scope: req.scope },
      workspaceOf(req),
    )
    return { state }
  })

  registerHandlerWithSchema('ipc:promptInject.revert', promptInjectTargetSchema, async (req) => {
    return { state: revertPromptInject(workspaceOf(req)) }
  })

  registerHandlerWithSchema('ipc:promptInject.restoreBackup', promptInjectRestoreBackupSchema, async (req) => {
    return { state: restorePromptInjectBackup(req.name, workspaceOf(req)) }
  })
}
