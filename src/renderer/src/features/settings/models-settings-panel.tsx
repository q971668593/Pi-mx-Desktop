import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'
import type { PiModelsConfigPayload, PiModelsProviderConfig, ModelInfo } from '@shared/ipc-contract'
import {
  PROVIDER_PRESETS,
  allocateProviderKey,
  clonePresetConfig,
  guessPresetForProvider,
  type ProviderPreset,
} from '@renderer/features/settings/model-provider-presets'
import { ManualModelAddDialog } from '@renderer/features/settings/manual-model-add-dialog'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import { btnOutline, btnPrimary, cloneConfig, configEqual, defaultModelEntry } from './models-settings-shared'
import { ModelsProviderCard } from './models-provider-card'
import { ModelsSdkProviderSection } from './models-sdk-provider-section'
import { ModelDefaultSection } from './model-default-section'
import { saveModelsConfigDraft } from './save-models-config'
import { PluginModelSettings } from './plugin-model-settings'
import { ModelRuntimeAdvanced } from './model-runtime-advanced'
import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import { ProviderTemplateDialog } from './provider-template-dialog'
import { ProviderConfigDialog, type ProviderDraft } from './provider-config-dialog'

/** Prefill for the add-provider form: template defaults, blank for a custom relay. */
function initialConfigForPreset(
  preset: ProviderPreset,
  t: (key: string, options?: Record<string, unknown>) => string,
): PiModelsProviderConfig {
  const config = clonePresetConfig(preset)
  if (preset.id === 'custom-openai') {
    const label = t('models.customProvider')
    return { ...config, name: label, baseUrl: undefined, apiKey: undefined, models: [] }
  }
  return config
}

