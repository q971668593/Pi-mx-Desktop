import { workerManager } from '../../worker-manager'
import { ensureWorkerSessionBound } from '../../session-bind-state'
import { normalizeSessionKey } from '../../worker-session-key'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { readRemoteAttachment, writeClipboardTempImage } from '../../clipboard-temp-images'
import { readActionableImage, resolveActionableImage } from '../../image-file-access'
import { capabilityCatalog, capabilitySectionMap, capabilityToolFamilies } from '../../capabilities/catalog'
import { clipboard, nativeImage } from 'electron'
import { clipboardReadTempImageSchema, clipboardWriteTempImageSchema, dialogSaveImageSchema, promptTextSchema } from '../schemas'
import { peekBrowserHost } from '../../browser/browser-host'
import { noteBrowserTarget } from '../../browser/targets'
import { configStore } from '../../config-store'
import { readSessionMetaFromFile } from '../../session-file-meta'
import { projectBrowserSessionKey } from '@shared/browser-types'

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

  /** Browser tabs are owned per project, so resolve this session's workspace key for auto-mount. */
  const sessionBrowserKey = async (sessionFile?: string): Promise<string | null> => {
    if (!sessionFile) return null
    const st = await workerManager.getState(sessionFile).catch(() => null)
    const cwd = String((st as { currentCwd?: string } | null)?.currentCwd || '')
    const key = projectBrowserSessionKey(cwd)
    if (key) return key
    const meta = await readSessionMetaFromFile(sessionFile).catch(() => null)
    return projectBrowserSessionKey(meta?.cwd) || null
  }

  // Enabled capabilities travel with each message so drafts and restarted workers stay in sync.
  // If this session already owns browser tabs (or pinned tabs exist), auto-mount built-in browser tools.
  const applyCapabilities = async (req: { capabilities?: string[]; sessionFile?: string }) => {
    if (req.capabilities === undefined) return
    let caps = req.capabilities
    const browserKey = await sessionBrowserKey(req.sessionFile)
    if (
      !caps.includes('browser') &&
      !caps.includes('chrome') &&
      configStore.get('rightPanelPrefs')?.browser &&
      (browserKey ? peekBrowserHost()?.hasSessionTabs(browserKey) : peekBrowserHost()?.hasSessionTabs(req.sessionFile))
    ) {
      caps = [...caps, 'browser']
    }
    noteBrowserTarget(req.sessionFile, caps)
    await workerManager.setCapabilities(capabilitySectionMap(caps), capabilityToolFamilies(caps), req.sessionFile)
  }

  registerHandler('ipc:capabilities.catalog', async () => ({ capabilities: capabilityCatalog() }))

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

  registerHandler('ipc:prompt.abort', async (req) => {
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

  registerHandler('ipc:prompt.dequeueClearQueue', async (req) => {
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
