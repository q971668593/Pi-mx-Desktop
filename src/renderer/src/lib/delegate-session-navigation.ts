import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { previewSessionInPlace } from '@renderer/lib/activate-workspace'
import { beginSessionNavigation, assertSessionNavigation } from '@renderer/lib/session-navigation'
import type { DelegateRun } from '@renderer/lib/delegate-runs'
import type { SubagentSessionGroup } from '@renderer/lib/subagent-session-types'
import { useUIStore } from '@renderer/stores/ui-store'

/**
 * 打开一个 acp_delegate 子 Agent 的会话（只读预览）。
 *
 * 和 pi-subagents 那套 tree 卡不同，acp_delegate 的子会话不在父会话目录里，
 * 而是宿主进程写在系统 temp 的 `<runId>.session.jsonl`，所以不能复用
 * collectSubagentSessionChildren —— 这里自己拼 SubagentSessionGroup：
 * 有了这个 group，侧栏和「返回上一级」才知道这个预览属于谁。
 */
export async function openDelegateSessionPreview(run: DelegateRun): Promise<boolean> {
  const state = useUIStore.getState()
  const workspacePath = state.currentWorkspace
  const parentSessionId = state.currentSessionId
  const parentSessionFile = state.historySessionFile
  if (!workspacePath || !parentSessionId || !parentSessionFile) return false

  const navToken = beginSessionNavigation()

  const resolved = await ipcClient
    .invoke('delegate.sessionFiles', { runIds: [run.runId] })
    .catch(() => null)
  const sessionFile = resolved?.files?.[run.runId] ?? null
  if (!sessionFile) {
    toast.error('找不到这个子 Agent 的会话文件（可能已被系统临时目录清理）')
    return false
  }

  const prepared = await ipcClient
    .invoke('session.prepare', { sessionFile, bind: false })
    .catch(() => null)
  if (!prepared?.sessionId || !assertSessionNavigation(navToken)) return false

  const preparedSessionFile = typeof prepared.sessionFile === 'string' && prepared.sessionFile.trim()
    ? prepared.sessionFile
    : sessionFile
  const group: SubagentSessionGroup = {
    workspacePath,
    parentSessionId,
    parentSessionFile,
    previewSessionFile: preparedSessionFile,
    children: [
      {
        key: run.runId,
        agent: run.agent,
        task: run.task,
        state: run.state === 'running' ? 'running' : run.state === 'failed' ? 'failed' : 'completed',
        sessionFile: preparedSessionFile,
      },
    ],
  }
  useUIStore.getState().setSubagentSessionGroup(group)
  await previewSessionInPlace(prepared.sessionId, preparedSessionFile, navToken)
  return true
}
