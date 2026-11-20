import { workerManager } from '../../worker-manager'
import { ensureWorkerSessionBound } from '../../session-bind-state'
import { normalizeSessionKey } from '../../worker-session-key'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { readRemoteAttachment, writeClipboardTempImage } from '../../clipboard-temp-images'
import { readActionableImage, resolveActionableImage } from '../../image-file-access'
import { capabilityCatalog, setInstalledCapabilityTools } from '../../capabilities/catalog'
import { applySessionCapabilities } from '../../capabilities/session-apply'
import { clipboard, nativeImage } from 'electron'
import { capabilityApplySchema, clipboardReadTempImageSchema, clipboardWriteTempImageSchema, dialogSaveImageSchema, promptAbortSchema, promptDequeueClearQueueSchema, promptFlushQueueSchema, promptTextSchema } from '../schemas'
import { configStore } from '../../config-store'
import { isComputerCapabilityTool, isWebSearchCapabilityTool } from '@shared/capabilities'

/** Matches the composer's paste limit, so a re-read can never return more than was written. */
const CLIPBOARD_READ_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export function registerPromptHandlers(): void {
  const bindBeforePrompt = async (sessionFile?: string) => {
    return ensureWorkerSessionBound(
      (f, o) =>
        workerManager.loadSession(f, {
          force: o?.force,
        }),
      { sessionFile },
    )
  }

  /** Path-normalize before compare — UI keys and worker state often differ by slash/case. */
  const workerMatchesSession = async (sessionFile?: string) => {
    if (!sessionFile) return true
    const want = normalizeSessionKey(sessionFile)
    if (!want) return true
    const st = await workerManager.getState(sessionFile).catch(() => null)
    const got = normalizeSessionKey(String((st as { sessionFile?: string } | null)?.sessionFile || ''))
    // getState(sessionFile) returns the requested key with isStreaming:false when no slot —
    // treat "same key, idle" as match so abort still runs (no-op on empty pool).
    if (got && got === want) return true
    // No sessionFile in state but slot exists under want (partial state)
    if (!got) return true
    return got === want
  }

  // Enabled capabilities travel with each message so drafts and restarted workers stay in sync.
  // A message that carries none (the goal loop) falls back to what the session stored, so a worker
  // can never keep running with a capability the user already switched off.
  const applyCapabilities = async (req: { capabilities?: string[]; sessionFile?: string }) => {
    await applySessionCapabilities(req.sessionFile, req.capabilities)
  }

  registerHandler('ipc:capabilities.catalog', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const runtime = await workerManager.getExtensionCapabilities(cwd).catch(() => null)
    const names = runtime?.extensions.flatMap((extension) => extension.tools) ?? []
    setInstalledCapabilityTools({
      computer: names.filter(isComputerCapabilityTool).length,
      'web-search': names.filter(isWebSearchCapabilityTool).length,
    })
    return { capabilities: capabilityCatalog() }
  })

  /**
   * The Tools menu pushes a switch the moment it is clicked: turning something off has to revoke
   * its tools on the running turn, not on the next message. Live worker only; a chat that has no
   * worker yet carries its switches with its first prompt.
   */
  registerHandlerWithSchema('ipc:capabilities.apply', capabilityApplySchema, async (req) => {
    const { applied, capabilities } = await applySessionCapabilities(req.sessionFile, req.capabilities, { liveOnly: true })
    return { ok: true as const, applied, capabilities }
  })

  registerHandlerWithSchema('ipc:prompt.send', promptTextSchema, async (req) => {
    const bind = await bindBeforePrompt(req.sessionFile)
    await applyCapabilities(req)
    await workerManager.sendPrompt(req.text, req.sessionFile)
    // Keep clipboard images on disk for the agent turn (tools like `read` use the path).
    // Cleanup is TTL/startup prune + optional quit, not immediate delete-on-send.
    return {
      messageId: `msg-${Date.now()}`,
      model: bind?.model,
      thinkingLevel: bind?.thinkingLevel,
      modelFallbackMessage: bind?.modelFallbackMessage,
    }
  })

  registerHandlerWithSchema('ipc:clipboard.writeTempImage', clipboardWriteTempImageSchema, async (req) => {
    const ext =
      req.mimeType === 'image/jpeg'
        ? 'jpg'
        : req.mimeType === 'image/webp'
          ? 'webp'
          : req.mimeType === 'image/gif'
            ? 'gif'
            : req.mimeType === 'image/bmp'
              ? 'bmp'
              : 'png'
    const filePath = writeClipboardTempImage(Buffer.from(req.data, 'base64'), ext)
    return { path: filePath }
  })

  /** Thumbnail for images already sent, so the timeline can show the picture instead of its file name. */
  registerHandlerWithSchema('ipc:clipboard.readTempImage', clipboardReadTempImageSchema, async (req) => {
    const file = readRemoteAttachment(req.path)
    if (!file) return { ok: false as const, error: 'not_found' }
    if (!file.mime.startsWith('image/')) return { ok: false as const, error: 'not_image' }
    if (file.bytes.length > CLIPBOARD_READ_IMAGE_MAX_BYTES) return { ok: false as const, error: 'too_large' }
    return { ok: true as const, dataUrl: `data:${file.mime};base64,${file.bytes.toString('base64')}` }
  })

  registerHandlerWithSchema('ipc:clipboard.copyImageFile', dialogSaveImageSchema, async (req) => {
    const source = await resolveActionableImage(req.path, req.workspaceRoot)
    if ('error' in source) return { ok: false as const, error: source.error }
    const image = nativeImage.createFromBuffer(await readActionableImage(source.abs))
    if (image.isEmpty()) return { ok: false as const, error: 'not_image' }
    clipboard.writeImage(image)
    return { ok: true as const }
  })

  registerHandlerWithSchema('ipc:prompt.steer', promptTextSchema, async (req) => {
    const bind = await bindBeforePrompt(req.sessionFile)
    await applyCapabilities(req)
    await workerManager.steer(req.text, req.sessionFile)
    return {
      steered: true,
      model: bind?.model,
      thinkingLevel: bind?.thinkingLevel,
      modelFallbackMessage: bind?.modelFallbackMessage,
    }
  })

  registerHandlerWithSchema('ipc:prompt.followUp', promptTextSchema, async (req) => {
    const bind = await bindBeforePrompt(req.sessionFile)
    await applyCapabilities(req)
    await workerManager.followUp(req.text, req.sessionFile)
    return {
      messageId: `msg-${Date.now()}`,
      model: bind?.model,
      thinkingLevel: bind?.thinkingLevel,
      modelFallbackMessage: bind?.modelFallbackMessage,
    }
  })

  registerHandlerWithSchema('ipc:prompt.abort', promptAbortSchema, async (req) => {
    const sessionFile = req?.sessionFile as string | undefined
    if (!sessionFile) {
      return { aborted: false, ignored: true, reason: 'session_required' }
    }
    // Always attempt abort for the requested session. Path-normalize match only
    // blocks when getState clearly points at a *different* live session.
    const want = normalizeSessionKey(sessionFile)
    const st = await workerManager.getState(sessionFile).catch(() => null)
    const got = normalizeSessionKey(String((st as { sessionFile?: string } | null)?.sessionFile || ''))
    const streaming = !!(st as { isStreaming?: boolean } | null)?.isStreaming
    // Foreign running session — refuse (safety). Idle/missing slot — still abort by key.
    if (got && want && got !== want && streaming) {
      return { aborted: false, ignored: true, reason: 'session_mismatch' }
    }
    try {
      await workerManager.abort(sessionFile)
    } catch (e) {
      // No worker for session: still succeed from UI perspective (already idle).
      console.warn('[IPC] prompt.abort:', e)
      return { aborted: true, noWorker: true }
    }
    // Do not delete clipboard images on abort either — user may re-send the same chip.
    return { aborted: true }
  })

  /**
   * 立即发送排队消息（需对话运行中 / 已绑定时才有队列）。
   * 走与发送同一套绑定流程：空闲时这一下会真的开新一轮。
   */
  registerHandlerWithSchema('ipc:prompt.flushQueue', promptFlushQueueSchema, async (req) => {
    const sessionFile = typeof req?.sessionFile === 'string' ? req.sessionFile : undefined
    if (!(await workerMatchesSession(sessionFile))) {
      return { flushed: 0, mode: 'none' as const, ignored: true }
    }
    // 队列只存在于活着的 Worker 里：没有 Worker 就等于没有排队消息，别为“清一个空队列”起进程。
    if (!sessionFile || !workerManager.hasLiveSession(sessionFile)) {
      return { flushed: 0, mode: 'none' as const }
    }
    try {
      const bind = await bindBeforePrompt(sessionFile)
      await applyCapabilities(req)
      const res = await workerManager.flushQueue(sessionFile)
      return {
        ...res,
        model: bind?.model,
        thinkingLevel: bind?.thinkingLevel,
        modelFallbackMessage: bind?.modelFallbackMessage,
      }
    } catch (e: unknown) {
      return { flushed: 0, mode: 'error' as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  registerHandlerWithSchema('ipc:prompt.dequeueClearQueue', promptDequeueClearQueueSchema, async (req) => {
    const abort = !!req?.abort
    const currentText = typeof req?.currentText === 'string' ? req.currentText : ''
    const sessionFile = req?.sessionFile as string | undefined
    if (!(await workerMatchesSession(sessionFile))) {
      return { restoredCount: 0, combinedText: currentText, ignored: true }
    }
    const cleared = await workerManager.clearPromptQueue(sessionFile)
    const all = [...(cleared.steering || []), ...(cleared.followUp || [])]
    const queuedText = all.join('\n')
    const combined = [queuedText, currentText.trim()].filter(Boolean).join('\n')
    if (abort && sessionFile) await workerManager.abort(sessionFile)
    return { restoredCount: all.length, combinedText: combined }
  })
}
