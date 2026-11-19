import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { titleFromFirstMessage } from '@renderer/lib/ephemeral-sandbox'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { workspacePathsEqual } from '@shared/workspace-path'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { reportVisibleSession } from '@renderer/lib/visible-session-report'
import { mergePendingSessionRows, pinPendingSessionRow } from '@renderer/lib/pending-session-rows'

/** 侧栏「新会话」：仅占位，不碰 Worker */
export function enterNewSessionPlaceholder(): void {
  enterBlankSession('pending-project')
}

/** 首条消息：创建真实 session，立即回调 sessionFile，配置完成后返回发送目标。 */
export async function materializePendingNewSession(
  workspaceId: string,
  firstMessage: string,
  onSessionCreated?: (sessionFile: string) => void,
  origin = { state: useUIStore.getState(), navigationToken: getSessionNavigationToken() },
): Promise<string> {
  if (!workspaceId) throw new Error('A workspace is required to create a session')
  const store = origin.state

  const title = titleFromFirstMessage(firstMessage, 48) || '新会话'

  const res = await ipcClient.invoke('session.new', { workspaceId })
  const sessionId = res?.session?.sessionId
  if (!sessionId) throw new Error('session.new returned no sessionId')

  const sessionFile = res?.session?.sessionFile as string | undefined
  if (!sessionFile) throw new Error('session.new returned no sessionFile')

  const current = useUIStore.getState()
  const ownsView = isSessionNavigationCurrent(origin.navigationToken) &&
    current.currentWorkspace === store.currentWorkspace &&
    current.currentSessionId === store.currentSessionId &&
    current.historySessionFile === store.historySessionFile
  if (ownsView) {
    // The draft the first turn was typed in becomes this session (optimistic turn included);
    // a view that moved on keeps its own state.
    store.promoteViewSession({ sessionId, sessionFile })
    store.clearFileChanges()
    // The draft was reported as "no session on screen"; completion alerts and inbox read state
    // must see this conversation as the visible one.
    reportVisibleSession(sessionFile)
  }
  insertSessionRowOptimistically(workspaceId, { sessionId, sessionFile, title })
  // The sidebar must not wait for model/thinking application (or the rest of the turn): the row is
  // pinned now and the list catches up in the background.
  void refreshNewSessionInList(workspaceId)
  // The caller still needs the file when creation finishes in the background.
  onSessionCreated?.(sessionFile)
  if (ownsView) {
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  }

  // Apply the user's pre-selected model/thinking level to the new session. Sequential on purpose:
  // the thinking level is clamped against the model's supported levels, so it must follow a
  // confirmed model switch (and is skipped when the switch is rejected).
  // `store` is the snapshot taken when the user sent, while the view was the draft: these are the
  // draft's own choices, not whatever session is visible now.
  const { runState } = store
  if (sessionFile) {
    if (runState.model && runState.model.includes('/')) {
      const [provider, ...modelIdParts] = runState.model.split('/')
      const modelId = modelIdParts.join('/')
      const modelResult = await ipcClient.invoke('model.set', {
        sessionId: '',
        sessionFile,
        provider,
        modelId,
      })
      const requestedModel = `${provider}/${modelId}`
      if (modelResult.modelId !== requestedModel) {
        throw new Error(`Model selection was not confirmed: ${modelResult.modelId || 'unknown'}`)
      }
    }
    if (runState.thinkingLevel) {
      await ipcClient.invoke('thinkingLevel.set', {
        sessionId: '',
        sessionFile,
        level: runState.thinkingLevel,
      })
    }
  }

  if (isSessionNavigationCurrent(origin.navigationToken) &&
      sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
    const { refreshComposerRunDisplay } = await import('@renderer/lib/composer-run-display')
    void refreshComposerRunDisplay()
  }

  return sessionFile
}

function insertSessionRowOptimistically(
  workspaceId: string,
  created: { sessionId: string; sessionFile?: string; title: string },
): void {
  const store = useUIStore.getState()
  // Pin first: even when the store currently shows another workspace, the row must survive the
  // next list refresh for its own workspace.
  const pinned = {
    sessionId: created.sessionId,
    sessionFile: created.sessionFile,
    title: created.title,
    updatedAt: Date.now(),
    // 用户刚发出第一条消息：侧栏要靠这个立刻排到最上面
    lastUserMessageAt: Date.now(),
    messageCount: 0,
    modelId: '',
  } as SessionItem
  pinPendingSessionRow(workspaceId, pinned)
  if (store.sessionsWorkspace && !workspacePathsEqual(store.sessionsWorkspace, workspaceId)) return
  const current = store.sessions ?? []
  if (current.some((s) => s.sessionId === created.sessionId)) return
  // No merge here: the row is the pin, and a merge would be free to treat its own title as settled.
  store.setSessions([pinned, ...current], workspaceId)
}

async function refreshNewSessionInList(workspaceId: string): Promise<void> {
  // `refresh: true` bypasses the list-process cache that was filled before the session existed.
  const listRes = await ipcClient.invoke('session.list', { workspaceId, refresh: true }).catch(() => null)
  // A failed enumeration must not blank the sidebar: the optimistic rows stay pinned anyway.
  if (!listRes) return
  const list = (listRes.sessions || []) as SessionItem[]
  useUIStore.getState().setSessions(mergePendingSessionRows(list, workspaceId), workspaceId)
}
