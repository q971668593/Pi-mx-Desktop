import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { AskQuestionPayload } from '@renderer/features/extension-ui/questionnaire-model'
import type { ImageReviewPayload } from '@renderer/features/extension-ui/image-review-dialog'

export type ExtensionUIPending =
  | { id: string; method: 'ask_user_question'; questions: AskQuestionPayload[]; sessionFile?: string }
  | { id: string; method: 'select'; title: string; options: string[]; sessionFile?: string }
  | { id: string; method: 'confirm'; title: string; message: string; sessionFile?: string }
  | { id: string; method: 'input'; title: string; placeholder?: string; sessionFile?: string }
  | { id: string; method: 'image_review'; payload: ImageReviewPayload; sessionFile?: string }

export type ExtensionUISuspended = {
  requestId: string
  pending: ExtensionUIPending
  toolCallId?: string
  toolName?: string
  timelineItemId?: string
  background?: boolean
  suspendedAt: number
}

type ExtensionUIState = {
  activePending: ExtensionUIPending | null
  suspended: ExtensionUISuspended | null
  suspendedList: ExtensionUISuspended[]
  setActivePending: (p: ExtensionUIPending | null) => void
  parkBackgroundPending: (p: ExtensionUIPending) => void
  suspendActive: (meta: { toolCallId?: string; toolName?: string; timelineItemId?: string; background?: boolean }) => void
  resumeSuspended: () => void
  clearAfterRespond: () => void
  cancelForSession: (sessionFile: string | null) => void
  clearAllDialogs: () => void
  dismissById: (id: string) => void
  parkForSessionSwitch: () => void
  restoreForSession: (sessionFile: string) => void
  resetForSessionContext: () => void
  pruneStaleSuspension: () => void
}

/** 仅全屏弹窗打开时阻塞（挂起后已关弹窗，可发消息、可切会话） */
function hasOpenExtensionDialog(): boolean {
  return useExtensionUIStore.getState().activePending != null
}

export function findSuspendedForSession(
  list: readonly ExtensionUISuspended[],
  fallback: ExtensionUISuspended | null,
  sessionFile: string | null | undefined,
): ExtensionUISuspended | null {
  if (sessionFile) {
    const exact = [...list].reverse().find((s) => s.pending.sessionFile && sessionFilesEqual(s.pending.sessionFile, sessionFile))
    if (exact) return exact
  }
  if (fallback && pendingMatchesCurrentSession(fallback.pending, sessionFile)) return fallback
  return null
}

function upsertSuspended(list: readonly ExtensionUISuspended[], next: ExtensionUISuspended): ExtensionUISuspended[] {
  const sf = next.pending.sessionFile
  const filtered = list.filter(
    (s) => s.requestId !== next.requestId && (!sf || !s.pending.sessionFile || !sessionFilesEqual(s.pending.sessionFile, sf)),
  )
  return [...filtered, next]
}

function pruneStaleSuspension(): void {
  const { activePending, suspended, suspendedList } = useExtensionUIStore.getState()
  if (activePending) return
  if (!suspended && suspendedList.length === 0) return
  const items = useUIStore.getState().timelineItems
  const historySessionFile = useUIStore.getState().historySessionFile
  const current = findSuspendedForSession(suspendedList, suspended, historySessionFile)
  if (!current || current.background) return
  const tid = current.timelineItemId
  if (!tid) {
    const nextList = suspendedList.filter((s) => s.requestId !== current.requestId)
    useExtensionUIStore.setState({ suspendedList: nextList, suspended: nextList[nextList.length - 1] ?? null })
    return
  }
  const row = items.find((i) => i.id === tid)
  // 只有工具行明确结束（toolPhase === 'end'）或时间线里没有任何进行中的问答工具行时才清理；
  // 翻页/重载导致内存标记 extensionUiSuspended 丢失时，绝不能把挂起的问答误删。
  const hasLiveAskRow = items.some(
    (i) =>
      i.type === 'tool-call' &&
      (i.toolPhase === 'start' || i.toolPhase === 'update') &&
      (!current.toolCallId || i.toolCallId === current.toolCallId || i.toolName === current.toolName),
  )
  if (row?.toolPhase === 'end' || (!row && !hasLiveAskRow)) {
    const nextList = suspendedList.filter((s) => s.requestId !== current.requestId)
    useExtensionUIStore.setState({ suspendedList: nextList, suspended: nextList[nextList.length - 1] ?? null })
  }
}

