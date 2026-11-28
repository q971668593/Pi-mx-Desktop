import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionKeyOf } from '@renderer/stores/session-state'
import { patchSessionState } from '@renderer/stores/session-scope'
import {
  composerDraftContextKey,
  readTransientComposerDraft,
  rememberTransientComposerDraft,
} from '@renderer/features/composer/composer-transient-draft'
import { applyTitleFromLatestMessage } from '@renderer/lib/session-title-follow'
import { cn } from '@renderer/lib/utils'
import type { PaneSession } from './split-layout'

function draftToText(key: string): string {
  const segs = readTransientComposerDraft(key)
  if (!segs?.length) return ''
  return segs
    .filter((s) => s.type === 'text')
    .map((s) => (s as { text?: string }).text ?? '')
    .join('')
}

/**
 * 非激活分屏的独立输入框：草稿按该分屏会话隔离存放，发送直接打到该会话，
 * 不切激活、不抢主输入框。主分屏的完整 Composer 不受影响。
 */
export function PaneQuickComposer({ session }: { session: PaneSession }) {
  const { t } = useTranslation()
  const draftKey = composerDraftContextKey({
    historySessionFile: session.sessionFile,
    ephemeralSandboxDraft: false,
    pendingNewSessionPlaceholder: false,
    currentWorkspace: session.workspace,
    currentSessionId: session.sessionId,
  })
  const [text, setText] = useState(() => draftToText(draftKey))
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const running = useUIStore((s) => {
    const key = sessionKeyOf(session.sessionFile)
    if (s.sessionStates[key]?.runState.status === 'running') return true
    return Object.entries(s.sessionRuntimeRunning ?? {}).some(
      ([file, on]) => on && sessionFilesEqual(file, session.sessionFile),
    )
  })
  const modelId = useUIStore((s) =>
    s.sessions.find((x) => sessionFilesEqual(x.sessionFile, session.sessionFile))?.modelId,
  )

  useEffect(() => {
    setText(draftToText(draftKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  const onChange = useCallback(
    (value: string) => {
      setText(value)
      rememberTransientComposerDraft(draftKey, value ? [{ type: 'text', text: value }] : [])
    },
    [draftKey],
  )

  const send = useCallback(async () => {
    const raw = text.trim()
    if (!raw || sendingRef.current) return
    const trimmed = raw.slice(0, 20000)
    const key = sessionKeyOf(session.sessionFile)
    if (!key) return
    sendingRef.current = true
    setSending(true)
    // 发送瞬间重读运行态，避免 render 快照过期选错通道。
    const nowState = useUIStore.getState()
    const isRunning =
      nowState.sessionStates[key]?.runState.status === 'running' ||
      Object.entries(nowState.sessionRuntimeRunning ?? {}).some(
        ([file, on]) => on && sessionFilesEqual(file, session.sessionFile),
      )
    const state = nowState
    const entry = state.sessionStates[key]
    const ts = Date.now()
    const userId = `opt-user-q-${ts}`
    const assistantId = `opt-asst-q-${ts}`
    const prevItems = entry?.timelineItems ?? []
    try {
      patchSessionState(key, {
        timelineItems: [
          ...prevItems,
          { id: userId, type: 'user-message', text: trimmed, timestamp: ts } as never,
          { id: assistantId, type: 'assistant-message', text: '', thinkingText: '', timestamp: ts + 1 } as never,
        ],
        streamingAssistantId: assistantId,
        optimisticPendingUserText: trimmed,
        agentTurnBootstrapping: true,
        pendingTurnStage: 'sending',
        runState: { ...(entry?.runState ?? { status: 'idle', toolCount: 0, errorCount: 0 }), status: 'running', startTime: ts } as never,
      })
      state.setSessionRuntimeRunning(session.sessionFile, true)
      onChange('')
      if (isRunning) {
        await ipcClient.invoke('prompt.steer', { sessionFile: session.sessionFile, text: trimmed })
      } else {
        await ipcClient.invoke('prompt.send', { sessionFile: session.sessionFile, text: trimmed })
      }
      void applyTitleFromLatestMessage({
        sessionFile: session.sessionFile,
        workspaceId: session.workspace || undefined,
        text: trimmed,
      }).catch(() => {})
    } catch (error) {
      const latest = useUIStore.getState()
      const cur = latest.sessionStates[key]
      // 只回滚本次乐观轮次仍挂着时避免误伤并发跑起来的另一轮。
      if (cur && cur.streamingAssistantId === assistantId) {
        patchSessionState(key, {
          timelineItems: (cur.timelineItems ?? []).filter((item) => item.id !== userId && item.id !== assistantId),
          streamingAssistantId: null,
          optimisticPendingUserText: null,
          agentTurnBootstrapping: false,
          pendingTurnStage: null,
          runState: { ...cur.runState, status: 'idle' } as never,
        })
        latest.setSessionRuntimeRunning(session.sessionFile, false)
      }
      // 合并而非覆盖：失败时把没发出去的话接回用户新输入后面。
      setText((prev) => (prev ? `${prev}\n${trimmed}` : trimmed))
      rememberTransientComposerDraft(draftKey, [{ type: 'text', text: (text ? `${text}\n${trimmed}` : trimmed) }])
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [draftKey, onChange, session.sessionFile, session.workspace, text])

  return (
    <div
      className="shrink-0 border-t border-border/60 bg-[var(--bg-1)] px-3 pb-2.5 pt-2"
      onMouseDownCapture={(e) => e.stopPropagation()}
      onFocusCapture={(e) => e.stopPropagation()}
    >
      <div className="flex items-end gap-1.5">
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder={t('common:split.quickInputPh')}
          aria-label={t('common:split.quickInputPh')}
          className={cn(
            'min-h-[34px] max-h-[120px] flex-1 resize-none rounded-lg border border-border bg-[var(--bg-0)]',
            'px-2.5 py-1.5 text-[12.5px] leading-relaxed outline-none focus:border-primary',
          )}
        />
        <button
          type="button"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
          className="flex h-8 shrink-0 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
        >
          {sending ? t('common:split.sending') : running ? t('common:split.steer') : t('common:split.send')}
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10.5px] text-foreground-tertiary">
        {running ? (
          <span className="text-amber-600 dark:text-amber-400">{t('common:split.card.replyingInline')}</span>
        ) : null}
        {modelId ? <span className="truncate font-mono">{modelId}</span> : null}
      </div>
    </div>
  )
}
