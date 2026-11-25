import type { ModelInfo } from '@shared/ipc-contract'
import { ipcClient } from '@renderer/lib/ipc-client'

let snapshot: ModelInfo[] = []
let inFlight: { generation: number; promise: Promise<ModelInfo[]> } | null = null
let generation = 0
let invalidated = true
const listeners = new Set<(models: ModelInfo[]) => void>()

/**
 * Right after a cold start neither the worker's model runtime nor the preview process may be
 * ready, and the main side reports that as an empty list (or a failure). An empty snapshot is
 * therefore never treated as settled: it is retried a few times on its own.
 */
const EMPTY_RETRY_DELAYS_MS = [800, 2000, 4000, 8000]
let emptyRetries = 0
let emptyRetryTimer: ReturnType<typeof setTimeout> | null = null

function clearEmptyRetry(): void {
  if (emptyRetryTimer !== null) clearTimeout(emptyRetryTimer)
  emptyRetryTimer = null
}

function scheduleEmptyRetry(): void {
  if (emptyRetryTimer !== null || emptyRetries >= EMPTY_RETRY_DELAYS_MS.length) return
  emptyRetryTimer = setTimeout(() => {
    emptyRetryTimer = null
    if (snapshot.length > 0) return
    void refreshAvailableModels().catch(() => {})
  }, EMPTY_RETRY_DELAYS_MS[emptyRetries++])
}

export function peekAvailableModels(): ModelInfo[] {
  return snapshot
}

/** True while a request is in flight or an empty list is about to be retried. */
export function isAvailableModelsPending(): boolean {
  return inFlight !== null || emptyRetryTimer !== null
}

export function subscribeAvailableModels(listener: (models: ModelInfo[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function refreshAvailableModels(): Promise<ModelInfo[]> {
  const requestGeneration = generation
  if (inFlight?.generation === requestGeneration) return inFlight.promise
  invalidated = false
  const invokeResult = ipcClient.invoke('model.list', { scope: 'available' })
  const promise = (invokeResult && typeof (invokeResult as PromiseLike<unknown>).then === 'function'
    ? Promise.resolve(invokeResult)
    : Promise.resolve({ models: snapshot }))
    .then((res) => {
      if (inFlight?.promise === promise) inFlight = null
      if (requestGeneration !== generation) return snapshot
      snapshot = Array.isArray(res?.models) ? res.models : []
      if (snapshot.length > 0) {
        emptyRetries = 0
        clearEmptyRetry()
      } else {
        invalidated = true
        scheduleEmptyRetry()
      }
      for (const listener of listeners) listener(snapshot)
      return snapshot
    })
    .catch((error) => {
      if (inFlight?.promise === promise) inFlight = null
      if (requestGeneration === generation) {
        invalidated = true
        if (snapshot.length === 0) scheduleEmptyRetry()
        // Same snapshot, but the pending state changed.
        for (const listener of listeners) listener(snapshot)
      }
      throw error
    })
  inFlight = { generation: requestGeneration, promise }
  return promise
}

/**
 * 手动刷新（模型下拉里的刷新按钮）：先让主进程把每个活着的 worker 的模型注册表重载一遍，
 * 再把最新可用列表回填到缓存。
 *
 * 只重发 model.list 不够——worker 池里的 slot 各持一份注册表，设置里新加/改过的 provider
 * 得 reloadModels 之后才会出现在它们手里。走这条路径，正在聊的对话不用切会话或重启。
 */
export function forceReloadAvailableModels(): Promise<ModelInfo[]> {
  generation += 1
  invalidated = false
  const requestGeneration = generation
  inFlight = null
  const promise = Promise.resolve(ipcClient.invoke('model.reload', {}))
    .then((res) => {
      if (inFlight?.promise === promise) inFlight = null
      if (requestGeneration !== generation) return snapshot
      // 主进程把失败包成 { ok: false, models: [] }（不 throw），这里必须把它还原成错误，
      // 否则界面只会提示「没拿到模型列表」，真正的 error 文本全链路无人读取。
      if (res?.ok === false) throw new Error(String(res?.error || 'model_reload_failed'))
      const models = Array.isArray(res?.models) ? (res.models as ModelInfo[]) : []
      if (models.length > 0) {
        snapshot = models
        invalidated = false
        emptyRetries = 0
        clearEmptyRetry()
      } else {
        // 主进程没拿到（例如刚启动还没就绪）：退回普通刷新，别把已有的列表清空。
        invalidated = true
        scheduleEmptyRetry()
      }
      for (const listener of listeners) listener(snapshot)
      return snapshot
    })
    .catch((error) => {
      // 不清 inFlight 会让它永远指向一个已 reject 的 promise：isAvailableModelsPending() 恒为 true，
      // 后续 refreshAvailableModels/ensureAvailableModels 全都会复用这个 rejected promise，直到重启。
      if (inFlight?.promise === promise) inFlight = null
      if (requestGeneration === generation) {
        invalidated = true
        if (snapshot.length === 0) scheduleEmptyRetry()
        for (const listener of listeners) listener(snapshot)
      }
      throw error
    })
  inFlight = { generation: requestGeneration, promise }
  return promise
}

export function ensureAvailableModels(): Promise<ModelInfo[]> {
  if (!invalidated && snapshot.length > 0) return Promise.resolve(snapshot)
  return refreshAvailableModels()
}

/**
 * Full SDK catalog, fetched at most once per model-config generation. Only needed for lookups
 * the available list cannot answer (e.g. a session pinned to a catalog-only model).
 */
let catalog: { generation: number; promise: Promise<ModelInfo[]> } | null = null

export function ensureCatalogModels(): Promise<ModelInfo[]> {
  if (catalog?.generation === generation) return catalog.promise
  const requestGeneration = generation
  const promise: Promise<ModelInfo[]> = Promise.resolve(ipcClient.invoke('model.list', { scope: 'catalog' }))
    .then((res) => (Array.isArray(res?.models) ? (res.models as ModelInfo[]) : []))
    .catch(() => {
      if (catalog?.promise === promise) catalog = null
      return []
    })
  catalog = { generation: requestGeneration, promise }
  return promise
}

export function invalidateAvailableModels(): void {
  generation += 1
  invalidated = true
  emptyRetries = 0
  clearEmptyRetry()
}

export function prefetchAvailableModels(): void {
  void ensureAvailableModels().catch(() => {})
}

export function clearAvailableModelsCacheForTests(): void {
  snapshot = []
  inFlight = null
  generation = 0
  invalidated = true
  catalog = null
  emptyRetries = 0
  clearEmptyRetry()
  listeners.clear()
}
