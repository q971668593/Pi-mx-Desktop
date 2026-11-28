import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CloudDownload,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import type { PiModelsProviderConfig } from '@shared/ipc-contract'
import type { ProviderPreset } from './model-provider-presets'
import { ModelCatalogPicker } from './model-catalog-picker'
import { ModelEntryEditor, type LocalModelEntry } from './model-entry-editor'
import { ProviderAvatar, maskApiKey } from './models-settings-shared'
import { useMagpieQuotas } from '@renderer/features/quota/use-magpie-quotas'
import { hasQuotaData, pickPrimaryWindow } from '@renderer/features/quota/status-quota'
import { THINKING_LEVEL_KEYS } from './use-model-preferences'
import type { UnifiedModelItem } from './model-assignment-cards'
import { btnDanger, btnOutline, btnPrimary, inputCls } from './settings-controls'

export interface UnifiedProviderItem {
  id: string
  label: string
  kind: 'json' | 'oauth' | 'sdk'
  endpoint: string
  protocol: string
  preset?: ProviderPreset
  jsonConfig?: PiModelsProviderConfig
  modelCount: number
  enabledCount: number
  hasIssue?: boolean
  authType?: 'oauth' | 'api_key'
}

function SubscriptionQuotaLine({ providerId, compact = false }: { providerId: string; compact?: boolean }) {
  const quota = useMagpieQuotas(false)
  const entry = providerId === 'openai-codex' ? quota.codex : providerId === 'opencode-go' ? quota.opencode : undefined
  if (!entry || !hasQuotaData(entry)) return null
  const primary = pickPrimaryWindow(entry)
  const secondary = entry.windows?.find((w) => w !== primary)
  const fmt = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? `${v}%` : '--')
  const parts: string[] = []
  if (primary) parts.push(`${primary.name} 剩 ${fmt(primary.remainingPercent)}`)
  if (secondary) parts.push(`${secondary.name} 剩 ${fmt(secondary.remainingPercent)}`)
  if (!compact && entry.balance && !entry.plan) parts.push(String(entry.balance))
  if (parts.length === 0) return null
  return (
    <span
      className={cn(
        'truncate text-foreground-secondary tabular-nums',
        compact ? 'block text-[11px]' : 'text-[12px]',
      )}
    >
      {parts.join(' · ')}
    </span>
  )
}

