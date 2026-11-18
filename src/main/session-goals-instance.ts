import { app } from 'electron'
import { SessionGoalStore } from './session-goals'

let store: SessionGoalStore | null = null

/**
 * 进程内单例。userData 下的 session-goals.json（app 私有状态，与 pi 的 JSONL 无关）。
 * 首次取用时才解析 userData，方便测试里在 app ready 之前不碰 electron。
 */
export function getSessionGoalStore(): SessionGoalStore {
  if (!store) store = new SessionGoalStore(app.getPath('userData'))
  return store
}

/** 测试用：替换实例（不影响生产代码路径）。 */
export function resetSessionGoalStoreForTests(next: SessionGoalStore | null): void {
  store = next
}