export function ModelsSettingsPanel() {
  const { t } = useTranslation('settings')
  const [filePath, setFilePath] = useState('')
  const [baseline, setBaseline] = useState<PiModelsConfigPayload | null>(null)
  const [draft, setDraft] = useState<PiModelsConfigPayload | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [loadWarnings, setLoadWarnings] = useState<string[]>([])
  const [manualAddProviderId, setManualAddProviderId] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [fetching, setFetching] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [newProvider, setNewProvider] = useState<{ pid: string; preset: ProviderPreset } | null>(null)
  const [remoteCatalog, setRemoteCatalog] = useState<Record<string, { ids: string[]; error?: string }>>({})
  const [settingsModels, setSettingsModels] = useState<ModelInfo[]>([])
  const [expandedLocalModel, setExpandedLocalModel] = useState<Record<string, boolean>>({})
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    destructive?: boolean
    onConfirm: () => void
  } | null>(null)

  const load = useCallback(async () => {
    const res = await ipcClient.invoke('pi.models.get', {})
    setFilePath(res?.path || '')
    setParseError(res?.parseError || null)
    setSchemaError(res?.schemaError || null)
    setLoadWarnings(res?.warnings?.length ? res.warnings : [])
    setSaveError(null)
    const snapshot = await ipcClient.invoke('model.list', { scope: 'settings' }).catch(() => ({ models: [] }))
    setSettingsModels(snapshot?.models || [])
    const cfg = res?.config ?? { providers: {} }
    setBaseline(cloneConfig(cfg))
    setDraft(cloneConfig(cfg))
    const keys = Object.keys(cfg.providers || {})
    setExpanded((prev) => {
      const next = { ...prev }
      // 已配置的供应商默认折叠：列表一长就把下面的插件模型、默认模型顶出屏幕了，想改再点开展开。
      for (const k of keys) if (next[k] === undefined) next[k] = false
      return next
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    void load()
      .catch((e: unknown) => {
        toast.error((e instanceof Error ? e.message : String(e)) || t('models.loadFailedToast'))
      })
      .finally(() => setLoading(false))
    return onAppEvent((event) => {
      if (event.type === 'sdk-runtime-changed') void load()
      // A subscription login / logout rewrote auth.json: refresh the SDK rows' auth status.
      if (event.type === 'model-auth' && (event.phase === 'done' || event.phase === 'cancelled')) void load()
    })
  }, [load, t])

  const patchDraft = useCallback((fn: (c: PiModelsConfigPayload) => void) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = cloneConfig(prev)
      fn(next)
      notifySettingsDirtyChanged()
      return next
    })
  }, [])

  useSettingsDirtySlice({
    id: 'pi-models',
    label: t('models.modelConfig'),
    isDirty: () => !configEqual(draft, baseline),
    commit: async () => {
      if (!draft || configEqual(draft, baseline)) return
      try {
        await saveModelsConfigDraft(draft, {
          setConfig: (config) => ipcClient.invoke('pi.models.set', { config }),
          onWritten: invalidateAvailableModels,
          reload: load,
        })
        prefetchAvailableModels()
      } catch (error) {
        const message = error instanceof Error && error.message !== 'SAVE_FAILED'
          ? error.message
          : t('models.saveFailed')
        setSaveError(message)
        throw new Error(message)
      }
    },
    discard: () => {
      if (baseline) setDraft(cloneConfig(baseline))
      notifySettingsDirtyChanged()
    },
  })

  const sdkModelsByProvider = useMemo(() => {
    const byProvider: Record<string, ModelInfo[]> = {}
    const seen = new Map<string, Set<string>>()
    for (const model of settingsModels) {
      if (!model.provider || !model.id) continue
      const ids = seen.get(model.provider) ?? new Set<string>()
      if (ids.has(model.id)) continue
      ids.add(model.id)
      seen.set(model.provider, ids)
      ;(byProvider[model.provider] ??= []).push(model)
    }
    for (const models of Object.values(byProvider)) {
      models.sort((a, b) => a.id.localeCompare(b.id))
    }
    return byProvider
  }, [settingsModels])

  const sdkProviderIds = useMemo(
    () => Object.keys(sdkModelsByProvider).sort((a, b) => a.localeCompare(b)),
    [sdkModelsByProvider],
  )

  const providerIds = useMemo(
    () => Object.keys(draft?.providers || {}).sort((a, b) => a.localeCompare(b)),
    [draft],
  )

  const addFromPreset = (preset: ProviderPreset) => {
    const key = allocateProviderKey(draft?.providers || {}, preset.defaultKey)
    setAddMenuOpen(false)
    // Nothing is written until the connection form is filled in and saved.
    setNewProvider({ pid: key, preset })
  }

  const createProvider = ({ pid: key, config }: ProviderDraft) => {
    patchDraft((c) => {
      c.providers[key] = config
    })
    setExpanded((e) => ({ ...e, [key]: true }))
    setNewProvider(null)
    toast.success(t('models.addedProviderToast', { label: config.name || key, key }))
  }

  const removeProvider = (id: string) => {
    patchDraft((c) => {
      delete c.providers[id]
    })
  }

  const updateProvider = (id: string, patch: Partial<PiModelsProviderConfig>) => {
    patchDraft((c) => {
      c.providers[id] = { ...c.providers[id], ...patch }
    })
  }

  const fetchRemoteCatalog = async (providerId: string) => {
    const p = draft?.providers[providerId]
    if (!p?.baseUrl) {
      toast.error(t('models.fetchNeedBaseUrl'))
      return
    }
    setFetching(providerId)
    setRemoteCatalog((prev) => ({ ...prev, [providerId]: { ids: prev[providerId]?.ids || [] } }))
    try {
      const res = await ipcClient.invoke('pi.models.fetch', {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        authHeader: p.authHeader,
      })
      if (!res?.ok) {
        setRemoteCatalog((prev) => ({
          ...prev,
          [providerId]: { ids: [], error: res?.error || t('models.fetchFailed') },
        }))
        toast.error(res?.error || t('models.fetchFailed'))
        return
      }
      const ids = res.ids || []
      setRemoteCatalog((prev) => ({ ...prev, [providerId]: { ids } }))
      toast.success(t('models.loadedModels', { count: ids.length }))
    } finally {
      setFetching(null)
    }
  }

  const addModelToLocal = (providerId: string, modelId: string) => {
    if ((draft?.providers[providerId].models || []).some((m) => m.id === modelId)) return
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = [...(prov.models || []), defaultModelEntry(modelId)]
    })
    const key = `${providerId}\0${modelId}`
    setExpandedLocalModel((e) => ({ ...e, [key]: true }))
    toast.success(t('models.addedModelToast', { id: modelId }))
  }

  const addAllNewToLocal = (providerId: string) => {
    const catalog = remoteCatalog[providerId]?.ids || []
    const existing = new Set((draft?.providers[providerId].models || []).map((m) => m.id))
    const toAdd = catalog.filter((id) => !existing.has(id))
    if (!toAdd.length) {
      toast.message(t('models.noNewModels'))
      return
    }
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = [...(prov.models || []), ...toAdd.map((id) => defaultModelEntry(id))]
    })
    toast.success(t('models.addedModels', { count: toAdd.length }))
  }

  const removeModel = (providerId: string, modelId: string) => {
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = (prov.models || []).filter((m) => m.id !== modelId)
    })
  }

  const updateModelEntry = (providerId: string, modelId: string, patch: Partial<LocalModelEntry>) => {
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = (prov.models || []).map((m) => (m.id === modelId ? { ...m, ...patch } : m))
    })
  }

  const confirmManualModels = async (providerId: string, ids: string[]) => {
    for (const modelId of ids) {
      if ((draft?.providers[providerId].models || []).some((m) => m.id === modelId)) continue
      addModelToLocal(providerId, modelId)
    }
    setManualAddProviderId(null)
    if (ids.length === 1) return
    toast.success(t('models.addedModels', { count: ids.length }))
  }

  if (loading && !draft) {
    return <p className="text-base text-muted-foreground">{t('models.loadingModels')}</p>
  }

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t('models.providerLabel')}
        description={t('models.description', { path: filePath || '~/.pi/agent/models.json' })}
        action={
          <button
            type="button"
            className={btnOutline}
            onClick={() => void load().catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))}
          >
            <RefreshCw className="mr-1 inline h-3 w-3" strokeWidth={2} />
            {t('models.reload')}
          </button>
        }
      />

      {(parseError || schemaError || saveError) && (
        <div className="rounded-md border border-amber-500/35 bg-amber-500/10 whitespace-pre-wrap px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {parseError && <div>{parseError}</div>}
          {schemaError && <div>{schemaError}</div>}
          {saveError && <div>{saveError}</div>}
        </div>
      )}

      {loadWarnings.length > 0 && !parseError && (
        <details className="ui-enter rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground/80">
            {t('models.autoFixedCount', { count: loadWarnings.length })}
          </summary>
          <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4">
            {loadWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="space-y-2.5" data-testid="user-provider-section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 px-1">
            <h3 className="text-[13.5px] font-semibold leading-5 text-foreground">{t('models.userProvidersTitle')}</h3>
            <p className="mt-0.5 text-[12.5px] leading-[1.6] text-foreground-secondary">{t('models.userProvidersDescription', { count: providerIds.length })}</p>
          </div>
          <div className="relative">
            <button type="button" className={btnPrimary} onClick={() => setAddMenuOpen(true)}>
              <Plus className="mr-1 inline h-3 w-3" strokeWidth={2} />
              {t('models.addProviderBtn')}
            </button>
          </div>
        </div>

        {providerIds.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/50 px-3 py-3 text-sm text-muted-foreground">
            {t('models.userProvidersEmpty')}
          </p>
        ) : (
          <div className="space-y-2">
            {providerIds.map((pid, cardIndex) => {
              const catalogIds = Array.from(new Set(
                (remoteCatalog[pid]?.ids || []).filter(
                  (id) => !(draft?.providers[pid].models || []).some((model) => model.id === id),
                ),
              ))
              return (
                <ModelsProviderCard
                  key={pid}
                  pid={pid}
                  cardIndex={cardIndex}
                  config={draft!}
                  open={expanded[pid] === true}
                  onToggleOpen={() => setExpanded((e) => ({ ...e, [pid]: !e[pid] }))}
                  fetching={fetching === pid}
                  remoteIds={catalogIds}
                  remoteError={remoteCatalog[pid]?.error}
                  expandedLocalModel={expandedLocalModel}
                  onToggleLocalModel={(rowKey) =>
                    setExpandedLocalModel((e) => ({ ...e, [rowKey]: !e[rowKey] }))
                  }
                  onUpdateProvider={(patch) => updateProvider(pid, patch)}
                  onFetchRemote={() => void fetchRemoteCatalog(pid)}
                  onManualAdd={() => setManualAddProviderId(pid)}
                  onRemoveProvider={() =>
                    setConfirmState({
                      title: t('models.deleteProvider'),
                      message: t('models.deleteProviderConfirm', {
                        name: draft!.providers[pid].name || pid,
                        id: pid,
                      }),
                      destructive: true,
                      onConfirm: () => {
                        setConfirmState(null)
                        removeProvider(pid)
                      },
                    })
                  }
                  onAddModel={(id) => addModelToLocal(pid, id)}
                  onAddAllNew={() => addAllNewToLocal(pid)}
                  onUpdateModel={(modelId, patch) => updateModelEntry(pid, modelId, patch)}
                  onRemoveModel={(modelId) => removeModel(pid, modelId)}
                />
              )
            })}
          </div>
        )}
      </section>

      <ModelsSdkProviderSection
        providerIds={sdkProviderIds}
        modelsByProvider={sdkModelsByProvider}
        onAuthChanged={() => void load()}
      />

      {/* 默认模型在这里选：新会话自动用它；下面插件模型跑在主对话之外（Git 提交说明、终端任务检测等）。 */}
      <ModelDefaultSection models={settingsModels} />

      <PluginModelSettings />

      <ModelRuntimeAdvanced />

      {addMenuOpen ? <ProviderTemplateDialog onClose={() => setAddMenuOpen(false)} onSelect={addFromPreset} /> : null}

      {newProvider ? (
        <ProviderConfigDialog
          mode="add"
          pid={newProvider.pid}
          preset={newProvider.preset}
          initial={initialConfigForPreset(newProvider.preset, t)}
          onSubmit={createProvider}
          onCancel={() => setNewProvider(null)}
        />
      ) : null}

      {manualAddProviderId && draft?.providers[manualAddProviderId] && (
        <ManualModelAddDialog
          open
          providerLabel={
            draft.providers[manualAddProviderId].name ||
            guessPresetForProvider(manualAddProviderId, draft.providers[manualAddProviderId])?.label ||
            manualAddProviderId
          }
          existingIds={new Set((draft.providers[manualAddProviderId].models || []).map((m) => m.id))}
          onConfirm={(ids) => confirmManualModels(manualAddProviderId, ids)}
          onCancel={() => setManualAddProviderId(null)}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.message}
          destructive={confirmState.destructive}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  )
}
