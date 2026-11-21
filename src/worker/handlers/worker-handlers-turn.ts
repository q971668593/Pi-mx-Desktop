import { fileURLToPath } from 'node:url'
import { preparePiCliEntry } from '../worker-cli-entry.js'
import { widenHttpConnectTimeout } from '../worker-http-connect.js'
import { errorMessage } from '@shared/error-message'
import { normalizeUserMessageDisplayText } from '@shared/worker-message'
import type { WorkerIncomingMessage } from '../worker-port-types.js'
import type { ExtensionUIResponse } from '../desktop-ui-bridge.js'
import type { WorkerReply } from '../worker-handler-types.js'
import {
  st,
  initSession,
  baseEvent,
  beginRunIdentity,
  emit,
  currentSessionModelKey,
} from '../worker-runtime.js'

export async function handleInit(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          console.log('[Worker] Initializing st.session for:', msg.cwd)
          st.activeSdkPath = typeof msg.sdkPath === 'string' && msg.sdkPath ? msg.sdkPath : null
          st.builtinExtensionPaths = Array.isArray(msg.builtinExtensions)
            ? msg.builtinExtensions.filter((p): p is string => typeof p === 'string' && p.length > 0)
            : []
          let sdkFallback = false
          try {
            if (st.activeSdkPath) {
              const { isAbsolute } = await import('node:path')
              const { pathToFileURL } = await import('node:url')
              if (isAbsolute(st.activeSdkPath)) {
                st.sdk = await import(pathToFileURL(st.activeSdkPath).href)
              } else {
                st.sdk = await import(st.activeSdkPath)
              }
            } else {
              st.sdk = await import('@earendil-works/pi-coding-agent')
            }
          } catch (e: unknown) {
            console.error('[Worker] Dynamic import SDK failed, fallback to builtin:', errorMessage(e))
            st.activeSdkPath = null
            st.sdk = await import('@earendil-works/pi-coding-agent')
            sdkFallback = true
          }
          if (!st.sdk) throw new Error('SDK load failed')
          let resolvedEntry: string | null = null
          try {
            resolvedEntry = st.activeSdkPath ?? fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
            await preparePiCliEntry(resolvedEntry)
            widenHttpConnectTimeout(resolvedEntry)
          } catch (e) {
            console.warn('[Worker] Could not resolve Pi CLI entry:', errorMessage(e))
          }
          if (!st.sharedEventBus) st.sharedEventBus = st.sdk.createEventBus()
          await initSession(String(msg.cwd || ''))
          if (resolvedEntry) {
            const globalCfg = (st.session?.settingsManager as { getGlobalSettings?: () => Record<string, unknown> } | undefined)?.getGlobalSettings?.()
            widenHttpConnectTimeout(resolvedEntry, globalCfg?.httpConnectTimeoutMs)
          }
          console.log('[Worker] Init done, sessionId:', st.currentSessionId)
          reply({ type: 'init-done', sessionId: st.currentSessionId, model: currentSessionModelKey(), thinkingLevel: st.session?.thinkingLevel, sdkFallback })
        } catch (e: unknown) {
          console.error('[Worker] Init FAILED:', errorMessage(e), e instanceof Error ? e.stack : '')
          reply({ type: 'error', error: `Init failed: ${errorMessage(e)}`, stack: e instanceof Error ? e.stack : undefined })
        }
        return
}


export async function handlePrompt(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        const promptSession = st.session
        if (!promptSession) { reply({ type: 'error', error: 'No session' }); return }
        if (msg.onlyIfIdle === true && (promptSession.isStreaming || st.agentTurnActive)) {
          reply({ type: 'prompt-done', skipped: true })
          return
        }
        const promptText = String(msg.text ?? '').trim()
        const slashMatch = promptText.match(/^(\/\S+)/)
        if (slashMatch) {
          emit({
            ...baseEvent(),
            type: 'slash',
            command: slashMatch[1],
            status: 'dispatched',
            text: '已发送给 pi 执行',
          })
        }
        st.promptSent = true
        // 在首个 stream 事件前就标 busy，避免切会话/evict 误杀；streamingBehavior 须用标记前的状态
        const alreadyStreaming = promptSession.isStreaming || st.agentTurnActive
        if (!alreadyStreaming) {
          beginRunIdentity()
          st.agentTurnActive = true
          st.promptPreflightActive = true
          st.abortAfterPreflight = false
          emit({ ...baseEvent(), type: 'run', phase: 'started' })
        }
        reply({ type: 'prompt-done' })
        void (async () => {
          try {
            const extra = msg.options as Parameters<typeof promptSession.prompt>[1]
            const merged =
              alreadyStreaming && !extra?.streamingBehavior
                ? { ...extra, streamingBehavior: 'followUp' as const }
                : extra
            await promptSession.prompt(promptText, merged)
            if (!alreadyStreaming && st.promptPreflightActive) {
              st.promptPreflightActive = false
              st.abortAfterPreflight = false
              st.agentTurnActive = false
              emit({ ...baseEvent(), type: 'run', phase: 'idle' })
            }
            if (slashMatch) {
              emit({
                ...baseEvent(),
                type: 'slash',
                command: slashMatch[1],
                status: 'ok',
                text: '命令已执行（详见下方助手/工具输出）',
              })
            }
          } catch (e: unknown) {
            console.error('[Worker] prompt failed:', e)
            const errText = errorMessage(e)
            if (st.promptPreflightActive) {
              st.promptPreflightActive = false
              st.abortAfterPreflight = false
              st.agentTurnActive = false
              emit({
                ...baseEvent(),
                type: 'agent_error',
                text: errText,
                kind: 'error',
                stopReason: 'error',
              })
              emit({ ...baseEvent(), type: 'run', phase: 'failed' })
            }
            if (slashMatch) {
              emit({
                ...baseEvent(),
                type: 'slash',
                command: slashMatch[1],
                status: 'error',
                text: `执行失败: ${errText}`,
              })
            }
          }
        })()
        return
}


