import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extractTextFromToolOutput } from '@extension-compat/json-path'
import { cn } from '@renderer/lib/utils'
import { formatThinkingChip } from '@renderer/lib/format-run-display'
import {
  Wrench,
  AlertTriangle,
  ChevronDown,
} from '@renderer/components/icons'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { averageTokenSpeed, formatTokenSpeed } from '@renderer/lib/token-speed-stats'
import { useComposerMetrics } from '@renderer/features/composer/use-composer-metrics'
import {
  ContextDonutChart,
  ContextRoleLegend,
  buildContextRoleSlices,
} from '@renderer/features/run/context-donut'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m ${rs}s`
}

function formatWaitDuration(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : formatDuration(ms)
}

const TOOL_ERROR_PREVIEW_CHARS = 800
const NO_TOOLS: TimelineItem[] = []

/** Failed tool calls of the run that reported errorCount (read on demand — the panel must not re-render per stream token). */
function collectFailedTools(items: TimelineItem[], runId: string | undefined): TimelineItem[] {
  return items.filter((item) => item.type === 'tool-call' && item.isError && (!runId || item.runId === runId))
}

/** One failed tool call of the current run, with the message the agent saw. */
function failedToolMessage(item: TimelineItem): string {
  const text = extractTextFromToolOutput(item.toolOutput).trim()
  const message = text || (item.toolStatusLine ? String(item.toolStatusLine).trim() : '')
  if (!message) return ''
  return message.length > TOOL_ERROR_PREVIEW_CHARS ? `${message.slice(0, TOOL_ERROR_PREVIEW_CHARS)}…` : message
}

type RunVisualStatus = 'idle' | 'running' | 'failed' | 'tool' | 'thinking'

function resolveVisualStatus(params: {
  status: string
  activeTool?: string | null
  thinkingLevel?: string | null
}): RunVisualStatus {
  if (params.status === 'failed') return 'failed'
  if (params.status === 'running' && params.activeTool) return 'tool'
  if (params.status === 'running') {
    if (params.thinkingLevel && params.thinkingLevel !== 'off') return 'thinking'
    return 'running'
  }
  return 'idle'
}

export function RunPanel() {
  const { t } = useTranslation()
  const runState = useUIStore((s) => s.runState)
  const model = runState.model
  const thinkingLevel = runState.thinkingLevel
  const [tick, setTick] = useState(0)
  const [errorsOpen, setErrorsOpen] = useState(false)
  const metrics = useComposerMetrics()

  useEffect(() => {
    if (runState.status !== 'running' || !runState.startTime) return
    const timer = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [runState.status, runState.startTime])

  void tick
  const elapsedLabel = (() => {
    if (runState.status === 'running' && runState.startTime) {
      return formatDuration(Date.now() - runState.startTime)
    }
    if (runState.lastRunDurationMs != null && runState.lastRunDurationMs > 0) {
      return `${formatDuration(runState.lastRunDurationMs)} · ${t('run:metrics.turn')}`
    }
    return '—'
  })()

  const isRunning = runState.status === 'running'
  const visualStatus = resolveVisualStatus({
    status: runState.status,
    activeTool: runState.activeTool,
    thinkingLevel,
  })
  const liveTps = isRunning && metrics.tps != null && metrics.tps > 0 ? metrics.tps / 4 : null
  const settledTps =
    !isRunning && runState.runOutputTokens != null && runState.runOutputTokens > 0
      ? (() => {
        const basisMs = runState.lastRunWriteMs != null && runState.lastRunWriteMs > 0
          ? runState.lastRunWriteMs
          : runState.lastRunDurationMs
        return basisMs ? runState.runOutputTokens! * 1000 / basisMs : null
      })()
      : null
  // 本次 run 没有得出可用速率时，用历史样本平均兜底，界面始终给出一个数字。
  const historyTps = averageTokenSpeed()?.tps ?? null
  /** Live estimate while streaming, provider-reported output averaged across the settled run. */
  const live = isRunning ? liveTps : settledTps
  const fromHistory = live == null && historyTps != null
  const speedLabel = formatTokenSpeed(live ?? historyTps, liveTps != null ? '~' : '')
  const speedHint = t(fromHistory ? 'run:genSpeedHistoryHint' : 'run:genSpeedHint')

  const roleSlices = useMemo(
    () =>
      buildContextRoleSlices(
        metrics.contextPreview?.roleBreakdown,
        metrics.contextPreview?.estimatedChars ?? 0,
        metrics.contextPreview?.contextUsage?.tokens,
      ),
    [metrics.contextPreview],
  )

  // Failed tool calls belong to the run that reported errorCount, so match on its id.
  // 展开时才订阅 timeline：收着的时候 selector 返回同一个常量（不因流式 token 重渲），
  // 展开后新失败的 tool 才会实时出现（之前 render 里直接 getState()，拿到的是展开那一刻的快照）。
  const timelineItems = useUIStore((s) => (errorsOpen ? s.timelineItems : NO_TOOLS))
  const failedTools = useMemo(
    () =>
      errorsOpen
        ? collectFailedTools(timelineItems, runState.activeRunId ?? runState.lastRunId)
        : NO_TOOLS,
    [errorsOpen, timelineItems, runState.activeRunId, runState.lastRunId],
  )

  const freeTokens =
    metrics.contextWindow != null && metrics.estContextTokens != null
      ? Math.max(0, metrics.contextWindow - metrics.estContextTokens)
      : null

  const roleLabels: Record<string, string> = {
    system: t('run:role.system'),
    user: t('run:role.user'),
    assistant: t('run:role.assistant'),
    tool: t('run:role.tool'),
    summary: t('run:role.summary'),
    other: t('run:role.other'),
  }

  const statusTitle: Record<RunVisualStatus, string> = {
    idle: t('run:status.idle'),
    running: t('run:status.running'),
    tool: t('run:status.toolRunning'),
    thinking: t('run:status.thinking'),
    failed: t('run:status.failed'),
  }
  const modelSlash = model ? model.indexOf('/') : -1
  const modelProvider = model && modelSlash > 0 ? model.slice(0, modelSlash) : ''
  const modelName = model && modelSlash > 0 ? model.slice(modelSlash + 1) : model
  const hasContext = !!metrics.contextPreview && (metrics.contextPreview.estimatedChars > 0 || (metrics.estContextTokens ?? 0) > 0)

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto">
      {/* Status: dot + label, elapsed as quiet text, model on its own line in the UI font. */}
      <section className="panel-section">
        <div className="flex items-center gap-2">
          <span className="panel-status-dot" data-status={visualStatus} aria-hidden />
          <span className="text-[13px] font-medium text-foreground">{statusTitle[visualStatus]}</span>
          {elapsedLabel !== '—' ? (
            <span className="text-[11px] tabular-nums text-foreground-secondary">{elapsedLabel}</span>
          ) : null}
        </div>
        {visualStatus === 'idle' ? (
          <p className="mt-1 text-[11px] text-foreground-secondary/85">{t('run:status.idleHint')}</p>
        ) : null}
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px]">
          {model ? (
            <span className="min-w-0 truncate" title={model}>
              {modelProvider ? <span className="text-foreground-secondary">{modelProvider}/</span> : null}
              <span className="text-foreground">{modelName}</span>
            </span>
          ) : (
            <span className="text-foreground-secondary">{t('run:noModel')}</span>
          )}
          {thinkingLevel && thinkingLevel !== 'off' ? (
            <span className="panel-tag">{t('run:thinking', { level: formatThinkingChip(thinkingLevel) })}</span>
          ) : null}
        </div>
        <dl className="mt-2">
          <div className="panel-kv">
            <dt title={speedHint}>{t('run:genSpeed')}</dt>
            <dd title={speedHint}>{speedLabel}</dd>
          </div>
          {runState.usage ? (
            <div className="panel-kv">
              <dt>{t('run:output')}</dt>
              <dd>
                {runState.usage.output.toLocaleString()} {t('run:metrics.tokens')}
              </dd>
            </div>
          ) : null}
          {metrics.estContextTokens != null ? (
            <div className="panel-kv">
              <dt>{t('run:metrics.budget')}</dt>
              <dd>
                {metrics.formatTokens(metrics.estContextTokens)}
                {metrics.ctxPct != null ? ` · ${metrics.ctxPct.toFixed(0)}%` : ''}
              </dd>
            </div>
          ) : null}
          <div className="panel-kv"><dt>{t('run:firstOutputWait')}</dt><dd>{runState.firstOutputDelayMs != null ? formatWaitDuration(runState.firstOutputDelayMs) : isRunning ? t('run:waitingOutput') : '—'}</dd></div>
        </dl>
        {isRunning && runState.activeTool && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5" style={{ background: 'color-mix(in srgb, var(--bg-2) 55%, transparent)' }}>
            <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-foreground-secondary/70" />
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-foreground/90">{runState.activeTool}</div>
              {runState.activeToolStatus && (
                <p className="mt-0.5 truncate text-[11px] text-foreground-secondary">{runState.activeToolStatus}</p>
              )}
            </div>
          </div>
        )}
        {/* Soft tool-error chip — muted amber, not destructive red banner; expands to the concrete messages */}
        {runState.errorCount > 0 && (
          <div className="mt-2 rounded-md bg-amber-500/[0.08] text-[11px] text-amber-800/90 dark:text-amber-200/85">
            <button
              type="button"
              onClick={() => setErrorsOpen((open) => !open)}
              aria-expanded={errorsOpen}
              title={errorsOpen ? t('run:toolErrorsHide') : t('run:toolErrorsShow')}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
            >
              <AlertTriangle className="h-3 w-3 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 leading-snug">{t('run:tokenError', { count: runState.errorCount })}</span>
              <span className="shrink-0 text-[10px] opacity-70">{errorsOpen ? t('run:toolErrorsHide') : t('run:toolErrorsShow')}</span>
              <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', errorsOpen && 'rotate-180')} />
            </button>
            {errorsOpen ? (
              <ul className="space-y-1.5 border-t border-amber-500/20 px-2 py-1.5">
                {failedTools.length === 0 ? (
                  <li className="leading-snug opacity-80">{t('run:toolErrorsUnavailable')}</li>
                ) : (
                  failedTools.map((tool) => {
                    const message = failedToolMessage(tool)
                    return (
                      <li key={tool.id} className="min-w-0">
                        <div className="truncate font-mono text-[10px] text-foreground/90">{tool.toolName || t('run:toolLabel')}</div>
                        <p
                          title={message}
                          className={cn(
                            'mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug',
                            message ? 'text-destructive/90' : 'text-foreground-secondary',
                          )}
                        >
                          {message || t('run:toolErrorUnknown')}
                        </p>
                      </li>
                    )
                  })
                )}
              </ul>
            ) : null}
          </div>
        )}
      </section>

      <section className="panel-section">
        <h3 className="panel-section-title">{t('run:contextBreakdown')}</h3>
        {hasContext ? (
          <div className="flex items-center gap-4">
            <ContextDonutChart
              slices={roleSlices}
              contextWindow={metrics.contextWindow}
              estimatedChars={metrics.contextPreview!.estimatedChars}
              contextTokens={metrics.estContextTokens}
              centerSub={metrics.ctxPct != null ? `${metrics.ctxPct.toFixed(0)}%` : t('run:metrics.budget')}
            />
            <ContextRoleLegend
              slices={roleSlices}
              labels={roleLabels}
              freeLabel={t('run:role.free')}
              freeTokens={freeTokens}
            />
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-foreground-secondary">{t('run:contextEmpty')}</p>
        )}
        {runState.toolCount > 0 ? (
          <dl className="mt-2">
            <div className="panel-kv">
              <dt>{t('run:toolLabel')}</dt>
              <dd>{runState.toolCount}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {runState.usage ? (
        <section className="panel-section">
          <h3 className="panel-section-title">{t('run:usage')}</h3>
          <dl>
            <div className="panel-kv"><dt>{t('run:input')}</dt><dd>{runState.usage.input.toLocaleString()}</dd></div>
            <div className="panel-kv"><dt>{t('run:output')}</dt><dd>{runState.usage.output.toLocaleString()}</dd></div>
            <div className="panel-kv">
              <dt>{t('run:cacheReadLabel')}</dt>
              <dd>
                {runState.usage.cacheRead.toLocaleString()}
                {metrics.cacheHitPct != null ? ` (${metrics.cacheHitPct.toFixed(1)}%)` : ''}
              </dd>
            </div>
            <div className="panel-kv"><dt>{t('run:cacheWriteLabel')}</dt><dd>{runState.usage.cacheWrite.toLocaleString()}</dd></div>
            <div className="panel-kv"><dt>{t('run:cost')}</dt><dd>${runState.usage.cost.toFixed(4)}</dd></div>
          </dl>
        </section>
      ) : !isRunning && !metrics.contextPreview ? (
        <section className="panel-section">
          <p className="text-[12px] leading-relaxed text-foreground-secondary">{t('run:emptyHint')}</p>
        </section>
      ) : null}
    </div>
  )
}
