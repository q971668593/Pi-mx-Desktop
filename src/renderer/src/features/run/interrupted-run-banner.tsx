import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient, onWorkerExit } from '@renderer/lib/ipc-client'
import { sendComposerPrompt } from '@renderer/lib/send-composer-prompt'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import { usePaneSessionIdentity, usePaneSessionState } from '@renderer/stores/pane-session-context'
import { openTurnReview } from '@renderer/features/review/turn-snapshot-panel'

export function InterruptedRunBanner() {
  const { t } = useTranslation('common')
  const { sessionFile, workspace: workspaceId } = usePaneSessionIdentity()
  const running = usePaneSessionState((state) => state.runState.status === 'running')
  const [interrupted, setInterrupted] = useState<{ sessionFile: string; runId?: string } | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!sessionFile || !workspaceId || running) return
    let active = true
    const refresh = () => {
      void ipcClient.invoke('session.interrupted', { workspaceId, sessionFile })
        .then(({ run }) => { if (active) setInterrupted(run ? { sessionFile, runId: run.runId } : null) })
        .catch(() => {})
    }
    refresh()
    const unsubscribe = onWorkerExit((info) => {
      if (sessionFilesEqual(info.sessionFile, sessionFile)) refresh()
    })
    return () => { active = false; unsubscribe() }
  }, [running, sessionFile, workspaceId])

  if (running || !sessionFile || interrupted?.sessionFile !== sessionFile) return null
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1 text-xs text-amber-800 dark:text-amber-300" role="status">
      <span className="mr-auto">{t('interrupted.message')}</span>
      {interrupted.runId && (
        <button type="button" className="rounded border px-2 py-1" onClick={() => openTurnReview({ runId: interrupted.runId })}>{t('interrupted.review')}</button>
      )}
      <button type="button" className="rounded border px-2 py-1" disabled={sending} onClick={() => {
        if (useUIStore.getState().historySessionFile !== sessionFile) return
        setSending(true)
        void sendComposerPrompt(t('interrupted.resumePrompt'))
          .then((sent) => { if (sent) setInterrupted(null) })
          .catch(() => toast.error(t('interrupted.resumeFailed')))
          .finally(() => setSending(false))
      }}>{t('interrupted.resume')}</button>
    </div>
  )
}
