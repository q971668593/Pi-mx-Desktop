import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import { onModelCatalogChanged } from '@renderer/lib/ipc-client'

/**
 * models.json 被**外部**改动（手改、别的工具、agent 自己 edit）时，主进程会重载所有 worker
 * 并广播 `ipc:model-catalog-changed`。界面这边的模型快照是模块级缓存，必须同时失效，
 * 否则聊天框的模型列表 / 思考程度 / 上下文窗口会一直用旧值到重启为止。
 *
 * 走设置页保存（`ipc:pi.models.set`）时由保存流程自己失效缓存，这里只兜外部写入。
 */
export function initModelCatalogSync(): () => void {
  return onModelCatalogChanged(() => {
    invalidateAvailableModels()
    prefetchAvailableModels()
  })
}
