import { ipcClient } from '@renderer/lib/ipc-client'
import { deriveSessionTitle } from '@shared/session-list-title'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'

/**
 * 侧栏「对话名跟随最新消息」开关。
 * 打开后，每发出一条用户消息就把该会话在磁盘上的标题改成这条消息的首行。
 */

let cached: boolean | null = null
let inFlight: Promise<boolean> | null = null

export function rememberTitleFollowsLatest(value: boolean): void {
  cached = value
}

export function titleFollowsLatestCached(): boolean | null {
  return cached
}

export async function isTitleFollowsLatest(): Promise<boolean> {
  if (cached !== null) return cached
  if (!inFlight) {
    inFlight = ipcClient
      .invoke('settings.get', { key: 'sessionTitleFollowsLatest' })
      .then((res) => {
        const value = (res as { settings?: Record<string, unknown> } | null)?.settings
          ?.sessionTitleFollowsLatest
        cached = value === true
        return cached
      })
      .catch(() => false)
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

export async function setTitleFollowsLatest(value: boolean): Promise<void> {
  cached = value
  await ipcClient.invoke('settings.set', { key: 'sessionTitleFollowsLatest', value })
  window.dispatchEvent(
    new CustomEvent('pi-desktop:settings-changed', { detail: { key: 'sessionTitleFollowsLatest' } }),
  )
}

/** 发送成功后调用：把会话标题改成这条消息的首行（仅当开关打开且会话已存在）。 */
export async function applyTitleFromLatestMessage(opts: {
  sessionFile?: string
  sessionId?: string
  workspaceId?: string
  text: string
}): Promise<void> {
  if (!opts.sessionFile) return
  if (!(await isTitleFollowsLatest())) return
  const title = deriveSessionTitle(opts.text)
  if (!title) return
  try {
    const result = (await ipcClient.invoke('session.rename', {
      sessionId: opts.sessionId || '',
      sessionFile: opts.sessionFile,
      title,
      workspaceId: opts.workspaceId,
    })) as { ok?: boolean } | null
    if (result?.ok) {
      await refreshWorkspaceSessionLists(
        opts.workspaceId ? { workspaceIds: [opts.workspaceId] } : undefined,
      )
    }
  } catch (error) {
    console.error('[sessionTitleFollow]', error)
  }
}
