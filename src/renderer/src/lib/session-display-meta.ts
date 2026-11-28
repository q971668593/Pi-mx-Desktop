import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeModelKey, normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import { isViewingWorkerBoundSession } from '@renderer/lib/session-worker-sync'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'

export type SessionDisplayMeta = {
  model?: string
  thinkingLevel?: string
  modelFallbackMessage?: string
}

/**
 * Last authoritative model/thinking per session (JSONL meta, bound worker, explicit switch).
 * Meta-less refreshes (return from Settings, workspace switch, remount) read it before falling
 * back to pi defaults — otherwise an unbound session flips to the global default model (#100).
 */
const sessionDisplayMeta = new Map<string, SessionDisplayMeta>()
/** Bumped by every refresh and direct write; an older refresh finishing late must not paint. */
let displayMetaGeneration = 0

function rememberSessionDisplayMeta(
  sessionFile: string | null | undefined,
  meta: SessionDisplayMeta,
): void {
  const key = normalizeSessionFileKey(sessionFile)
  if (!key) return
  const model = normalizeModelKey(meta.model)
  const thinkingLevel = normalizeThinkingLevel(meta.thinkingLevel)
  if (!model && !thinkingLevel) return
  const prev = sessionDisplayMeta.get(key)
  sessionDisplayMeta.set(key, {
    model: model ?? prev?.model,
    thinkingLevel: thinkingLevel ?? prev?.thinkingLevel,
  })
}

/**
 * Authoritative direct write (explicit model/thinking switch, bind result): remember it for the
 * session and supersede refreshes still awaiting IPC so their older answer cannot overwrite it.
 */
export function commitSessionDisplayMeta(
  sessionFile: string | null | undefined,
  meta: SessionDisplayMeta,
): void {
  rememberSessionDisplayMeta(sessionFile, meta)
  displayMetaGeneration += 1
}

export function forgetSessionDisplayMeta(sessionFile?: string | null): void {
  if (sessionFile === undefined) {
    sessionDisplayMeta.clear()
    return
  }
  const key = normalizeSessionFileKey(sessionFile)
  if (key) sessionDisplayMeta.delete(key)
}

/** 从 pi 全局 settings 读取默认模型 / thinking（Worker 未绑会话时也能显示） */
export async function fetchPiDefaultDisplayMeta(): Promise<SessionDisplayMeta> {
  try {
    const res = await ipcClient.invoke('pi.settings.get', {})
    const s = res?.settings
    if (!s) return {}
    const out: SessionDisplayMeta = {}
    if (s.defaultThinkingLevel) out.thinkingLevel = String(s.defaultThinkingLevel)
    const provider = s.defaultProvider
    const modelId = s.defaultModel
    if (provider && modelId) out.model = `${provider}/${modelId}`
    else if (modelId && String(modelId).includes('/')) out.model = String(modelId)
    return out
  } catch {
    return {}
  }
}

/** Show SDK model-restore fallback once (toast). Safe to call from event handlers. */
export function notifyModelFallback(message: string | null | undefined): void {
  const text = String(message || '').trim()
  if (!text) return
  toast.warning(text, { duration: 12_000, id: `model-fallback:${text}` })
}

/**
 * Apply live Worker model/thinking after bind (loadSession / prompt.send).
 * Runtime is authoritative — never keep JSONL meta when Worker is bound to the viewed session.
 */
export function applyWorkerBoundModelDisplay(result: {
  model?: string | null
  thinkingLevel?: string | null
  modelFallbackMessage?: string | null
}): void {
  const store = useUIStore.getState()
  const wm = normalizeModelKey(result.model)
  const wt = normalizeThinkingLevel(result.thinkingLevel)
  const patch: SessionDisplayMeta = {}
  if (wm) patch.model = wm
  if (wt) patch.thinkingLevel = wt
  if (Object.keys(patch).length > 0) store.setRunState(patch)
  commitSessionDisplayMeta(store.historySessionFile, patch)
  notifyModelFallback(result.modelFallbackMessage)
}

/**
 * Composer model/thinking display merge.
 *
 * When Worker is bound to the currently viewed session, runtime model/thinking are
 * authoritative — JSONL sessionMeta must not cover them (issue #19).
 * JSONL / pi defaults / lastModel only apply while unbound / preview-only.
 */
