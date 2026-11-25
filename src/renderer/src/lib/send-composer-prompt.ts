import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { currentSessionCapabilities } from '@renderer/lib/session-capabilities'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

export async function sendComposerPrompt(text: string): Promise<boolean> {
  const trimmed = text.trim()
  if (!trimmed) return false
  const capabilities = currentSessionCapabilities()
  const store = useUIStore.getState()
  let sessionFile = store.historySessionFile ?? undefined
  let sessionId = store.currentSessionId || ''
  const needsSession = store.pendingNewSessionPlaceholder || (!sessionFile && !sessionId)
  if (needsSession && store.currentWorkspace) {
    const { materializePendingNewSession } = await import('@renderer/lib/new-session')
    sessionFile = await materializePendingNewSession(store.currentWorkspace, trimmed)
    sessionId = ''
  }
  const bind = await ipcClient.invoke('prompt.send', {
    sessionId,
    sessionFile,
    text: trimmed,
    capabilities,
  })
  const visibleFile = useUIStore.getState().historySessionFile
  if ((!sessionFile && !visibleFile) || sessionFilesEqual(visibleFile, sessionFile)) {
    const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
    await afterPromptSent(bind).catch((error) => console.warn('Could not refresh the sent prompt view:', error))
  }
  return true
}
