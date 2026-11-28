import { useEffect, useRef, useState } from 'react'
import { lookupContextWindow } from '@renderer/lib/model-context-window'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import { usePaneSessionIdentity, usePaneSessionState } from '@renderer/stores/pane-session-context'
import { formatTokens, estTokensFromChars, estTokensFromText } from '@renderer/lib/format-tokens'
import type { ContextRoleSlice } from '@renderer/features/run/context-donut'
import { useSessionContextPreview } from '@renderer/features/context/use-session-context-preview'
import { noteStreamProgress } from '@renderer/lib/token-stream-clock'

export function useComposerMetrics(options?: { enabled?: boolean }) {
  const metricsEnabled = options?.enabled !== false
  const { isActive, workspace, sessionFile } = usePaneSessionIdentity()
  const globalHistoryLoading = useUIStore((s) => s.historyLoading)
  const runModel = usePaneSessionState((s) => s.runState.model)
  const sessionListModel = useUIStore((s) =>
    !runModel && sessionFile
      ? s.sessions.find((x) => sessionFilesEqual(x.sessionFile, sessionFile))?.modelId
      : undefined,
  )
  const model = runModel || sessionListModel
  const usage = usePaneSessionState((s) => s.runState.usage)
  const isRunning = usePaneSessionState((s) => s.runState.status === 'running')
  const streamingId = usePaneSessionState((s) => s.streamingAssistantId)
  const streamSample = usePaneSessionState((s) => {
    if (!s.streamingAssistantId) return '0:0'
    // Runs on every store update while streaming; the streaming row sits at the tail.
    for (let index = s.timelineItems.length - 1; index >= 0; index--) {
      const item = s.timelineItems[index]
      if (item.id === s.streamingAssistantId) {
        const text = item.text ?? ''
        const thinking = item.thinkingText ?? ''
        const chars = text.length + thinking.length
        const tokens = estTokensFromText(text) + estTokensFromText(thinking)
        return `${chars}:${tokens}`
      }
    }
    return '0:0'
  })
  const [streamLen, streamTokens] = streamSample.split(':').map(Number)

  const { preview: rawContextPreview } = useSessionContextPreview({
    enabled: metricsEnabled,
    workspace,
    sessionFile,
    model,
    isRunning,
    historyLoading: isActive ? globalHistoryLoading : false,
  })
  const contextPreview = rawContextPreview
    ? {
        messageCount: rawContextPreview.messageCount,
        estimatedChars: rawContextPreview.estimatedChars,
        roleBreakdown: rawContextPreview.roleBreakdown as ContextRoleSlice[],
        contextUsage: rawContextPreview.contextUsage,
      }
    : null
  const [catalogContextWindow, setContextWindow] = useState<number | null>(null)
  const [tps, setTps] = useState<number | null>(null)

  const streamRef = useRef({ id: null as string | null, start: 0, lastLen: 0, lastAt: 0 })

  useEffect(() => {
    if (!metricsEnabled || !workspace || !model) {
      setContextWindow(null)
      return
    }
    // Shared model caches: no full catalog round-trip per model change / per consumer.
    let cancelled = false
    void lookupContextWindow(model)
      .then((window) => {
        if (!cancelled) setContextWindow(window)
      })
      .catch(() => {
        if (!cancelled) setContextWindow(null)
      })
    return () => {
      cancelled = true
    }
  }, [metricsEnabled, workspace, model])

  useEffect(() => {
    if (!metricsEnabled) {
      setTps(null)
      return
    }
    // 写字时钟：只在正文/思考内容变长时累计，工具调用和等待不计入写字耗时。
    noteStreamProgress(streamingId, streamLen)
    const now = performance.now()
    if (!streamingId) {
      // Keep the last measured rate so an idle panel still shows how fast the run went.
      streamRef.current = { id: null, start: 0, lastLen: 0, lastAt: 0 }
      if (isRunning) setTps(null)
      return
    }
    const streamState = streamRef.current
    if (streamState.id !== streamingId) {
      streamState.id = streamingId
      streamState.start = now
      streamState.lastLen = streamTokens
      streamState.lastAt = now
      setTps(null)
      return
    }
    const elapsedSeconds = (now - streamState.lastAt) / 1000
    const deltaTokens = streamTokens - streamState.lastLen
    if (elapsedSeconds > 1.5 && deltaTokens <= 0) {
      // 工具调用或停顿期间重置采样锚点，避免把等待时间平摊到下一拍或制造虚高跳变。
      streamState.lastAt = now
      streamState.lastLen = streamTokens
      return
    }
    if (elapsedSeconds >= 0.25 && deltaTokens > 0) {
      const instantRate = deltaTokens / Math.min(elapsedSeconds, 1.5)
      setTps((previous) => (previous == null ? instantRate : previous * 0.65 + instantRate * 0.35))
      streamState.lastLen = streamTokens
      streamState.lastAt = now
    }
  }, [metricsEnabled, streamingId, streamLen, streamTokens, isRunning])
  const contextUsage = contextPreview?.contextUsage
  const contextWindow = contextUsage?.contextWindow ?? catalogContextWindow
  const estimatedContextTokens = contextUsage
    ? contextUsage.tokens
    : contextPreview ? estTokensFromChars(contextPreview.estimatedChars) : null
  const contextPercent = contextUsage
    ? contextUsage.percent
    : estimatedContextTokens != null && contextWindow != null && contextWindow > 0
      ? Math.min(100, (estimatedContextTokens / contextWindow) * 100)
      : null

  const cacheHitPercent = (() => {
    if (!usage) return null
    const denominator = usage.input + usage.cacheRead + usage.cacheWrite
    if (denominator <= 0 || (usage.cacheRead <= 0 && usage.cacheWrite <= 0)) return null
    return (usage.cacheRead / denominator) * 100
  })()

  return {
    contextPreview,
    estContextTokens: estimatedContextTokens,
    contextWindow,
    ctxPct: contextPercent,
    cacheHitPct: cacheHitPercent,
    cacheRead: usage?.cacheRead ?? 0,
    cacheWrite: usage?.cacheWrite ?? 0,
    tps,
    formatTokens,
  }
}
