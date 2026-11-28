import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, CloudDownload, Pencil, Trash2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { PiModelsConfigPayload, PiModelsProviderConfig } from '@shared/ipc-contract'
import { guessPresetForProvider } from '@renderer/features/settings/model-provider-presets'
import { ModelCatalogPicker } from '@renderer/features/settings/model-catalog-picker'
import { ModelEntryEditor, type LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import { ProviderConfigDialog } from './provider-config-dialog'
import { API_OPTS, ProviderAvatar, btnDanger, btnOutline, maskApiKey } from './models-settings-shared'
import { useMagpieQuotas } from '@renderer/features/quota/use-magpie-quotas'
import { buildQuotaTitle, pickPrimaryWindow } from '@renderer/features/quota/status-quota'

/** magpie 卡片 summary 下的额度小字（独立组件：只在 pid==='magpie' 时挂载，避免全卡轮询）。 */
function MagpieQuotaLine() {
  const quota = useMagpieQuotas(false)
  const codexLeft = pickPrimaryWindow(quota.codex)?.remainingPercent
  const opencodeLeft = pickPrimaryWindow(quota.opencode)?.remainingPercent
  const fmt = (v: number | undefined) => typeof v === 'number' && Number.isFinite(v) ? `${v}%` : '--'
  const has = quota.codex || quota.opencode
  return (
    <div className="mt-0.5 truncate text-[12px] text-foreground-secondary" title={quota.error ?? buildQuotaTitle(quota.codex, quota.opencode)}>
      {has ? `Codex剩${fmt(codexLeft)} · opencode剩${fmt(opencodeLeft)}` : '额度 --'}
    </div>
  )
}

/**
 * One configured provider.
 *
 * The card is a summary: name, endpoint, API shape, masked key, model count. Connection fields
 * only exist in {@link ProviderConfigDialog}, so editing never means hunting four inputs inside
 * an expanded card, and the header/row heights stay readable at any provider count.
 */
export function ModelsProviderCard({
  pid,
  cardIndex,
  config,
  open,
  onToggleOpen,
  fetching,
  remoteIds,
  remoteError,
  expandedLocalModel,
  onToggleLocalModel,
  onUpdateProvider,
  onFetchRemote,
  onManualAdd,
  onRemoveProvider,
  onAddModel,
  onAddAllNew,
  onUpdateModel,
  onRemoveModel,
}: {
  pid: string
  cardIndex: number
  config: PiModelsConfigPayload
  open: boolean
  onToggleOpen: () => void
  fetching: boolean
  remoteIds: string[]
  remoteError?: string
  expandedLocalModel: Record<string, boolean>
  onToggleLocalModel: (rowKey: string) => void
  onUpdateProvider: (patch: Partial<PiModelsProviderConfig>) => void
  onFetchRemote: () => void
  onManualAdd: () => void
  onRemoveProvider: () => void
  onAddModel: (id: string) => void
  onAddAllNew: () => void
  onUpdateModel: (modelId: string, patch: Partial<LocalModelEntry>) => void
  onRemoveModel: (modelId: string) => void
}) {
  const { t } = useTranslation('settings')
  const [editing, setEditing] = useState(false)
  const p = config.providers[pid]
  const preset = guessPresetForProvider(pid, p)
  const displayName = p.name || preset?.label || pid
  const modelCount = p.models?.length ?? 0
  const hasOverrides = p.modelOverrides && Object.keys(p.modelOverrides).length > 0

  return (
    <div
      className={cn(
        'settings-provider-card settings-card ui-enter',
        cardIndex < 5 && `stagger-${cardIndex + 1}`,
      )}
      style={cardIndex >= 5 ? { animationDelay: `${Math.min(cardIndex, 8) * 35}ms` } : undefined}
    >
      <button
        type="button"
        className="settings-provider-header interactive-row flex w-full items-center gap-3 px-3 py-3 text-left"
        onClick={onToggleOpen}
      >
        <ChevronRight className="settings-chevron h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} data-open={open} />
        <ProviderAvatar preset={preset} label={displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[14px] font-medium text-foreground">{displayName}</span>
            {pid !== displayName ? <span className="truncate font-mono text-[11.5px] text-foreground-secondary">{pid}</span> : null}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-foreground-secondary">
            {p.baseUrl || t('models.notSetBaseUrl')}
            <span className="mx-1.5 text-border">·</span>
            {API_OPTS.find((o) => o.v === p.api)?.l || p.api || t('models.apiNotSetLabel')}
            <span className="mx-1.5 text-border">·</span>
            {maskApiKey(p.apiKey)}
          </div>
          {pid === 'magpie' ? <MagpieQuotaLine /> : null}
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-foreground-secondary">{t('models.modelCount', { count: modelCount })}</span>
      </button>

      <div className="settings-expand-grid" data-open={open}>
        <div className="settings-expand-inner">
          <div className="settings-expand-content space-y-5 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={cn(btnOutline, 'border-primary/30 text-primary')}
                onClick={() => setEditing(true)}
              >
                <Pencil className="mr-1 inline h-3 w-3" strokeWidth={2} />
                {t('models.editConnection')}
              </button>
              <button type="button" className={btnOutline} disabled={fetching} onClick={onFetchRemote}>
                <CloudDownload className="mr-1 inline h-3 w-3" strokeWidth={2} />
                {fetching ? t('models.fetching') : t('models.fetchModels')}
              </button>
              <button type="button" className={btnOutline} onClick={onManualAdd}>
                {t('models.manualAdd')}
              </button>
              <button type="button" className={cn(btnDanger, 'ml-auto')} onClick={onRemoveProvider}>
                <Trash2 className="mr-1 inline h-3 w-3" strokeWidth={2} />
                {t('models.deleteBtn')}
              </button>
            </div>

            <div className="space-y-2">
              <h4 className="text-[12px] font-medium text-foreground">{t('models.remoteModels')}</h4>
              <ModelCatalogPicker
                ids={remoteIds}
                localIds={new Set((p.models || []).map((m) => m.id))}
                loading={fetching}
                error={remoteError}
                onAdd={onAddModel}
                onAddAllNew={onAddAllNew}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[12px] font-medium text-foreground">{t('models.localCount', { count: modelCount })}</h4>
              </div>
              {modelCount > 0 ? (
                <div className="space-y-1.5">
                  {(p.models || []).map((m) => {
                    const rowKey = `${pid}\0${m.id}`
                    const rowExpanded = expandedLocalModel[rowKey] === true
                    return (
                      <div key={m.id} className={rowExpanded ? undefined : 'settings-virtual-row settings-virtual-row-sm'}>
                        <ModelEntryEditor
                          model={m}
                          expanded={rowExpanded}
                          onToggleExpand={() => onToggleLocalModel(rowKey)}
                          onChange={(patch) => onUpdateModel(m.id, patch)}
                          onRemove={() => onRemoveModel(m.id)}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-[var(--border-base)] px-3 py-4 text-center text-[12px] text-foreground-secondary">
                  {t('models.localEmptyHint')}
                </p>
              )}
            </div>

            {hasOverrides && <p className="text-[11.5px] text-foreground-secondary">{t('models.containsOverrides')}</p>}
          </div>
        </div>
      </div>

      {editing ? (
        <ProviderConfigDialog
          mode="edit"
          pid={pid}
          preset={preset}
          initial={p}
          onSubmit={({ config: next }) => {
            setEditing(false)
            onUpdateProvider(next)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}
