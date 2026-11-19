import { app } from 'electron'
import { join } from 'node:path'
import { createSessionModelOverrides, type SessionModelOverrides } from './session-model-overrides'

/**
 * 主进程单例装配：`session-model-overrides.ts` 不 import electron，纯逻辑可单测；
 * 这里只负责把 userData 路径与日志接上（与 run-ledger-instance 同款）。
 */
let instance: SessionModelOverrides | null = null

/** `app` is unavailable in a few test harnesses; then the store stays in memory. */
function overridesFilePath(): string | undefined {
  try {
    return join(app.getPath('userData'), 'session-model-overrides.json')
  } catch {
    return undefined
  }
}

export function getSessionModelOverrides(): SessionModelOverrides {
  if (!instance) {
    instance = createSessionModelOverrides({
      filePath: overridesFilePath(),
      onError: (error) => {
        console.warn('[SessionModelOverrides] 读写失败（不影响切模型）:', error)
      },
    })
  }
  return instance
}
