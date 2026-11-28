import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Search, Sparkles, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { ModelThinkingLevel } from '@shared/model-thinking-levels'
import type { PluginModelChoice } from './settings-draft'
import { THINKING_LEVEL_KEYS } from './use-model-preferences'
import { selectCls } from './settings-controls'

export interface UnifiedModelItem {
  fullKey: string
  providerId: string
  providerLabel: string
  channel: string
  shortName: string
  displayName: string
  isLocalJson: boolean
  isOAuth: boolean
  reasoning: boolean
  multimodal: boolean
  contextWindow?: number
  availableThinkingLevels?: string[]
  enabled: boolean
}

export function splitProviderChannel(providerId: string, modelId: string): { channel: string; shortName: string } {
  const cleanId = modelId.startsWith(`${providerId}/`) ? modelId.slice(providerId.length + 1) : modelId
  const slash = cleanId.indexOf('/')
  if (slash > 0) {
    return {
      channel: cleanId.slice(0, slash),
      shortName: cleanId.slice(slash + 1),
    }
  }
  return { channel: 'direct', shortName: cleanId }
}

export function ModelAssignmentCards({
  allModels,
  defaultProvider,
  defaultModel,
  defaultThinkingLevel,
  pluginModel,
  onSelectDefault,
  onClearDefault,
  onChangeDefaultThinking,
  onSetPluginModel,
}: {
  allModels: UnifiedModelItem[]
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  pluginModel: PluginModelChoice
  onSelectDefault: (item: UnifiedModelItem) => void
  onClearDefault: () => void
  onChangeDefaultThinking: (level: string) => void
  onSetPluginModel?: (choice: PluginModelChoice) => void
}) {
  const { t } = useTranslation('settings')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const pickerBtnRef = useRef<HTMLButtonElement>(null)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 360,
  })

  useEffect(() => {
    if (!pickerOpen) return
    const updatePos = () => {
      const rect = pickerBtnRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(360, Math.max(260, window.innerWidth - 24))
      const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12)
      const top = Math.min(rect.bottom + 6, window.innerHeight - 320)
      setPickerPos({ top, left, width })
    }
    updatePos()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false)
    }
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])

  const currentDefaultKey = defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : ''
  const currentDefaultItem = useMemo(
    () => allModels.find((m) => m.fullKey === currentDefaultKey),
    [allModels, currentDefaultKey],
  )

  const defaultProviderSplit = currentDefaultItem
    ? currentDefaultItem
    : defaultProvider && defaultModel
      ? {
          providerLabel: defaultProvider,
          ...splitProviderChannel(defaultProvider, defaultModel),
          displayName: defaultModel,
          fullKey: `${defaultProvider}/${defaultModel}`,
          availableThinkingLevels: undefined,
        }
      : null

  const thinkingOptions = useMemo(() => {
    const available = (currentDefaultItem?.availableThinkingLevels ?? []).filter(Boolean)
    if (available.length > 0) return available
    return ['off', 'low', 'medium', 'high']
  }, [currentDefaultItem])

  const filteredQuickList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return allModels
    return allModels.filter((m) =>
      `${m.providerLabel} ${m.channel} ${m.displayName} ${m.fullKey}`.toLowerCase().includes(q),
    )
  }, [allModels, pickerQuery])

  const pluginKey = pluginModel ? `${pluginModel.provider}/${pluginModel.modelId}` : ''
  const pluginItem = useMemo(() => allModels.find((m) => m.fullKey === pluginKey), [allModels, pluginKey])
  const pluginLevels = pluginItem?.availableThinkingLevels ?? []
  const pluginSplit = pluginModel ? splitProviderChannel(pluginModel.provider, pluginModel.modelId) : null

  return (
    <section aria-label={t('models.workbench.assignmentAria')} className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* 主对话默认卡 */}
      <div className="settings-card relative flex flex-col justify-between gap-3 p-4 lg:col-span-7">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold uppercase tracking-wider text-foreground-secondary">
                {t('models.workbench.defaultCardTitle')}
              </span>
              <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                {t('models.workbench.defaultCardBadge')}
              </span>
            </div>

            {defaultProviderSplit ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-border/70 bg-[var(--bg-2)]/80 px-2 py-0.5 text-[12px] font-medium text-foreground">
                    {defaultProviderSplit.providerLabel}
                    {defaultProviderSplit.channel !== 'direct' ? ` · ${defaultProviderSplit.channel}` : ''}
                  </span>
                  <span className="truncate text-[14.5px] font-semibold text-foreground">
                    {defaultProviderSplit.shortName || defaultProviderSplit.displayName}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-foreground-secondary" title={defaultProviderSplit.fullKey}>
                  {defaultProviderSplit.fullKey}
                </p>
              </>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-[var(--bg-2)]/70 px-2 py-0.5 text-[12px] font-medium text-foreground-secondary">
                    {t('models.default.autoOption')}
                  </span>
                  <span className="text-[13.5px] font-medium text-foreground-secondary">
                    {t('models.default.auto')}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-foreground-secondary">
                  {t('models.workbench.defaultAutoHint')}
                </p>
              </>
            )}
          </div>

          <div className="relative flex shrink-0 items-center gap-1.5">
            {defaultProviderSplit && (
              <button
                type="button"
                onClick={onClearDefault}
                className="rounded-lg px-2 py-1.5 text-[12px] text-foreground-secondary transition hover:bg-[var(--bg-hover)] hover:text-foreground"
                title={t('models.default.autoOption')}
              >
                {t('models.workbench.resetAuto')}
              </button>
            )}
            <button
              ref={pickerBtnRef}
              type="button"
              onClick={() => {
                setPickerOpen((v) => !v)
                setPickerQuery('')
              }}
              aria-expanded={pickerOpen}
              className="settings-chip inline-flex items-center gap-1 rounded-lg border border-border bg-[var(--bg-base)] px-2.5 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-[var(--bg-hover)]"
            >
              <span>{t('models.workbench.changeModel')}</span>
              <ChevronDown className={cn('h-3 w-3 text-foreground-secondary transition-transform', pickerOpen && 'rotate-180')} />
            </button>

            {pickerOpen && createPortal(
              <>
                <div className="fixed inset-0 z-[590]" onClick={() => setPickerOpen(false)} />
                <div
                  role="dialog"
                  aria-label={t('models.workbench.changeModel')}
                  style={{ top: pickerPos.top, left: pickerPos.left, width: pickerPos.width }}
                  className="fixed z-[600] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
                >
                  <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      type="text"
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder={t('models.workbench.searchPlaceholder')}
                      className="w-full bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    {pickerQuery && (
                      <button type="button" onClick={() => setPickerQuery('')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1.5">
                    {filteredQuickList.length === 0 ? (
                      <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('models.noMatchModel')}</div>
                    ) : (
                      filteredQuickList.map((item) => {
                        const selected = item.fullKey === currentDefaultKey
                        return (
                          <button
                            key={item.fullKey}
                            type="button"
                            onClick={() => {
                              onSelectDefault(item)
                              setPickerOpen(false)
                            }}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition',
                              selected ? 'bg-primary/10 text-primary' : 'hover:bg-[var(--bg-hover)]',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="shrink-0 rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[10.5px] text-foreground-secondary">
                                  {item.providerLabel}
                                  {item.channel !== 'direct' ? `/${item.channel}` : ''}
                                </span>
                                <span className="truncate font-medium">{item.shortName}</span>
                              </div>
                            </div>
                            {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </>,
              document.body,
            )}
          </div>
        </div>

        {/* 内联思考强度分段器 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
          <span className="text-[12px] text-foreground-secondary">{t('models.workbench.defaultThinkingHint')}</span>
          <div
            role="radiogroup"
            aria-label={t('models.default.thinking')}
            className="settings-segmented inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border/50 p-0.5"
          >
            {thinkingOptions.map((level) => {
              const active = (defaultThinkingLevel || 'medium') === level
              const known = (THINKING_LEVEL_KEYS as readonly string[]).includes(level)
              const label = known ? t(`models.advanced.level.${level}`) : level
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChangeDefaultThinking(level)}
                  className={cn(
                    'settings-segmented-item rounded-md px-2.5 py-1 text-[12px] transition',
                    active && 'font-medium shadow-sm',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 插件 / 后台任务卡 */}
      <div className="settings-card flex flex-col justify-between gap-3 p-4 lg:col-span-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold uppercase tracking-wider text-foreground-secondary">
                {t('models.workbench.pluginCardTitle')}
              </span>
              <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                {t('models.workbench.pluginCardBadge')}
              </span>
            </div>

            {pluginModel && pluginSplit ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-border/70 bg-[var(--bg-2)]/80 px-2 py-0.5 text-[12px] font-medium text-foreground">
                    {pluginItem?.providerLabel || pluginModel.provider}
                    {pluginSplit.channel !== 'direct' ? ` · ${pluginSplit.channel}` : ''}
                  </span>
                  <span className="truncate text-[14.5px] font-semibold text-foreground">
                    {pluginSplit.shortName}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-foreground-secondary" title={pluginKey}>
                  {pluginKey}
                </p>
              </>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-[var(--bg-2)]/70 px-2 py-0.5 text-[12px] font-medium text-foreground-secondary">
                    {t('models.workbench.unassigned')}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground-secondary">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('models.workbench.pluginSuggest')}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-secondary">
                  {t('models.workbench.pluginDesc')}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
          {pluginModel && onSetPluginModel ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-foreground-secondary">{t('pluginModel.thinking')}:</span>
                <select
                  className={cn(selectCls, 'h-7 min-w-[96px] py-0 text-[12px]')}
                  value={pluginModel.thinkingLevel || ''}
                  aria-label={t('pluginModel.thinking')}
                  onChange={(event) => {
                    const level = event.target.value as ModelThinkingLevel | ''
                    onSetPluginModel({ ...pluginModel, thinkingLevel: level || undefined })
                  }}
                >
                  <option value="">{t('pluginModel.thinkingAuto')}</option>
                  {pluginModel.thinkingLevel && !pluginLevels.includes(pluginModel.thinkingLevel) && (
                    <option value={pluginModel.thinkingLevel} disabled>
                      {pluginModel.thinkingLevel} ({t('pluginModel.thinkingUnavailable')})
                    </option>
                  )}
                  {pluginLevels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => onSetPluginModel(null)}
                className="text-[12px] text-foreground-secondary underline-offset-2 hover:text-foreground hover:underline"
              >
                {t('models.workbench.clearAssignment')}
              </button>
            </>
          ) : (
            <span className="text-[12px] text-foreground-secondary">
              {t('models.workbench.pluginRowHint')}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