export async function applyComposerDisplayMeta(meta?: SessionDisplayMeta | null): Promise<void> {
  const store = useUIStore.getState()
  const patch: SessionDisplayMeta = {}

  const previewFile = store.historySessionFile
  // The session this refresh is for; its result is written there even if the view moves on.
  const sessionKey = store.viewSessionKey
  const generation = ++displayMetaGeneration
  // JSONL meta belongs to this session whatever the async checks below decide; record it now so
  // a newer meta-less refresh (which supersedes this one) can still show it.
  rememberSessionDisplayMeta(previewFile, meta ?? {})
  let workerBoundToView = false
  let workerModel: string | undefined
  let workerThinking: string | undefined

  try {
    // Ask for the viewed session's own worker slot. The foreground worker may belong to another
    // session (Settings / skills / SDK restarts start the workspace worker) — #100.
    // A new draft has no worker; its defaults must not come from another session.
    const res = previewFile
      ? await ipcClient.invoke('runtime.getState', { sessionFile: previewFile })
      : null
    const st = res?.state as {
      sessionFile?: string
      model?: string
      thinkingLevel?: string
      bound?: boolean
    } | null
    workerBoundToView =
      st?.bound !== false && isViewingWorkerBoundSession(previewFile, st?.sessionFile)
    if (workerBoundToView && st) {
      workerModel = normalizeModelKey(st.model)
      workerThinking = normalizeThinkingLevel(st.thinkingLevel)
      if (workerModel) patch.model = workerModel
      if (workerThinking) patch.thinkingLevel = workerThinking
    } else if (st && st.bound === false && (!st.sessionFile || sessionFilesEqual(previewFile, st.sessionFile))) {
      // 冷会话在主进程存在待生效模型覆盖（sessionModelOverrides）时，优先显示该会话自己的选择。
      const pendingModel = normalizeModelKey(st.model)
      const pendingThinking = normalizeThinkingLevel(st.thinkingLevel)
      if (pendingModel) patch.model = pendingModel
      if (pendingThinking) patch.thinkingLevel = pendingThinking
    }
  } catch {
    /* worker not ready */
  }

  // Bound: runtime only (plus fill missing thinking from defaults/last). Never JSONL model.
  // Unbound preview: JSONL meta is OK for display until first bind.
  if (workerBoundToView) {
    rememberSessionDisplayMeta(previewFile, { model: workerModel, thinkingLevel: workerThinking })
  } else {
    const fromMetaModel = normalizeModelKey(meta?.model)
    const fromMetaThink = normalizeThinkingLevel(meta?.thinkingLevel)
    if (!patch.model && fromMetaModel) patch.model = fromMetaModel
    if (!patch.thinkingLevel && fromMetaThink) patch.thinkingLevel = fromMetaThink

    // Meta-less refresh: keep what this session last showed authoritatively.
    const remembered = previewFile
      ? sessionDisplayMeta.get(normalizeSessionFileKey(previewFile))
      : undefined
    if (!patch.model && remembered?.model) patch.model = remembered.model
    if (!patch.thinkingLevel && remembered?.thinkingLevel) {
      patch.thinkingLevel = remembered.thinkingLevel
    }

    // Prefer the current session's persisted model id when no live worker is bound yet.
    const currentSession = store.sessions.find((s) => s.sessionId === store.currentSessionId)
    const sessionModel = normalizeModelKey(currentSession?.modelId)
    if (!patch.model && sessionModel) patch.model = sessionModel
  }

  if (!patch.model || !patch.thinkingLevel) {
    const defaults = await fetchPiDefaultDisplayMeta()
    const dm = normalizeModelKey(defaults.model)
    const dt = normalizeThinkingLevel(defaults.thinkingLevel)
    // When bound, do not invent a different model from pi defaults — only fill thinking.
    if (!workerBoundToView && !patch.model && dm) patch.model = dm
    if (!patch.thinkingLevel && dt) patch.thinkingLevel = dt
  }

  const lm = normalizeModelKey(store.lastModel)
  const lt = normalizeThinkingLevel(store.lastThinking)
  // 只有新建草稿（无 previewFile）才回落到全局 lastModel；历史会话只认自身记录或全局默认。
  if (!previewFile && !workerBoundToView && !patch.model && lm) patch.model = lm
  if (!previewFile && !patch.thinkingLevel && lt) patch.thinkingLevel = lt

  // Switching sessions fires several refreshes and explicit choices supersede them; only the
  // newest may write. It writes the session it was started for, never whichever is visible now.
  if (generation !== displayMetaGeneration || !sessionKey) return
  const latest = useUIStore.getState()
  const target = latest.sessionStates[sessionKey]
  if (!target) return

  const cur = target.runState
  const curModel = normalizeModelKey(cur.model)
  // 切回正在执行的会话时，worker 可能正忙导致 getState 超时/回包无 model。
  // 此时回包缺 model 是瞬态，不代表会话真没模型：优先保住当前显示，不清空成“选择模型”。
  let finalModel = patch.model ?? curModel
  if (workerBoundToView && workerModel) finalModel = workerModel
  if (!finalModel) {
    const remembered = sessionDisplayMeta.get(sessionKey)?.model
    if (remembered) finalModel = remembered
  }
  if (!finalModel) {
    const liveId = target.workerLiveSnapshot?.sessionId
    const sessionRow = latest.sessions.find((s) => sessionFilesEqual(s.sessionFile, sessionKey))
      ?? (liveId ? latest.sessions.find((s) => s.sessionId === liveId) : undefined)
    const sessionModel = normalizeModelKey(sessionRow?.modelId)
    if (sessionModel) finalModel = sessionModel
  }

  const finalThink =
    patch.thinkingLevel ??
    workerThinking ??
    normalizeThinkingLevel(cur.thinkingLevel) ??
    'off'

  // finalModel 为空才显式清空（确实无记录）；有值才带 key，避免瞬态空回包误删已有模型。
  latest.setSessionRunState(sessionKey, {
    ...(finalModel ? { model: finalModel } : {}),
    thinkingLevel: finalThink,
  })

  if (sessionKey === useUIStore.getState().viewSessionKey) notifyModelFallback(meta?.modelFallbackMessage)
}