export async function handleAbort(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  const session = st.session
  if (!session) {
    reply({ type: 'abort-done' })
    return
  }
  try {
    session.clearQueue()
    // prompt() is still in preflight (input handlers, routing): pi has no run to abort yet and
    // would start one right after. Abort that run as soon as it starts.
    if (st.promptPreflightActive) st.abortAfterPreflight = true
    await session.abort()
    reply({ type: 'abort-done' })
  } catch (error: unknown) {
    console.error('[Worker] abort failed:', error)
    reply({ type: 'error', error: `abort failed: ${errorMessage(error)}` })
  }
}


export async function handleSteer(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        await st.session?.steer(String(msg.text ?? ''))
        reply({ type: 'steer-done' })
        return
}


export async function handleFollowup(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (!st.session) { reply({ type: 'error', error: 'No st.session' }); return }
        reply({ type: 'followUp-done' })
        void st.session.followUp(String(msg.text ?? '')).catch((e: unknown) => {
          console.error('[Worker] followUp failed:', e)
          const errText = errorMessage(e)
          emit({
            ...baseEvent(),
            type: 'agent_error',
            text: errText,
            kind: 'error',
            stopReason: 'error',
          })
        })
        return
}


export async function handleClearqueue(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        if (!st.session) { reply({ type: 'clearQueue-done', steering: [], followUp: [] }); return }
        const cleared = st.session.clearQueue()
        reply({
          type: 'clearQueue-done',
          steering: (cleared.steering || []).map(normalizeUserMessageDisplayText),
          followUp: (cleared.followUp || []).map(normalizeUserMessageDisplayText),
        })
        return
}

/**
 * 立即发送排队消息（“主动立即发送”，否则继续挂到合适的时机）。
 *
 * pi 的队列有两档：steer 在“当前工具批次结束、下一次 LLM 调用前”投递，followUp 要等整轮结束。
 * 所以“立即”的两种含义：
 *  - 正在跑：把全部排队消息提升为 steer，落地在最靠前的可投递点（不杀当前工具调用，不丢活）；
 *  - 已空闲：直接当成一轮新 prompt 发出去，立刻开始。
 */
export async function handleFlushqueue(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  const session = st.session
  if (!session) {
    reply({ type: 'flushQueue-done', flushed: 0, mode: 'none' })
    return
  }
  const cleared = session.clearQueue()
  const texts = [...(cleared.steering || []), ...(cleared.followUp || [])]
    .map((text) => String(text ?? '').trim())
    .filter(Boolean)
  if (!texts.length) {
    reply({ type: 'flushQueue-done', flushed: 0, mode: 'none' })
    return
  }
  const busy = session.isStreaming || st.agentTurnActive
  if (busy) {
    try {
      for (const text of texts) await session.steer(text)
      reply({ type: 'flushQueue-done', flushed: texts.length, mode: 'steer' })
    } catch (e: unknown) {
      reply({ type: 'flushQueue-done', flushed: 0, mode: 'error', error: errorMessage(e) })
    }
    return
  }
  reply({ type: 'flushQueue-done', flushed: texts.length, mode: 'prompt' })
  // 空闲时直接开一轮：复用 handlePrompt 的运行账本、run 事件与错误处理。
  await handlePrompt({ ...msg, type: 'prompt', text: texts.join('\n\n') }, () => {})
  return
}


export async function handleExtensionUiResponse(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        st.uiBridge?.handleExtensionUIResponse(msg.response as ExtensionUIResponse)
        reply({ type: 'extension-ui-response-done' })
        return
}


export async function handleExtensionUiCancel(
  msg: WorkerIncomingMessage,
  reply: WorkerReply,
): Promise<void> {
  st.uiBridge?.handleExtensionUiCancel(msg.cancel as { id?: string; reason?: string })
  reply({ type: 'extension-ui-cancel-done' })
}


export async function handleDispose(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        st.uiBridge?.dispose()
        st.uiBridge = null
        // Abort in-flight turn before dispose so pi can flush a terminal assistant entry
        // (empty/incomplete leaf) rather than leaving the session unrewindable after force-quit.
        try {
          const streaming = !!(st.agentTurnActive || st.session?.isStreaming)
          if (streaming) {
            try {
              st.session?.clearQueue?.()
            } catch {
              /* ignore */
            }
            if (st.session) await st.session.abort()
          }
        } catch (e) {
          console.error('[Worker] abort-on-dispose failed:', e)
        }
        st.agentTurnActive = false
        st.promptPreflightActive = false
        st.abortAfterPreflight = false
        if (st.unsubscribe) { st.unsubscribe(); st.unsubscribe = null }
        try {
          st.session?.dispose()
        } catch (e) {
          console.error('[Worker] session.dispose failed:', e)
        }
        st.session = null
        st.modelRuntime = null
        st.runtime = null
        reply({ type: 'dispose-done' })
        return
}


export async function handlePing(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        reply({ type: 'pong' })
        return
}

