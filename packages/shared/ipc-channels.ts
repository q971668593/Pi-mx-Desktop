/**
 * Renderer preload allowlist —— 唯一事实源在 `src/main` 的 `registerHandler` 注册点。
 *
 * 本文件只是「薄壳」：数组本体由 `scripts/generate-ipc-channels.mjs` 生成到
 * `./ipc-channels.generated.ts`（运行 `npm run gen:ipc` 更新），这里只负责
 * 集合查找与类型守卫。**请勿在本文件里手写通道字符串** —— 
 * `scripts/tests/ipc-channel-sync.test.mjs` 会在检测到硬编码通道时失败。
 */
import { IPC_INVOKE_CHANNELS } from './ipc-channels.generated'

export { IPC_INVOKE_CHANNELS }

export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[number]

const channelSet = new Set<string>(IPC_INVOKE_CHANNELS)

export function isAllowedIpcChannel(channel: string): channel is IpcInvokeChannel {
  return channelSet.has(channel)
}
