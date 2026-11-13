import { registerHandler } from '../registry'
import { configStore, type PromptInjectScope } from '../../config-store'
import {
  applyPromptInject,
  getPromptInjectState,
  restorePromptInjectBackup,
  revertPromptInject,
} from '../../prompt-inject'

function workspaceOf(request: { workspaceId?: string } | undefined): string {
  return String(request?.workspaceId || configStore.get('currentProject') || '')
}

function scopeOf(value: unknown): PromptInjectScope | undefined {
  return value === 'project' || value === 'global' ? value : undefined
}

export function registerPromptInjectHandlers(): void {
  registerHandler('ipc:promptInject.get', async (req) => {
    return { state: getPromptInjectState(workspaceOf(req)) }
  })

  registerHandler('ipc:promptInject.save', async (req) => {
    const request = req as { workspaceId?: string; enabled?: boolean; text?: string; scope?: PromptInjectScope }
    const state = applyPromptInject(
      {
        enabled: typeof request.enabled === 'boolean' ? request.enabled : undefined,
        text: typeof request.text === 'string' ? request.text : undefined,
        scope: scopeOf(request.scope),
      },
      workspaceOf(request),
    )
    return { state }
  })

  registerHandler('ipc:promptInject.revert', async (req) => {
    return { state: revertPromptInject(workspaceOf(req)) }
  })

  registerHandler('ipc:promptInject.restoreBackup', async (req) => {
    const request = req as { workspaceId?: string; name?: string }
    return { state: restorePromptInjectBackup(String(request.name || ''), workspaceOf(request)) }
  })
}
