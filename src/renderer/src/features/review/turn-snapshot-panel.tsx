import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TurnSnapshot } from '@shared/turn-file-snapshot'

type ReviewRequest = { sessionFile: string; runId?: string; path?: string }
export const useTurnReviewRequest = create<{ request: ReviewRequest | null }>(() => ({ request: null }))

export function openTurnReview(options: { runId?: string; path?: string } = {}): void {
  const store = useUIStore.getState()
  if (!store.historySessionFile) return
  useTurnReviewRequest.setState({ request: { ...options, sessionFile: store.historySessionFile } })
  store.setActivePanel('review')
  store.revealRightPanel()
}

type SnapshotProps = {
  request: { workspaceId: string; sessionFile: string; runId: string }
  running: boolean
  focusPath?: string | null
  onRestored: () => void
}

export function TurnSnapshotPanel({ request, running, focusPath, onRestored }: SnapshotProps) {
  const { t } = useTranslation('review')
  const [snapshot, setSnapshot] = useState<TurnSnapshot | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restored, setRestored] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const { workspaceId, sessionFile, runId } = request

  useEffect(() => {
    let active = true
    void ipcClient.invoke('session.turnSnapshot', { workspaceId, sessionFile, runId })
      .then((result) => { if (active) setSnapshot(result?.snapshot ?? null) })
      .catch(() => {})
    return () => { active = false }
  }, [workspaceId, sessionFile, runId, running])

  if (!snapshot?.files.length) return null
  return (
    <section className="review-group">
      <div className="review-group-header">{t('snapshot.title')}</div>
      {snapshot.files.map(({ path, before, after }) => {
        const open = (expanded ?? focusPath) === path
        const isRestored = restored.includes(path)
        return (
          <div key={path} className="border-b border-border/40 px-2 py-1.5">
            <button type="button" aria-expanded={open} className="w-full break-words text-left text-xs"
              onClick={() => setExpanded(open ? '' : path)}>
              {path}
            </button>
            {open && (
              <>
                <div className="grid max-h-64 grid-cols-2 gap-1 overflow-auto py-2">
                  <div className="min-w-0 rounded bg-red-500/10 p-2">
                    <div className="mb-1 text-[11px]">{t('snapshot.before')}</div>
                    <pre className="whitespace-pre-wrap break-words text-[11px]">{before ?? t('snapshot.absent')}</pre>
                  </div>
                  <div className="min-w-0 rounded bg-emerald-500/10 p-2">
                    <div className="mb-1 text-[11px]">{t('snapshot.after')}</div>
                    <pre className="whitespace-pre-wrap break-words text-[11px]">{after}</pre>
                  </div>
                </div>
                <button type="button" className="rounded border px-2 py-1 text-[11px]"
                  disabled={running || restoring !== null || isRestored}
                  onClick={() => {
                    if (!window.confirm(t(before === null ? 'snapshot.confirmTrash' : 'snapshot.confirmRestore', { path }))) return
                    setRestoring(path)
                    void ipcClient.invoke('session.restoreTurnFile', { workspaceId, sessionFile, runId: snapshot.runId, path })
                      .then((result) => {
                        if (!result?.ok) {
                          toast.error(t(result?.error === 'conflict' ? 'snapshot.conflict' : result?.error === 'busy' ? 'snapshot.busy' : 'snapshot.failed'))
                          return
                        }
                        setRestored((paths) => [...paths, path])
                        onRestored()
                      })
                      .catch(() => toast.error(t('snapshot.failed')))
                      .finally(() => setRestoring(null))
                  }}>
                  {t(isRestored ? 'snapshot.restored' : before === null ? 'snapshot.trash' : 'snapshot.restore')}
                </button>
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}
