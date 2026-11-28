import { useUIStore } from '@renderer/stores/ui-store'
import { hasPendingExtensionUiForSession, useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { patchSessionState } from '@renderer/stores/session-scope'
import { sessionKeyOf } from '@renderer/stores/session-state'
import { getSessionState } from '@renderer/stores/use-view-session'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

export const INTERACTIVE_EXTENSION_TOOLS = new Set(['ask_user_question', 'image_review'])

function readSessionItems(sessionFile?: string | null): TimelineItem[] {
  if (!sessionFile || sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
    return useUIStore.getState().timelineItems
  }
  return getSessionState(sessionFile)?.timelineItems ?? []
}

function updateSessionTimelineItem(
  itemId: string,
  patch: Partial<TimelineItem>,
  sessionFile?: string | null,
): void {
  const store = useUIStore.getState()
  if (!sessionFile || sessionFilesEqual(store.historySessionFile, sessionFile)) {
    store.updateTimelineItem(itemId, patch)
    return
  }
  const key = sessionKeyOf(sessionFile)
  const entry = key ? store.sessionStates[key] : undefined
  if (!entry) return
  patchSessionState(key, {
    timelineItems: entry.timelineItems.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
  })
}

/** 弹窗打开时绑定到最近一条仍在运行的交互式工具行 */
export function linkExtensionDialogToToolRow(
  requestId: string,
  toolName: string,
  sessionFile?: string | null,
): void {
  const items = readSessionItems(sessionFile)
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type !== 'tool-call') continue
    if (it.toolName !== toolName) continue
    if (it.toolPhase !== 'start' && it.toolPhase !== 'update') continue
    updateSessionTimelineItem(
      it.id,
      {
        extensionUiRequestId: requestId,
        extensionUiSuspended: false,
      },
      sessionFile,
    )
    return
  }
}

export function clearExtensionToolRowFlags(
  timelineItemId?: string,
  sessionFile?: string | null,
): void {
  if (!timelineItemId) return
  updateSessionTimelineItem(
    timelineItemId,
    {
      extensionUiSuspended: false,
      extensionUiRequestId: undefined,
    },
    sessionFile,
  )
}

/**
 * 扩展 UI 已关闭且 Worker 未再推 tool end 时，避免交互工具行一直转圈。
 * 延迟一帧，优先让正常的 tool_execution_end 事件先落地。
 */
function finishStaleRow(it: { id: string }, sessionFile?: string | null): void {
  updateSessionTimelineItem(
    it.id,
    {
      toolPhase: 'end',
      extensionUiSuspended: false,
      extensionUiRequestId: undefined,
      toolStatusLine: undefined,
    },
    sessionFile,
  )
}

export function reconcileStaleInteractiveToolRows(
  requestId?: string,
  sessionFile?: string | null,
): void {
  requestAnimationFrame(() => {
    const targetFile = sessionFile ?? useUIStore.getState().historySessionFile
    if (hasPendingExtensionUiForSession(useExtensionUIStore.getState(), targetFile)) return

    const items = readSessionItems(sessionFile)
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.type !== 'tool-call') continue
      if (!INTERACTIVE_EXTENSION_TOOLS.has(it.toolName || '')) continue
      if (it.toolPhase !== 'start' && it.toolPhase !== 'update') continue
      if (requestId && it.extensionUiRequestId && it.extensionUiRequestId !== requestId) continue
      finishStaleRow(it, sessionFile)
      return
    }
  })
}

export function reconcileAllStaleInteractiveToolRows(): void {
  requestAnimationFrame(() => {
    const { activePending, suspended } = useExtensionUIStore.getState()
    if (activePending || suspended) return
    const items = useUIStore.getState().timelineItems
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.type !== 'tool-call') continue
      if (!INTERACTIVE_EXTENSION_TOOLS.has(it.toolName || '')) continue
      if (it.toolPhase !== 'start' && it.toolPhase !== 'update') continue
      finishStaleRow(it)
    }
  })
}

export function findRunningInteractiveToolRow(toolName: string): string | undefined {
  const items = useUIStore.getState().timelineItems
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type !== 'tool-call') continue
    if (it.toolName !== toolName) continue
    if (it.toolPhase === 'start' || it.toolPhase === 'update') return it.id
  }
  return undefined
}