import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'
import { renderRichFromSegments, serializeRichInput, type AttachmentMeta, type Segment, type StagedImage } from './attachments'
import { segmentsToPromptPayload } from './attachment-text'
import { routeDesktopSlashBeforeSend } from '@renderer/lib/slash-desktop-router'
import { abortAgentTurn, isComposerAbortCooldown } from '@renderer/lib/composer-abort'
import { extensionUiBlocksComposer, useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import type { useComposerInputHistory } from './use-composer-input-history'
import { currentSessionCapabilities } from '@renderer/lib/session-capabilities'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { applyTitleFromLatestMessage } from '@renderer/lib/session-title-follow'
import { afterPromptSent } from '@renderer/lib/after-prompt-sent'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import { captureLessonFromUserText } from '@renderer/lib/feedback-lessons'
import { renderRichTextFromPlain } from './attachments'
import { appendOptimisticOutgoingMessage, bindOptimisticOutgoingToSession, clearOptimisticOutgoing } from '@renderer/lib/optimistic-send'
import {
  composerDraftContextKey,
  readTransientComposerDraft,
  readTransientComposerImages,
  rememberTransientComposerDraft,
  rememberTransientComposerImages,
} from './composer-transient-draft'

export function useComposerSend(opts: {
  editorRef: React.RefObject<HTMLDivElement | null>
  text: string
  attachments: { path: string }[]
  /** 已暂存、未发送的图片（不在编辑器里）。 */
  stagedImages: StagedImage[]
  setStagedImages: React.Dispatch<React.SetStateAction<StagedImage[]>>
  updateFromEditor: () => void
  clearEditor: () => void
  setContent: (plain: string) => void
  inputHistory: ReturnType<typeof useComposerInputHistory>
  refreshCommands: () => Promise<void>
  showComposerStop: boolean
  isRunning: boolean
}) {
  const { t } = useTranslation()
  const sendingRef = useRef(false)
  const {
    editorRef,
    text,
    stagedImages,
    setStagedImages,
    updateFromEditor,
    clearEditor,
    setContent,
    inputHistory,
    refreshCommands,
    showComposerStop,
    isRunning,
  } = opts

  const sendCurrent = useCallback(
    async (queueOpts?: { queue?: 'steer' | 'followUp' }) => {
      if (sendingRef.current) return
      sendingRef.current = true
      // Snapshot the switches the user sees now: sending a new chat creates its session file
      // before the prompt goes out, and the draft's switches move to it.
      const capabilities = currentSessionCapabilities()
      try {
        if (extensionUiBlocksComposer()) {
          toast.message(t('composer:toast.completeExtensionFirst'))
          return
        }
        // 压缩上下文期间 worker 不接受新 prompt：在这里拦下并保留输入，
        // 否则会出现“消息看着发出去了、却弹一个报错、文字还得重输”。
        const compactionStore = useUIStore.getState()
        const compactionKey = compactionStore.historySessionFile
        if (compactionKey && compactionStore.compactingSessions[compactionKey]) {
          toast.message(t('composer:toast.compactingWait'))
          return
        }
        const el = editorRef.current
        if (!el) return
        const { displayText, payload, attachments: atts, segments } = serializeRichInput(el)
        const inlinePaths = new Set(atts.map((a) => a.path))
        const extraStaged = stagedImages.filter((img) => !inlinePaths.has(img.path))
        const stagedSegments: Segment[] = extraStaged.map((img) => ({
          type: 'file',
          attachment: { path: img.path, name: img.name, kind: 'image' },
        }))
        const allSegments = stagedSegments.length ? [...segments, ...stagedSegments] : segments
        const allAtts: AttachmentMeta[] = stagedSegments.length
          ? [...atts, ...stagedSegments.map((s) => (s as { attachment: AttachmentMeta }).attachment)]
          : atts
        const promptText = stagedSegments.length ? segmentsToPromptPayload(allSegments) : payload
        const stagedSnapshot = stagedImages
        const trimmed = displayText.trim()
        if (!trimmed && allAtts.length === 0) return
        const store = useUIStore.getState()
        const creationOrigin = { state: store, navigationToken: getSessionNavigationToken() }
        const ownsSourceView = () => {
          const current = useUIStore.getState()
          return isSessionNavigationCurrent(creationOrigin.navigationToken) &&
            current.currentWorkspace === store.currentWorkspace &&
            current.currentSessionId === store.currentSessionId &&
            current.historySessionFile === store.historySessionFile
        }
        if (allAtts.length === 0 && isExecutableBuiltin(trimmed)) {
          clearEditor()
          await executeSlashCommand(trimmed, { refreshCommands })
          return
        }
        if (trimmed.startsWith('/')) {
          const routed = await routeDesktopSlashBeforeSend(trimmed)
          if (routed.handled) {
            clearEditor()
            return
          }
        }
        const draft = store.ephemeralSandboxDraft
        const currentWorkspace = store.currentWorkspace
        if (!currentWorkspace && !draft) return
        let sessionFile = store.historySessionFile ?? undefined
        /** 发送前已有会话文件 = 不是这条消息新建的会话（新建时 SDK 已用首条消息命名） */
        const hadSessionFile = !!sessionFile
        const running = composerTurnActive({
          historySessionFile: store.historySessionFile,
          workerLiveSnapshot: store.workerLiveSnapshot,
          sessionRuntimeRunning: store.sessionRuntimeRunning,
        })
        if (displayText.trim()) inputHistory.recordSent(displayText.trim())
        // 带批评/驳回信号的发言顺手记一条候选：主进程会让内置模型判断值不值得留成规则。
        // 纯后台行为，失败静默，不影响发送。
        captureLessonFromUserText(displayText.trim(), {
          sessionFile: store.historySessionFile ?? undefined,
          workspacePath: store.currentWorkspace || undefined,
        })
        hideAllDelayedTooltips()
        renderRichTextFromPlain(el, '')
        setStagedImages([])
        updateFromEditor()
        editorRef.current?.focus()
        const pendingNew = store.pendingNewSessionPlaceholder
        const homeMode = !store.currentSessionId && store.timelineItems.length === 0
        let optimisticToken: ReturnType<typeof appendOptimisticOutgoingMessage> = null
        let draftKey = composerDraftContextKey(store)
        rememberTransientComposerImages(draftKey, [])
        const promptPayload = () => ({
          sessionId: '',
          sessionFile,
          text: promptText,
          capabilities,
        })
        let promptAccepted = false
        const sendPrompt = async () => {
          const bind = await ipcClient.invoke('prompt.send', promptPayload())
          promptAccepted = true
          return bind
        }
        const pendMsg = trimmed
        try {
          const updateSentView = async (bind: Parameters<typeof afterPromptSent>[0]) => {
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              await afterPromptSent(bind)
            }
            // 对话名跟随最新消息：只对已有会话生效，不打扰新建会话的首条命名。
            if (hadSessionFile) {
              void applyTitleFromLatestMessage({
                sessionFile,
                workspaceId: currentWorkspace || undefined,
                text: promptText,
              })
            }
          }
          if (!running && draft) {
            if (ownsSourceView()) {
              optimisticToken = appendOptimisticOutgoingMessage(pendMsg, {
                bootstrap: true,
                attachments: allAtts,
                segments: allSegments,
              })
              useUIStore.getState().setPendingTurnStage('starting')
            }
            const { finalizeEphemeralSandboxOnFirstSend } =
              await import('@renderer/lib/ephemeral-sandbox')
            sessionFile = await finalizeEphemeralSandboxOnFirstSend(pendMsg, creationOrigin)
            draftKey = composerDraftContextKey({
              ...store,
              historySessionFile: sessionFile,
              ephemeralSandboxDraft: false,
              pendingNewSessionPlaceholder: false,
            })
            bindOptimisticOutgoingToSession(
              optimisticToken,
              sessionFile,
            )
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              useUIStore.getState().setPendingTurnStage('sending')
            }
            const bind = await sendPrompt()
            await updateSentView(bind)
            return
          }
          if (!running && (homeMode || pendingNew) && store.currentWorkspace) {
            if (ownsSourceView()) {
              optimisticToken = appendOptimisticOutgoingMessage(pendMsg, {
                bootstrap: true,
                attachments: allAtts,
                segments: allSegments,
              })
              useUIStore.getState().setPendingTurnStage('starting')
            }
            const { materializePendingNewSession } = await import('@renderer/lib/new-session')
            sessionFile = await materializePendingNewSession(store.currentWorkspace, pendMsg, (sessionFile) => {
              draftKey = composerDraftContextKey({
                ...store,
                historySessionFile: sessionFile,
                pendingNewSessionPlaceholder: false,
              })
              bindOptimisticOutgoingToSession(optimisticToken, sessionFile)
            }, creationOrigin)
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              useUIStore.getState().setPendingTurnStage('sending')
            }
            const bind = await sendPrompt()
            await updateSentView(bind)
            return
          }
          if (running) {
            const queue = queueOpts?.queue ?? 'steer'
            if (queue === 'steer') {
              const bind = await ipcClient.invoke('prompt.steer', promptPayload())
              promptAccepted = true
              await updateSentView(bind)
            } else {
              const bind = await ipcClient.invoke('prompt.followUp', promptPayload())
              promptAccepted = true
              await updateSentView(bind)
            }
            return
          }
          if (ownsSourceView()) {
            optimisticToken = appendOptimisticOutgoingMessage(pendMsg, { attachments: allAtts, segments: allSegments })
          }
          const bind = await sendPrompt()
          await updateSentView(bind)
        } catch (e) {
          console.error('Send failed:', e)
          if (!promptAccepted) {
            if (clearOptimisticOutgoing(optimisticToken)) {
              useUIStore.getState().setRunState({ status: 'idle' })
            }
            const ownsEditor = editorRef.current === el &&
              draftKey === composerDraftContextKey(useUIStore.getState())
            const currentDraft = ownsEditor
              ? serializeRichInput(el).segments
              : readTransientComposerDraft(draftKey) ?? []
            const restored = [...segments]
            if (currentDraft.length) restored.push({ type: 'text', text: '\n' }, ...currentDraft)
            rememberTransientComposerDraft(draftKey, restored)
            if (stagedSnapshot.length > 0) {
              if (ownsEditor) {
                setStagedImages((prev) => {
                  const merged = [
                    ...stagedSnapshot,
                    ...prev.filter((item) => !stagedSnapshot.some((s) => s.path === item.path)),
                  ]
                  rememberTransientComposerImages(draftKey, merged)
                  return merged
                })
              } else {
                const existing = readTransientComposerImages(draftKey) ?? []
                const merged = [
                  ...stagedSnapshot,
                  ...existing.filter((item) => !stagedSnapshot.some((s) => s.path === item.path)),
                ]
                rememberTransientComposerImages(draftKey, merged)
              }
            }
            if (ownsEditor) {
              renderRichFromSegments(el, restored)
              updateFromEditor()
            }
          }
          const poolFull = /WORKER_POOL_FULL:(\d+)/.exec(
            e instanceof Error ? e.message : String(e),
          )
          if (poolFull) {
            // 会话进程池满了：直接说清楚卡在哪、去哪儿改，别只吐一句“发送失败”。
            toast.error(t('composer:toast.poolFull', { limit: poolFull[1] }))
          } else {
            toast.error(t('composer:toast.sendFailed'))
          }
        }
      } finally {
        sendingRef.current = false
      }
    },
    [clearEditor, editorRef, inputHistory, refreshCommands, setStagedImages, stagedImages, t, updateFromEditor],
  )

  const handleSend = useCallback(
    () => sendCurrent(showComposerStop || isRunning ? { queue: 'steer' } : undefined),
    [isRunning, sendCurrent, showComposerStop],
  )

  const runComposerAbort = useCallback(
    async (currentText: string) => {
      useExtensionUIStore.getState().cancelForSession(useUIStore.getState().historySessionFile)
      await abortAgentTurn({ restoreEditorText: currentText, setEditorText: setContent })
    },
    [setContent],
  )

  const handleAbort = useCallback(() => {
    if (isComposerAbortCooldown(useUIStore.getState().historySessionFile)) return
    const el = editorRef.current
    const currentText = el ? serializeRichInput(el).displayText : text
    void runComposerAbort(currentText)
  }, [editorRef, runComposerAbort, text])

  return { sendCurrent, handleSend, runComposerAbort, handleAbort }
}
