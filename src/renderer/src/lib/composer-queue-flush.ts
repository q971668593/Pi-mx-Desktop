import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { currentSessionCapabilities } from '@renderer/lib/session-capabilities'
import { useUIStore } from '@renderer/stores/ui-store'

export type FlushQueueResult = {
  flushed: number
  mode: 'steer' | 'prompt' | 'none' | 'error'
  error?: string
}

/**
 * 主动「立即发送」排队消息。
 *
 * 默认行为不变：排队消息继续挂在 pi 的队列里，等它自己选合适时机（steer 在工具批次结束、
 * followUp 在整轮结束）投递。只有用户点了这个按钮（或按 Ctrl/Cmd+Enter）才提前送出去：
 *  - 正在跑：全部提升为 steer，落在最靠前的可投递点，不杀当前工具调用；
 *  - 已空闲：直接开新一轮，消息马上出去。
 */
export async function flushQueuedMessages(): Promise<FlushQueueResult> {
  const store = useUIStore.getState()
  const queued = store.pendingSteering.length + store.pendingFollowUp.length
  if (!queued) {
    toast.message('没有排队消息')
    return { flushed: 0, mode: 'none' }
  }
  try {
    const res = (await ipcClient.invoke('prompt.flushQueue', {
      sessionFile: store.historySessionFile ?? undefined,
      capabilities: currentSessionCapabilities(),
    })) as FlushQueueResult | undefined
    const result: FlushQueueResult = {
      flushed: res?.flushed ?? 0,
      mode: res?.mode ?? 'none',
      error: res?.error,
    }
    if (result.mode === 'error') {
      toast.error(`立即发送失败：${result.error || '未知错误'}`)
      return result
    }
    if (!result.flushed) {
      toast.message('队列是空的，没有可立即发送的消息')
      return result
    }
    if (result.mode === 'steer') {
      toast.info(`已立即注入 ${result.flushed} 条消息`)
    } else {
      toast.success(`已立即发送 ${result.flushed} 条排队消息`)
    }
    return result
  } catch (e) {
    console.error('flushQueue failed', e)
    toast.error('立即发送队列失败')
    return { flushed: 0, mode: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}
