import { app } from 'electron'
import { join } from 'node:path'
import { createRunLedger, type RunLedger } from './run-ledger'

/**
 * 主进程侧的单例装配。`run-ledger.ts` 本身不 import electron，方便纯单测；
 * 这里只负责把 `userData` 路径与日志接上。
 */
let instance: RunLedger | null = null

export function getRunLedger(): RunLedger {
  if (!instance) {
    instance = createRunLedger({
      filePath: join(app.getPath('userData'), 'run-ledger.json'),
      onError: (error) => {
        console.warn('[RunLedger] 写入或读取失败（不影响主流程）:', error)
      },
    })
  }
  return instance
}
