import { ipcClient } from '@renderer/lib/ipc-client'

/** 回答一个扩展 UI 请求（select/confirm/input/ask_user_question…）。 */
export function respondToExtensionUI(payload: {
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
  result?: unknown
}): void {
  ipcClient.invoke('extension.respondUI', payload).catch(() => {})
}