function pendingSessionFile(pending: ExtensionUIPending | null | undefined): string | undefined {
  return pending?.sessionFile
}

export function pendingMatchesCurrentSession(
  pending: ExtensionUIPending | null | undefined,
  currentSessionFile: string | null | undefined,
): boolean {
  if (!pending) return false
  if (!pending.sessionFile) return true
  return !!currentSessionFile && sessionFilesEqual(pending.sessionFile, currentSessionFile)
}

function syncWaitingUi(sessionFile: string | undefined, waiting: boolean): void {
  const file = sessionFile || useUIStore.getState().historySessionFile
  if (!file) return
  useUIStore.getState().setSessionWaitingUi(file, waiting)
}

function cancelPendingDialog(reason: string): void {
  const { activePending, suspended } = useExtensionUIStore.getState()
  const id = activePending?.id ?? suspended?.requestId
  if (id) void ipcClient.invoke('extension.cancelUI', { id, reason }).catch(() => {})
}

export const useExtensionUIStore = create<ExtensionUIState>((set, get) => ({
  activePending: null,
  suspended: null,
  suspendedList: [],

  setActivePending: (p) => {
    const prev = get().activePending
    if (prev && (!p || prev.id !== p.id)) syncWaitingUi(pendingSessionFile(prev), false)
    if (p) syncWaitingUi(pendingSessionFile(p), true)
    set({ activePending: p })
  },

  parkBackgroundPending: (p) => {
    syncWaitingUi(pendingSessionFile(p), true)
    const next: ExtensionUISuspended = {
      requestId: p.id,
      pending: p,
      background: true,
      suspendedAt: Date.now(),
    }
    const nextList = upsertSuspended(get().suspendedList, next)
    set({
      suspendedList: nextList,
      suspended: get().suspended ?? next,
    })
  },

  suspendActive: (meta) => {
    const active = get().activePending
    if (!active) return
    syncWaitingUi(pendingSessionFile(active), true)
    const next: ExtensionUISuspended = {
      requestId: active.id,
      pending: active,
      toolCallId: meta.toolCallId,
      toolName: meta.toolName,
      timelineItemId: meta.timelineItemId,
      background: meta.background === true || (!meta.timelineItemId && !!active.sessionFile),
      suspendedAt: Date.now(),
    }
    const nextList = upsertSuspended(get().suspendedList, next)
    set({
      activePending: null,
      suspendedList: nextList,
      suspended: next,
    })
  },

  resumeSuspended: () => {
    const { suspendedList, suspended } = get()
    const currentFile = useUIStore.getState().historySessionFile
    const target = findSuspendedForSession(suspendedList, suspended, currentFile) ?? suspended
    if (!target) return
    syncWaitingUi(pendingSessionFile(target.pending), true)
    const nextList = suspendedList.filter((s) => s.requestId !== target.requestId)
    set({
      activePending: target.pending,
      suspendedList: nextList,
      suspended: nextList[nextList.length - 1] ?? null,
    })
  },

  clearAfterRespond: () => {
    const { activePending, suspended, suspendedList } = get()
    syncWaitingUi(pendingSessionFile(activePending), false)
    const nextList = activePending
      ? suspendedList.filter((s) => s.requestId !== activePending.id)
      : suspendedList.filter((s) => s.background)
    if (!nextList.length) syncWaitingUi(pendingSessionFile(suspended?.pending), false)
    set({
      activePending: null,
      suspendedList: nextList,
      suspended: nextList[nextList.length - 1] ?? null,
    })
  },

  cancelForSession: (sessionFile) => {
    const { activePending, suspended, suspendedList } = get()
    const all = [activePending, ...suspendedList.map((s) => s.pending), suspended?.pending]
    const pending = all.filter(
      (p): p is ExtensionUIPending => !!p && (!p.sessionFile || sessionFilesEqual(p.sessionFile, sessionFile)),
    )
    for (const id of new Set(pending.map((p) => p.id))) {
      void ipcClient.invoke('extension.cancelUI', { id, reason: 'user-abort' }).catch(() => {})
      get().dismissById(id)
    }
  },

  pruneStaleSuspension: () => pruneStaleSuspension(),

  clearAllDialogs: () => {
    const { activePending, suspended, suspendedList } = get()
    syncWaitingUi(pendingSessionFile(activePending || suspended?.pending), false)
    for (const item of suspendedList) syncWaitingUi(pendingSessionFile(item.pending), false)
    set({ activePending: null, suspended: null, suspendedList: [] })
  },

  dismissById: (id) => {
    const { activePending, suspended, suspendedList } = get()
    if (activePending?.id === id) {
      syncWaitingUi(pendingSessionFile(activePending), false)
      set({ activePending: null })
      return
    }
    const target = suspendedList.find((s) => s.requestId === id) ?? (suspended?.requestId === id ? suspended : null)
    if (target) {
      syncWaitingUi(pendingSessionFile(target.pending), false)
      const nextList = suspendedList.filter((s) => s.requestId !== id)
      set({ suspendedList: nextList, suspended: nextList[nextList.length - 1] ?? null })
    }
  },

  parkForSessionSwitch: () => {
    const active = get().activePending
    if (!active) return
    if (!active.sessionFile) {
      const currentFile = useUIStore.getState().historySessionFile
      if (currentFile) {
        set({ activePending: { ...active, sessionFile: currentFile } })
      }
    }
    get().suspendActive({ background: true })
  },

  restoreForSession: (sessionFile: string) => {
    const { suspendedList, suspended } = get()
    const match =
      [...suspendedList].reverse().find((s) => s.pending.sessionFile && sessionFilesEqual(s.pending.sessionFile, sessionFile)) ??
      (suspended?.pending.sessionFile && sessionFilesEqual(suspended.pending.sessionFile, sessionFile) ? suspended : null)
    if (!match) return
    syncWaitingUi(pendingSessionFile(match.pending), true)
    const nextList = suspendedList.filter((s) => s.requestId !== match.requestId)
    set({
      activePending: match.pending,
      suspendedList: nextList,
      suspended: nextList[nextList.length - 1] ?? null,
    })
  },

  resetForSessionContext: () => {
    const { activePending, suspended, suspendedList } = get()
    const currentFile = useUIStore.getState().historySessionFile
    const matched = findSuspendedForSession(suspendedList, suspended, currentFile)
    const targetId = activePending?.id ?? matched?.requestId
    if (targetId) void ipcClient.invoke('extension.cancelUI', { id: targetId, reason: 'session-reset' }).catch(() => {})
    syncWaitingUi(pendingSessionFile(activePending || matched?.pending), false)
    const nextList = matched ? suspendedList.filter((s) => s.requestId !== matched.requestId) : suspendedList
    set({
      activePending: null,
      suspendedList: nextList,
      suspended: nextList[nextList.length - 1] ?? null,
    })
    void import('@renderer/lib/extension-ui-channel').then((m) => m.clearExtensionDialogDedupe())
  },
}))

export function hasPendingExtensionUiForSession(
  state: Pick<ExtensionUIState, 'activePending' | 'suspended' | 'suspendedList'>,
  sessionFile: string | null | undefined,
): boolean {
  if (state.activePending && pendingMatchesCurrentSession(state.activePending, sessionFile)) return true
  const s = findSuspendedForSession(state.suspendedList, state.suspended, sessionFile)
  return !!s && s.background === true
}

export function extensionUiBlocksComposer(): boolean {
  pruneStaleSuspension()
  if (!hasOpenExtensionDialog()) return false
  const { runState, historySessionFile } = useUIStore.getState()
  const running = runState.status === 'running'
  // 无弹窗宿主可渲染的 pending（如 Worker 已超时 resolve）不应阻塞
  const p = useExtensionUIStore.getState().activePending
  if (!p) return false
  if (!pendingMatchesCurrentSession(p, historySessionFile)) return false
  if (!running) return false
  return true
}

