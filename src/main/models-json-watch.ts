import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/**
 * models.json 的外部变更监听。
 *
 * 为什么需要：只有走 `ipc:pi.models.set` 才会 `workerManager.reloadModels()`。手改文件、
 * 别的工具写、或 agent 自己 edit（本仓真实发生过）都不会触发，于是：
 *  - 已在跑的 worker 继续用旧模型表 → 聊天框的模型列表/上下文窗口不更新，必须重启客户端；
 *  - 旧表里 `contextWindow` 更小的话，pi 会提前触发压缩，模型随后反复说「快见底了」。
 *
 * 做法：监听**目录**而不是文件本体 —— 编辑器/写文件通常原子替换（rename 到目标名），
 * 直接 watch 文件会在替换后丢事件。事件按 basename 过滤 + 去抖，回调失败不影響监听。
 */
export type ModelsJsonWatch = { stop: () => void }

export type ModelsJsonWatchOptions = {
  modelsPath: string
  onChange: () => void
  /** 去抖窗口；写文件常见多次事件。 */
  debounceMs?: number
  /** 测试注入。 */
  watchFn?: typeof watch
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

export function startModelsJsonWatch(options: ModelsJsonWatchOptions): ModelsJsonWatch {
  const { modelsPath, onChange } = options
  const debounceMs = options.debounceMs ?? 400
  const watchFn = options.watchFn ?? watch
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const target = basename(modelsPath)

  let watcher: FSWatcher | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const fire = (): void => {
    if (stopped) return
    if (timer !== null) clearTimeoutFn(timer)
    timer = setTimeoutFn(() => {
      timer = null
      if (stopped) return
      try {
        onChange()
      } catch (error) {
        console.warn('[models-watch] onChange failed (ignored):', error)
      }
    }, debounceMs)
  }

  try {
    watcher = watchFn(dirname(modelsPath), { persistent: false }, (_event, filename) => {
      // filename 可能为 null（部分平台/挂载）；只在确切是别的文件时忽略。
      if (filename && filename.toString() !== target) return
      fire()
    })
    watcher.on?.('error', (error) => console.warn('[models-watch] watcher error:', error))
  } catch (error) {
    console.warn('[models-watch] cannot watch models.json:', error)
  }

  return {
    stop: () => {
      stopped = true
      if (timer !== null) clearTimeoutFn(timer)
      timer = null
      try {
        watcher?.close()
      } catch {
        /* already closed */
      }
      watcher = null
    },
  }
}
