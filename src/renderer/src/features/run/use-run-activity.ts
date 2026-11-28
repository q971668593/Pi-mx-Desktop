import { useEffect, useState } from 'react'
import { useSessionChrome } from '@renderer/lib/session-chrome'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useViewRetryInfo } from '@renderer/features/composer/composer-retry-banner'

export function useRunActivity() {
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const sessionKey = sessionFile ? normalizeSessionFileKey(sessionFile) || sessionFile : null
  const waitingForInput = useExtensionUIStore((s) => {
    const pending = s.activePending ?? (s.suspended?.background ? null : s.suspended?.pending)
    return !!pending && (!pending.sessionFile || normalizeSessionFileKey(pending.sessionFile) === sessionKey)
  })
  const compacting = useUIStore((s) => sessionKey != null && s.compactingSessions[sessionKey] === true)
  const retry = useViewRetryInfo()
  const chrome = useSessionChrome({ extensionDialogOpen: waitingForInput, compacting, retrying: !!retry })
  const startTime = useUIStore((s) => s.runState.status === 'running' ? s.runState.startTime : undefined)
  const pendingStage = useUIStore((s) => s.agentTurnBootstrapping ? s.pendingTurnStage : null)
  const output = useUIStore((s) => {
    if (!s.streamingAssistantId) return null
    const tail = s.timelineItems[s.timelineItems.length - 1]
    const item = tail?.id === s.streamingAssistantId
      ? tail
      : s.timelineItems.find((row) => row.id === s.streamingAssistantId)
    if (item?.text) return 'reply'
    return item?.thinkingText ? 'thinking' : null
  })

  const { phase, activeToolName, showSpinner } = chrome
  const showCompaction = phase !== 'stopping' && compacting
  const showRetry = phase !== 'stopping' && !showCompaction && retry != null
  let statusKey = chrome.statusLabelKey
  if (showCompaction) statusKey = 'run:compacting'
  else if (showRetry) statusKey = 'run:status.retrying'
  else if (pendingStage === 'starting' && (phase === 'idle' || phase === 'starting' || phase === 'streaming')) {
    statusKey = 'run:status.starting'
  } else if (phase === 'idle') statusKey = 'run:status.idle'
  else if (phase === 'failed') statusKey = 'run:status.failed'
  else if (phase === 'starting' || phase === 'streaming') {
    if (output === 'thinking') statusKey = 'run:status.thinking'
    else if (output === 'reply') statusKey = 'run:status.replying'
    else statusKey = 'run:status.waitingModel'
  }

  return {
    chrome,
    active: showSpinner || showCompaction || showRetry || statusKey === 'run:status.starting',
    statusKey,
    startTime,
    retry: showRetry ? retry : null,
    tool: phase === 'tool' ? activeToolName : undefined,
  }
}

export function useRunClock(active: boolean): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => tick((count) => count + 1), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return Date.now()
}

export function elapsedTime(ms: number): { minutes: number; seconds: number } {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }
}