function formatCtx(n: number | undefined): string | null {
  if (!n || !Number.isFinite(n)) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

export function ModelWorkbench({
  providers,
  allModels,
  selectedScope,
  onSelectScope,
  autoEnableAll,
  explicitScope,
  enabledPatterns,
  defaultModelKey,
  pluginModelKey,
  thinkingBindings,
  fetchingProviderId,
  reloadingProviderId,
  remoteCatalog,
  expandedLocalModel,
  onToggleLocalModel,
  onOpenAddProvider,
  onEditProvider,
  onRemoveProvider,
  onLogoutProvider,
  onReloadProviderModels,
  onFetchRemote,
  onManualAdd,
  onAddRemoteModel,
  onAddAllRemote,
  onUpdateLocalModel,
  onRemoveLocalModel,
  onToggleAutoEnableAll,
  onToggleModelEnabled,
  onBatchToggleEnabled,
  onApplyEnabledPatterns,
  onSetDefault,
  onSetPlugin,
  onSetThinkingBinding,
}: {
  providers: UnifiedProviderItem[]
  allModels: UnifiedModelItem[]
  selectedScope: string
  onSelectScope: (scope: string) => void
  autoEnableAll: boolean
  explicitScope: boolean
  enabledPatterns?: string[]
  defaultModelKey: string
  pluginModelKey: string
  thinkingBindings: Record<string, string>
  fetchingProviderId: string | null
  reloadingProviderId?: string | null
  remoteCatalog: Record<string, { ids: string[]; error?: string }>
  expandedLocalModel: Record<string, boolean>
  onToggleLocalModel: (rowKey: string) => void
  onOpenAddProvider: () => void
  onEditProvider: (pid: string) => void
  onRemoveProvider: (pid: string) => void
  onLogoutProvider: (pid: string) => void
  onReloadProviderModels?: (pid: string) => void
  onFetchRemote: (pid: string) => void
  onManualAdd: (pid: string) => void
  onAddRemoteModel: (pid: string, modelId: string) => void
  onAddAllRemote: (pid: string) => void
  onUpdateLocalModel: (pid: string, modelId: string, patch: Partial<LocalModelEntry>) => void
  onRemoveLocalModel: (pid: string, modelId: string) => void
  onToggleAutoEnableAll: (autoAll: boolean) => void
  onToggleModelEnabled: (fullKey: string, enabled: boolean) => void
  onBatchToggleEnabled: (fullKeys: string[], enabled: boolean) => void
  onApplyEnabledPatterns: (patterns: string[] | undefined) => void
  onSetDefault: (item: UnifiedModelItem) => void
  onSetPlugin: (item: UnifiedModelItem) => void
  onSetThinkingBinding: (fullKey: string, level: string | null) => void
}) {
  const { t } = useTranslation('settings')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('all')
  const [onlyEnabled, setOnlyEnabled] = useState(false)
  const [remotePickerOpen, setRemotePickerOpen] = useState<Record<string, boolean>>({})
  const [patternInput, setPatternInput] = useState('')
  const [patternDirty, setPatternDirty] = useState(false)

  const effectiveScope =
    selectedScope === 'enabled-all' || providers.some((p) => p.id === selectedScope)
      ? selectedScope
      : 'enabled-all'

  const activeProvider = useMemo(
    () => (effectiveScope === 'enabled-all' ? null : providers.find((p) => p.id === effectiveScope) ?? null),
    [effectiveScope, providers],
  )

  const totalEnabled = useMemo(() => allModels.filter((m) => m.enabled).length, [allModels])

  const scopedModels = useMemo(() => {
    if (effectiveScope === 'enabled-all') {
      return allModels.filter((m) => m.enabled)
    }
    return allModels.filter((m) => m.providerId === effectiveScope)
  }, [allModels, effectiveScope])

  const channelCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of scopedModels) {
      const key = effectiveScope === 'enabled-all' ? item.providerLabel : item.channel
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [scopedModels, effectiveScope])

  const activeChannel =
    selectedChannel === 'all' || channelCounts.has(selectedChannel) ? selectedChannel : 'all'

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return scopedModels.filter((item) => {
      const groupKey = effectiveScope === 'enabled-all' ? item.providerLabel : item.channel
      if (activeChannel !== 'all' && groupKey !== activeChannel) return false
      if (onlyEnabled && !item.enabled) return false
      if (q) {
        const hay = `${item.providerLabel} ${item.channel} ${item.shortName} ${item.displayName} ${item.fullKey}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [scopedModels, effectiveScope, activeChannel, onlyEnabled, searchQuery])

  // 当切换供应商时重置子渠道过滤
  const handleSelectScope = (scope: string) => {
    onSelectScope(scope)
    setSelectedChannel('all')
  }

  const activeJsonModels = activeProvider?.jsonConfig?.models ?? []
  const localModelMap = useMemo(() => {
    const map = new Map<string, LocalModelEntry>()
    for (const m of activeJsonModels) map.set(m.id, m)
    return map
  }, [activeJsonModels])

  const activeRemote = activeProvider ? remoteCatalog[activeProvider.id] : undefined
  const unaddedRemoteIds = useMemo(() => {
    if (!activeProvider || activeProvider.kind !== 'json' || !activeRemote?.ids?.length) return []
    const localIds = new Set((activeProvider.jsonConfig?.models ?? []).map((m) => m.id))
    return Array.from(new Set(activeRemote.ids.filter((id) => !localIds.has(id))))
  }, [activeProvider, activeRemote])

  const isFetchingActive = !!activeProvider && fetchingProviderId === activeProvider.id

  const scopeTextValue = patternDirty ? patternInput : (enabledPatterns ?? []).join(', ')

  return (
    <section
      data-testid="user-provider-section"
      className="settings-card grid min-h-[500px] grid-cols-1 overflow-hidden lg:grid-cols-12"
    >
      {/* 左栏：供应商与总览 */}
      <aside className="flex flex-col border-b border-border/70 bg-[var(--bg-1)]/70 dark:bg-[var(--bg-base)]/40 lg:col-span-4 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-3">
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-foreground">{t('models.workbench.sidebarTitle')}</h3>
            <p className="mt-0.5 truncate text-[11.5px] tabular-nums text-foreground-secondary">
              {t('models.workbench.sidebarSummary', {
                providers: providers.length,
                enabled: totalEnabled,
                total: allModels.length,
              })}
            </p>
          </div>
          <button
            type="button"
            className={cn(btnPrimary, 'inline-flex shrink-0 items-center gap-1 px-2.5 py-1 text-[12px]')}
            onClick={onOpenAddProvider}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            <span>{t('models.workbench.addShort')}</span>
          </button>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
          {/* 全部已启用总览 */}
          <button
            type="button"
            onClick={() => handleSelectScope('enabled-all')}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition',
              effectiveScope === 'enabled-all'
                ? 'border-primary/60 bg-[var(--bg-base)] shadow-sm'
                : 'border-transparent bg-transparent hover:bg-[var(--bg-hover)]/70',
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[var(--bg-2)] text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-foreground">
                  {t('models.workbench.overviewTitle')}
                </div>
                <div className="truncate text-[11px] text-foreground-secondary">
                  {t('models.workbench.overviewSubtitle')}
                </div>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-[var(--bg-2)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
              {totalEnabled}
            </span>
          </button>

          <div className="px-2 pb-0.5 pt-2 text-[11px] font-medium text-foreground-secondary">
            {t('models.workbench.providerConnections')}
          </div>

          {providers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[12px] text-foreground-secondary">
              <p>{t('models.userProvidersEmpty')}</p>
              <button
                type="button"
                onClick={onOpenAddProvider}
                className={cn(btnOutline, 'mt-2.5 text-[12px]')}
              >
                <Plus className="mr-1 inline h-3 w-3" />
                {t('models.addProviderBtn')}
              </button>
            </div>
          ) : (
            providers.map((p) => {
              const active = effectiveScope === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  data-provider-nav={p.id}
                  onClick={() => handleSelectScope(p.id)}
                  className={cn(
                    'w-full space-y-1.5 rounded-lg border px-3 py-2.5 text-left transition',
                    active
                      ? 'border-primary/60 bg-[var(--bg-base)] shadow-sm'
                      : 'border-transparent bg-transparent hover:bg-[var(--bg-hover)]/70',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProviderAvatar preset={p.preset} label={p.label} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-semibold text-foreground">{p.label}</span>
                          <span
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              p.hasIssue ? 'bg-amber-500' : 'bg-emerald-500',
                            )}
                          />
                        </div>
                        <div className="truncate text-[11px] text-foreground-secondary">
                          {p.kind === 'oauth'
                            ? t('models.workbench.oauthType')
                            : p.kind === 'sdk'
                              ? t('models.workbench.sdkType')
                              : t('models.workbench.customApiType')}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-foreground-secondary">
                      {p.enabledCount}/{p.modelCount}
                    </span>
                  </div>
                  <div className="truncate pl-[42px] font-mono text-[11px] text-foreground-secondary">
                    {p.endpoint}
                  </div>
                  {(p.id === 'openai-codex' || p.id === 'opencode-go') && (
                    <div className="pl-[42px]">
                      <SubscriptionQuotaLine providerId={p.id} compact />
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="border-t border-border/60 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-foreground-secondary">
          {t('models.workbench.sidebarFooter')}
        </div>
      </aside>

      {/* 右栏：模型管理详情 */}
      <div className="flex min-w-0 flex-col bg-[var(--bg-base)] lg:col-span-8">
        {/* 详情头部 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5">
          {activeProvider ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14.5px] font-semibold text-foreground">{activeProvider.label}</h3>
                  {activeProvider.id !== activeProvider.label && (
                    <span className="font-mono text-[11.5px] text-foreground-secondary">{activeProvider.id}</span>
                  )}
                  <span className="rounded-md border border-border/70 bg-[var(--bg-2)]/70 px-2 py-0.5 text-[11px] text-foreground-secondary">
                    {activeProvider.protocol}
                  </span>
                  {(activeProvider.id === 'openai-codex' || activeProvider.id === 'opencode-go') && (
                    <SubscriptionQuotaLine providerId={activeProvider.id} />
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-foreground-secondary">
                  {activeProvider.endpoint}
                  {activeProvider.jsonConfig && (
                    <>
                      <span className="mx-1.5 text-border">·</span>
                      <span>{maskApiKey(activeProvider.jsonConfig.apiKey)}</span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {activeProvider.kind === 'json' && (
                  <>
                    <button
                      type="button"
                      className={cn(btnOutline, 'inline-flex items-center gap-1 px-2.5 py-1 text-[12px]')}
                      disabled={isFetchingActive}
                      onClick={() => onFetchRemote(activeProvider.id)}
                    >
                      <CloudDownload className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>{isFetchingActive ? t('models.fetching') : t('models.fetchModels')}</span>
                    </button>
                    <button
                      type="button"
                      className={cn(btnOutline, 'px-2.5 py-1 text-[12px]')}
                      onClick={() => onManualAdd(activeProvider.id)}
                    >
                      {t('models.manualAdd')}
                    </button>
                    <button
                      type="button"
                      className={cn(btnOutline, 'inline-flex items-center gap-1 px-2.5 py-1 text-[12px]')}
                      onClick={() => onEditProvider(activeProvider.id)}
                    >
                      <Pencil className="h-3 w-3" strokeWidth={2} />
                      <span>{t('models.workbench.editConfig')}</span>
                    </button>
                    <button
                      type="button"
                      className={cn(btnDanger, 'inline-flex items-center gap-1 px-2.5 py-1 text-[12px]')}
                      onClick={() => onRemoveProvider(activeProvider.id)}
                      title={t('models.deleteBtn')}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </>
                )}
                {(activeProvider.kind === 'oauth' || activeProvider.kind === 'sdk') && (
                  <button
                    type="button"
                    className={cn(btnOutline, 'inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px]')}
                    disabled={reloadingProviderId === activeProvider.id}
                    onClick={() => onReloadProviderModels?.(activeProvider.id)}
                  >
                    <RefreshCw
                      className={cn('h-3.5 w-3.5', reloadingProviderId === activeProvider.id && 'animate-spin')}
                      strokeWidth={2}
                    />
                    <span>
                      {reloadingProviderId === activeProvider.id
                        ? t('models.fetching')
                        : t('models.workbench.reloadSubscriptionModels')}
                    </span>
                  </button>
                )}
                {activeProvider.kind === 'oauth' && (
                  <button
                    type="button"
                    className={cn(btnDanger, 'px-2.5 py-1 text-[12px]')}
                    onClick={() => onLogoutProvider(activeProvider.id)}
                  >
                    {t('models.authSignOut')}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="min-w-0">
                <h3 className="text-[14.5px] font-semibold text-foreground">
                  {t('models.workbench.overviewHeaderTitle')}
                </h3>
                <p className="mt-0.5 text-[12px] text-foreground-secondary">
                  {t('models.workbench.overviewHeaderDesc', { count: scopedModels.length })}
                </p>
              </div>
              <span className="rounded-lg border border-border/60 bg-[var(--bg-2)]/70 px-2.5 py-1 text-[11.5px] text-foreground-secondary">
                {autoEnableAll ? t('models.workbench.modeAutoAll') : t('models.workbench.modeGrouped')}
              </span>
            </>
          )}
        </div>

        {/* 远端拉取结果横幅（仅在拉取中、失败或有新模型可添加时出现，避免日常空框噪点） */}
        {activeProvider?.kind === 'json' && (isFetchingActive || activeRemote?.error || unaddedRemoteIds.length > 0) && (
          <div className="border-b border-border/60 bg-[var(--bg-1)]/60 px-4 py-2.5">
            {isFetchingActive ? (
              <div className="text-[12px] text-foreground-secondary">{t('models.fetching')}</div>
            ) : activeRemote?.error ? (
              <div className="text-[12px] text-destructive">{activeRemote.error}</div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] text-foreground">
                    {t('models.workbench.remoteNewFound', { count: unaddedRemoteIds.length })}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setRemotePickerOpen((prev) => ({
                          ...prev,
                          [activeProvider.id]: !prev[activeProvider.id],
                        }))
                      }
                      className={cn(btnOutline, 'px-2.5 py-1 text-[12px]')}
                    >
                      {remotePickerOpen[activeProvider.id]
                        ? t('models.workbench.hideRemoteList')
                        : t('models.workbench.pickRemoteList')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddAllRemote(activeProvider.id)}
                      className={cn(btnPrimary, 'px-2.5 py-1 text-[12px]')}
                    >
                      {t('models.addAll')}
                    </button>
                  </div>
                </div>
                {remotePickerOpen[activeProvider.id] && (
                  <ModelCatalogPicker
                    ids={unaddedRemoteIds}
                    localIds={new Set(activeJsonModels.map((m) => m.id))}
                    loading={false}
                    onAdd={(id) => onAddRemoteModel(activeProvider.id, id)}
                    onAddAllNew={() => onAddAllRemote(activeProvider.id)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* 搜索 + 开关选项 + 子渠道筛选 */}
        <div className="space-y-2.5 border-b border-border/60 bg-[var(--bg-1)]/35 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[180px] flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary"
                strokeWidth={2}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('models.workbench.searchPlaceholder')}
                className="settings-field-focus w-full rounded-lg border border-border bg-[var(--bg-base)] py-1.5 pl-8 pr-7 text-[12.5px] text-foreground placeholder:text-foreground-secondary/70"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('models.close')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <label className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-foreground-secondary hover:bg-[var(--bg-hover)]/70">
              <input
                type="checkbox"
                checked={onlyEnabled}
                onChange={(e) => setOnlyEnabled(e.target.checked)}
                className="settings-check h-3.5 w-3.5 rounded"
              />
              <span>{t('models.workbench.onlyEnabled')}</span>
            </label>

            <label
              className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-foreground-secondary hover:bg-[var(--bg-hover)]/70"
              title={t('models.workbench.autoEnableNewHint')}
            >
              <input
                type="checkbox"
                checked={autoEnableAll}
                onChange={(e) => onToggleAutoEnableAll(e.target.checked)}
                className="settings-check h-3.5 w-3.5 rounded"
              />
              <span>{t('models.workbench.autoEnableNew')}</span>
            </label>
          </div>

          {!explicitScope && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11.5px] text-amber-800 dark:text-amber-200">
              <span>{t('models.cycleSelectionPatterns')}</span>
              <button
                type="button"
                onClick={() => onToggleAutoEnableAll(false)}
                className="font-medium underline underline-offset-2 hover:opacity-80"
              >
                {t('models.workbench.convertToExplicit')}
              </button>
            </div>
          )}

          {/* 子渠道分组标签 & 批量启停 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {channelCounts.size > 1 || effectiveScope === 'enabled-all' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedChannel('all')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11.5px] transition',
                      activeChannel === 'all'
                        ? 'bg-primary font-medium text-primary-foreground'
                        : 'border border-border/70 bg-[var(--bg-base)] text-foreground-secondary hover:text-foreground',
                    )}
                  >
                    {t('models.workbench.channelAll', { count: scopedModels.length })}
                  </button>
                  {[...channelCounts.entries()].map(([key, count]) => {
                    const active = activeChannel === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedChannel(key)}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-[11.5px] transition',
                          active
                            ? 'bg-primary font-medium text-primary-foreground'
                            : 'border border-border/70 bg-[var(--bg-base)] text-foreground-secondary hover:text-foreground',
                        )}
                      >
                        {key === 'direct' ? t('models.workbench.channelDirect') : key} ({count})
                      </button>
                    )
                  })}
                </>
              ) : (
                <span className="text-[11.5px] text-foreground-secondary">
                  {t('models.workbench.totalFiltered', { count: filteredModels.length })}
                </span>
              )}
            </div>

            {filteredModels.length > 0 && (
              <div className="flex items-center gap-2 text-[12px]">
                <button
                  type="button"
                  onClick={() => onBatchToggleEnabled(filteredModels.map((m) => m.fullKey), true)}
                  className="text-primary hover:underline"
                >
                  {t('models.workbench.enableAllFiltered')}
                </button>
                <span className="text-border">|</span>
                <button
                  type="button"
                  onClick={() => onBatchToggleEnabled(filteredModels.map((m) => m.fullKey), false)}
                  className="text-foreground-secondary hover:text-foreground hover:underline"
                >
                  {t('models.workbench.disableAllFiltered')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 模型列表 */}
        <div className="max-h-[560px] flex-1 divide-y divide-border/50 overflow-y-auto">
          {filteredModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-14 text-center">
              <p className="text-[12.5px] text-foreground-secondary">
                {activeProvider?.kind === 'json' && activeProvider.modelCount === 0
                  ? t('models.localEmptyHint')
                  : t('models.workbench.emptyFiltered')}
              </p>
              {activeProvider?.kind === 'json' && activeProvider.modelCount === 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={cn(btnOutline, 'text-[12px]')}
                    disabled={isFetchingActive}
                    onClick={() => onFetchRemote(activeProvider.id)}
                  >
                    <CloudDownload className="mr-1 inline h-3.5 w-3.5" />
                    {t('models.fetchModels')}
                  </button>
                  <button
                    type="button"
                    className={cn(btnOutline, 'text-[12px]')}
                    onClick={() => onManualAdd(activeProvider.id)}
                  >
                    {t('models.manualAdd')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredModels.map((item) => {
              const isDefault = defaultModelKey === item.fullKey
              const isPlugin = pluginModelKey === item.fullKey
              const boundThinking = thinkingBindings[item.fullKey] || ''
              const subPrefix =
                effectiveScope === 'enabled-all'
                  ? `${item.providerLabel}${item.channel !== 'direct' ? ` / ${item.channel}` : ''}`
                  : item.channel !== 'direct'
                    ? item.channel
                    : null
              const ctxText = formatCtx(item.contextWindow)
              const rawModelId = item.fullKey.slice(item.providerId.length + 1)
              const localEntry =
                activeProvider?.kind === 'json' ? localModelMap.get(rawModelId) : undefined
              const rowKey = `${item.providerId}\0${rawModelId}`
              const rowExpanded = !!localEntry && expandedLocalModel[rowKey] === true
              const thinkingChoices =
                item.availableThinkingLevels && item.availableThinkingLevels.length > 0
                  ? item.availableThinkingLevels
                  : [...THINKING_LEVEL_KEYS]

              return (
                <div key={item.fullKey} className="transition-colors hover:bg-[var(--bg-hover)]/35">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {subPrefix && (
                          <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                            {subPrefix}
                          </span>
                        )}
                        <span className="truncate text-[13.5px] font-medium text-foreground">
                          {item.shortName}
                        </span>
                        {item.displayName &&
                          item.displayName !== rawModelId &&
                          item.displayName !== item.shortName && (
                            <span className="hidden truncate text-[11.5px] text-foreground-secondary sm:inline">
                              ({item.displayName})
                            </span>
                          )}
                        {item.reasoning && (
                          <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10.5px] text-foreground-secondary">
                            {t('models.reasoningBadge')}
                          </span>
                        )}
                        {item.multimodal && (
                          <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10.5px] text-foreground-secondary">
                            {t('models.multimodalBadge')}
                          </span>
                        )}
                        {ctxText && (
                          <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10.5px] tabular-nums text-foreground-secondary">
                            {ctxText}
                          </span>
                        )}
                        {isDefault && (
                          <span className="rounded bg-primary px-1.5 py-0.5 text-[10.5px] font-medium text-primary-foreground">
                            {t('models.workbench.badgeDefault')}
                          </span>
                        )}
                        {isPlugin && (
                          <span className="rounded border border-primary/60 px-1.5 py-0.5 text-[10.5px] font-medium text-primary">
                            {t('models.workbench.badgePlugin')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-foreground-secondary" title={item.fullKey}>
                        {item.fullKey}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {/* 按模型绑定思考等级 */}
                      <select
                        aria-label={t('models.advanced.bindingLevel', { model: item.fullKey })}
                        value={boundThinking}
                        onChange={(e) => onSetThinkingBinding(item.fullKey, e.target.value || null)}
                        title={t('models.advanced.bindingsDesc')}
                        className={cn(
                          'h-7 rounded-md border px-2 text-[11.5px] transition focus:outline-none focus:ring-1 focus:ring-primary',
                          boundThinking
                            ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                            : 'border-border/70 bg-[var(--bg-base)] text-foreground-secondary hover:text-foreground',
                        )}
                      >
                        <option value="">{t('models.workbench.thinkingUnbound')}</option>
                        {thinkingChoices.map((lvl) => {
                          const known = (THINKING_LEVEL_KEYS as readonly string[]).includes(lvl)
                          return (
                            <option key={lvl} value={lvl}>
                              {known ? t(`models.advanced.level.${lvl}`) : lvl}
                            </option>
                          )
                        })}
                      </select>

                      <button
                        type="button"
                        disabled={isDefault}
                        onClick={() => onSetDefault(item)}
                        className="rounded-md border border-border/80 bg-[var(--bg-base)] px-2 py-1 text-[11.5px] text-foreground transition hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-40"
                      >
                        {t('models.workbench.setDefault')}
                      </button>

                      <button
                        type="button"
                        disabled={isPlugin}
                        onClick={() => onSetPlugin(item)}
                        className="rounded-md border border-border/80 bg-[var(--bg-base)] px-2 py-1 text-[11.5px] text-foreground transition hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-40"
                      >
                        {t('models.workbench.setPlugin')}
                      </button>

                      {localEntry && activeProvider && (
                        <button
                          type="button"
                          onClick={() => onToggleLocalModel(rowKey)}
                          aria-expanded={rowExpanded}
                          title={t('models.workbench.editModelEntry')}
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-md border transition',
                            rowExpanded
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border/80 bg-[var(--bg-base)] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                          )}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <Switch
                        checked={item.enabled}
                        aria-label={item.fullKey}
                        onCheckedChange={(checked) => onToggleModelEnabled(item.fullKey, checked)}
                      />
                    </div>
                  </div>

                  {rowExpanded && localEntry && activeProvider && (
                    <div className="border-t border-border/40 bg-[var(--bg-2)]/35 px-4 py-3">
                      <ModelEntryEditor
                        model={localEntry}
                        expanded={true}
                        onToggleExpand={() => onToggleLocalModel(rowKey)}
                        onChange={(patch) => onUpdateLocalModel(activeProvider.id, localEntry.id, patch)}
                        onRemove={() => onRemoveLocalModel(activeProvider.id, localEntry.id)}
                      />
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* 底部折叠：高级通配符范围 */}
        <details className="border-t border-border/60 bg-[var(--bg-1)]/45 text-[12px]" data-testid="model-advanced">
          <summary className="cursor-pointer select-none px-4 py-2 text-foreground-secondary hover:text-foreground">
            {t('models.workbench.advancedPatternsSummary')}
          </summary>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-3">
            <input
              type="text"
              className={cn(inputCls, 'min-w-[220px] flex-1 font-mono text-[12px]')}
              aria-label={t('models.advanced.cycleScope')}
              placeholder={t('models.advanced.cycleScopePlaceholder')}
              value={scopeTextValue}
              onChange={(e) => {
                setPatternInput(e.target.value)
                setPatternDirty(true)
              }}
              onBlur={() => {
                if (!patternDirty) return
                const patterns = patternInput
                  .split(/[,\n]\s*/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                onApplyEnabledPatterns(patterns.length ? patterns : undefined)
                setPatternDirty(false)
              }}
            />
            <span className="text-[11.5px] text-foreground-secondary">
              {t('models.advanced.cycleScopeDesc')}
            </span>
          </div>
        </details>
      </div>
    </section>
  )
}
