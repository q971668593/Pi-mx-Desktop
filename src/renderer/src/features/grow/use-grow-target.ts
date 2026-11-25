import { useCallback, useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { findGrowSessionId } from './grow-round'

const memoryDrafts = new Set<string>()
export function growDraftPrefix(workspace: string, sessionFile: string | null, tree: string) {
  return `grow-draft:${encodeURIComponent(workspace)}:${encodeURIComponent(sessionFile ?? '')}:${encodeURIComponent(tree)}:`
}
export function trackGrowDraft(key: string, present: boolean) {
  if (present) memoryDrafts.add(key)
  else memoryDrafts.delete(key)
}
export function hasGrowMemoryDraft(prefix: string) {
  return [...memoryDrafts].some((key) => key.startsWith(prefix))
}

export async function resolveGrowTarget(workspace: string, sessionFile: string, fallback?: string): Promise<string | undefined> {
  const result = await ipcClient.invoke('grow:listSessions', { workspaceId: workspace, action: 'getBinding', sessionFile })
  if (!result?.ok) throw new Error('binding_failed')
  return result.sessionId || fallback
}

export function useGrowTarget(workspace: string | null, sessionFile: string | null, fallback?: string) {
  const [value, setValue] = useState<{ key: string; id?: string; error?: boolean }>({ key: '' })
  const key = JSON.stringify([workspace, sessionFile, fallback])
  const refresh = useCallback(async () => {
    if (!workspace || !sessionFile) { setValue({ key, id: fallback }); return }
    try { setValue({ key, id: await resolveGrowTarget(workspace, sessionFile, fallback) }) }
    catch { setValue({ key, error: true }) }
  }, [workspace, sessionFile, fallback, key])
  useEffect(() => {
    let live = true
    let sequence = 0
    const load = async () => {
      const current = ++sequence
      if (!workspace || !sessionFile) { if (live) setValue({ key, id: fallback }); return }
      try { const id = await resolveGrowTarget(workspace, sessionFile, fallback); if (live && current === sequence) setValue({ key, id }) }
      catch { if (live && current === sequence) setValue({ key, error: true }) }
    }
    void load()
    window.addEventListener('grow:binding-changed', load)
    return () => { live = false; window.removeEventListener('grow:binding-changed', load) }
  }, [workspace, sessionFile, fallback, key])
  return { id: value.key === key ? value.id : undefined, error: value.key === key && !!value.error, loading: value.key !== key, refresh }
}

export async function isCurrentGrowTarget(workspace: string, sessionId: string): Promise<boolean> {
  const before = useUIStore.getState()
  const file = before.historySessionFile
  if (!file || before.currentWorkspace !== workspace) return false
  const target = await resolveGrowTarget(workspace, file, findGrowSessionId(before.timelineItems))
  const after = useUIStore.getState()
  return after.currentWorkspace === workspace && after.historySessionFile === file && target === sessionId
}