/**
 * Hydrate model / thinkingLevel display for an inactive split-pane session without touching
 * `displayMetaGeneration` or interfering with the active pane's refresh.
 */
export async function hydrateInactiveSessionDisplayMeta(
  sessionFile: string,
  meta?: SessionDisplayMeta | null,
  sessionId?: string | null,
): Promise<void> {
  const sessionKey = normalizeSessionFileKey(sessionFile)
  if (!sessionKey) return
  rememberSessionDisplayMeta(sessionFile, meta ?? {})
  const patch: SessionDisplayMeta = {}
  let workerBoundToSession = false
  let workerModel: string | undefined
  let workerThinking: string | undefined

  try {
    const res = await ipcClient.invoke('runtime.getState', { sessionFile })
    const st = res?.state as {
      sessionFile?: string
      model?: string
      thinkingLevel?: string
      bound?: boolean
    } | null
    workerBoundToSession =
      st?.bound !== false && isViewingWorkerBoundSession(sessionFile, st?.sessionFile)
    if (workerBoundToSession && st) {
      workerModel = normalizeModelKey(st.model)
      workerThinking = normalizeThinkingLevel(st.thinkingLevel)
      if (workerModel) patch.model = workerModel
      if (workerThinking) patch.thinkingLevel = workerThinking
    } else if (st && st.bound === false && (!st.sessionFile || sessionFilesEqual(sessionFile, st.sessionFile))) {
      const pendingModel = normalizeModelKey(st.model)
      const pendingThinking = normalizeThinkingLevel(st.thinkingLevel)
      if (pendingModel) patch.model = pendingModel
      if (pendingThinking) patch.thinkingLevel = pendingThinking
    }
  } catch {
    /* worker not ready */
  }

  if (workerBoundToSession) {
    rememberSessionDisplayMeta(sessionFile, { model: workerModel, thinkingLevel: workerThinking })
  } else {
    const fromMetaModel = normalizeModelKey(meta?.model)
    const fromMetaThink = normalizeThinkingLevel(meta?.thinkingLevel)
    if (!patch.model && fromMetaModel) patch.model = fromMetaModel
    if (!patch.thinkingLevel && fromMetaThink) patch.thinkingLevel = fromMetaThink

    const remembered = sessionDisplayMeta.get(sessionKey)
    if (!patch.model && remembered?.model) patch.model = remembered.model
    if (!patch.thinkingLevel && remembered?.thinkingLevel) patch.thinkingLevel = remembered.thinkingLevel

    const store = useUIStore.getState()
    const row =
      store.sessions.find((s) => sessionFilesEqual(s.sessionFile, sessionFile)) ??
      (sessionId ? store.sessions.find((s) => s.sessionId === sessionId) : undefined)
    const sessionModel = normalizeModelKey(row?.modelId)
    if (!patch.model && sessionModel) patch.model = sessionModel
  }

  if (!patch.model || !patch.thinkingLevel) {
    const defaults = await fetchPiDefaultDisplayMeta()
    const dm = normalizeModelKey(defaults.model)
    const dt = normalizeThinkingLevel(defaults.thinkingLevel)
    if (!workerBoundToSession && !patch.model && dm) patch.model = dm
    if (!patch.thinkingLevel && dt) patch.thinkingLevel = dt
  }

  const latest = useUIStore.getState()
  const cur = latest.sessionStates[sessionKey]?.runState
  let finalModel = workerBoundToSession && workerModel ? workerModel : (patch.model ?? normalizeModelKey(cur?.model))
  if (!finalModel) {
    finalModel = sessionDisplayMeta.get(sessionKey)?.model
  }
  const finalThink =
    workerThinking ??
    patch.thinkingLevel ??
    normalizeThinkingLevel(cur?.thinkingLevel) ??
    'off'

  latest.setSessionRunState(sessionKey, {
    ...(finalModel ? { model: finalModel } : {}),
    thinkingLevel: finalThink,
  })
}
