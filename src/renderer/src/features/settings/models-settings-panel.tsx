import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { useOptionalSettingsDraft } from '@renderer/features/settings/settings-draft-context'
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
import { API_OPTS, btnOutline, cloneConfig, configEqual, defaultModelEntry } from './models-settings-shared'
import { saveModelsConfigDraft } from './save-models-config'
import {
  ensureAvailableModels,
  forceReloadAvailableModels,
  invalidateAvailableModels,
  peekAvailableModels,
  prefetchAvailableModels,
  subscribeAvailableModels,
} from '@renderer/lib/available-models-cache'
import { filterEnabledModels } from '@renderer/lib/enabled-models'
import { modelThinkingLevels } from '@shared/model-thinking-levels'
import { ProviderTemplateDialog } from './provider-template-dialog'
import { ModelAuthDialog } from './model-auth-dialog'
import { ProviderConfigDialog, type ProviderDraft } from './provider-config-dialog'
import { useModelPreferences } from './use-model-preferences'
import { ModelAssignmentCards, splitProviderChannel, type UnifiedModelItem } from './model-assignment-cards'
import { ModelWorkbench, type UnifiedProviderItem } from './model-workbench'

/** Prefill for the add-provider form: template defaults (Key 永远留空让用户现填）, blank for a custom relay. */
function initialConfigForPreset(
  preset: ProviderPreset,
  t: (key: string, options?: Record<string, unknown>) => string,
): PiModelsProviderConfig {
  const config = clonePresetConfig(preset)
  const { apiKey: _presetApiKey, ...rest } = config
  if (preset.id === 'custom-openai') {
    const label = t('models.customProvider')
    return { ...rest, name: label, baseUrl: undefined, apiKey: undefined, models: [] }
  }
  return { ...rest, apiKey: undefined }
}

export function ModelsSettingsPanel({ subTabs }: { subTabs?: ReactNode } = {}) {
  const { t } = useTranslation('settings')
  const settingsDraft = useOptionalSettingsDraft()
  const [filePath, setFilePath] = useState('')
  const [baseline, setBaseline] = useState<PiModelsConfigPayload | null>(null)
  const [draft, setDraft] = useState<PiModelsConfigPayload | null>(null)
  const currentConfig = useRef({ draft, baseline })
  currentConfig.current = { draft, baseline }
  const [parseError, setParseError] = useState<string | null>(null)
  const [loadWarnings, setLoadWarnings] = useState<string[]>([])
  const [manualAddProviderId, setManualAddProviderId] = useState<string | null>(null)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadingProviderId, setReloadingProviderId] = useState<string | null>(null)
  const [fetching, setFetching] = useState<string | null>(null)
  const [modelsAutoSave, setModelsAutoSave] = useState<'idle' | 'saving' | 'saved'>('idle')
  const modelsSaveTimerRef = useRef<number | null>(null)
  const modelsSavedHideRef = useRef<number | null>(null)
  const modelsSavingRef = useRef(false)
  const lastFailedSigRef = useRef<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [newProvider, setNewProvider] = useState<{ pid: string; preset: ProviderPreset } | null>(null)
  const [loginRequest, setLoginRequest] = useState<{ providerId: string; type: 'oauth' | 'api_key' } | null>(null)
  const [remoteCatalog, setRemoteCatalog] = useState<Record<string, { ids: string[]; error?: string }>>({})
  const [settingsModels, setSettingsModels] = useState<ModelInfo[]>([])
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>(() => peekAvailableModels())
  const [expandedLocalModel, setExpandedLocalModel] = useState<Record<string, boolean>>({})
  const [selectedScope, setSelectedScope] = useState<string>('')
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    destructive?: boolean
    onConfirm: () => void
  } | null>(null)

  const {
    prefs,
    savingPrefs,
    setDefaultModel,
    clearDefaultModel,
    setDefaultThinking,
    setAutoEnableAll,
    setModelEnabled,
    batchSetModelsEnabled,
    setEnabledPatterns,
    setModelThinking,
  } = useModelPreferences()

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
  }, [])

  useEffect(() => {
    setLoading(true)
    void load()
      .catch((e: unknown) => {
        toast.error((e instanceof Error ? e.message : String(e)) || t('models.loadFailedToast'))
      })
      .finally(() => setLoading(false))
    void ensureAvailableModels().catch(() => {})
    const unsubAvailable = subscribeAvailableModels(setAvailableModels)
    const unsubApp = onAppEvent((event) => {
      if (event.type === 'sdk-runtime-changed') {
        void ipcClient.invoke('model.list', { scope: 'settings' }).then((snapshot) => setSettingsModels(snapshot?.models || []))
        void ensureAvailableModels().catch(() => {})
      }
      if (event.type === 'model-auth' && (event.phase === 'done' || event.phase === 'cancelled')) {
        void ipcClient.invoke('model.list', { scope: 'settings' }).then((snapshot) => setSettingsModels(snapshot?.models || []))
        void ensureAvailableModels().catch(() => {})
      }
    })
    return () => {
      unsubAvailable()
      unsubApp()
    }
  }, [load, t])

  const patchDraft = useCallback((fn: (c: PiModelsConfigPayload) => void) => {
    lastFailedSigRef.current = null
    setSaveError(null)
    setDraft((prev) => {
      if (!prev) return prev
      const next = cloneConfig(prev)
      fn(next)
      return next
    })
  }, [])

  // 自动保存 models.json（防抖 350ms，无需手动点击底部保存栏）
  useEffect(() => {
    if (modelsSaveTimerRef.current !== null) {
      window.clearTimeout(modelsSaveTimerRef.current)
      modelsSaveTimerRef.current = null
    }
    if (!draft || !baseline || parseError || modelsSavingRef.current) return
    if (configEqual(draft, baseline)) return
    const targetDraft = cloneConfig(draft)
    const targetSig = JSON.stringify(targetDraft)
    if (lastFailedSigRef.current === targetSig) return

    modelsSaveTimerRef.current = window.setTimeout(() => {
      modelsSaveTimerRef.current = null
      modelsSavingRef.current = true
      setModelsAutoSave('saving')
      void saveModelsConfigDraft(targetDraft, {
        setConfig: (config) => ipcClient.invoke('pi.models.set', { config }),
        onWritten: invalidateAvailableModels,
        reload: async () => {
          const res = await ipcClient.invoke('pi.models.get', {})
          setFilePath(res?.path || '')
          setParseError(res?.parseError || null)
          setSchemaError(res?.schemaError || null)
          setLoadWarnings(res?.warnings?.length ? res.warnings : [])
          setSaveError(null)
          const snapshot = await ipcClient.invoke('model.list', { scope: 'settings' }).catch(() => ({ models: [] }))
          setSettingsModels(snapshot?.models || [])
          const cfg = res?.config ?? { providers: {} }
          const normalized = cloneConfig(cfg)
          setBaseline(normalized)
          // 若保存期间用户未继续修改草稿，则同步归一化配置；否则保留用户最新草稿等待下次自动保存
          if (JSON.stringify(currentConfig.current.draft) === targetSig) {
            setDraft(cloneConfig(cfg))
          }
        },
      })
        .then(() => {
          prefetchAvailableModels()
          lastFailedSigRef.current = null
          setModelsAutoSave('saved')
          if (modelsSavedHideRef.current !== null) window.clearTimeout(modelsSavedHideRef.current)
          modelsSavedHideRef.current = window.setTimeout(() => {
            modelsSavedHideRef.current = null
            setModelsAutoSave('idle')
          }, 1800)
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error && error.message !== 'SAVE_FAILED'
              ? error.message
              : t('models.saveFailed')
          lastFailedSigRef.current = targetSig
          setSaveError(message)
          setModelsAutoSave('idle')
          toast.error(message)
        })
        .finally(() => {
          modelsSavingRef.current = false
        })
    }, 350)

    return () => {
      if (modelsSaveTimerRef.current !== null) {
        window.clearTimeout(modelsSaveTimerRef.current)
        modelsSaveTimerRef.current = null
      }
    }
  }, [draft, baseline, parseError, t])

  // 离开页面时若仍有未写入的 models.json 改动，立即冲刷保存
  useEffect(() => {
    return () => {
      if (modelsSaveTimerRef.current !== null) window.clearTimeout(modelsSaveTimerRef.current)
      if (modelsSavedHideRef.current !== null) window.clearTimeout(modelsSavedHideRef.current)
      const { draft: latestDraft, baseline: latestBaseline } = currentConfig.current
      if (!latestDraft || !latestBaseline || modelsSavingRef.current) return
      if (configEqual(latestDraft, latestBaseline)) return
      const targetSig = JSON.stringify(latestDraft)
      if (lastFailedSigRef.current === targetSig) return
      void saveModelsConfigDraft(latestDraft, {
        setConfig: (config) => ipcClient.invoke('pi.models.set', { config }),
        onWritten: invalidateAvailableModels,
      })
        .then(() => prefetchAvailableModels())
        .catch(() => {})
    }
  }, [])

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

  const configuredSdkProviderIds = useMemo(
    () =>
      sdkProviderIds.filter((id) =>
        sdkModelsByProvider[id]?.some(
          (model) =>
            model.auth?.configured === true &&
            (!providerIds.includes(id) || model.auth.type === 'oauth'),
        ),
      ),
    [sdkProviderIds, sdkModelsByProvider, providerIds],
  )

  const customPreset = useMemo(
    () => PROVIDER_PRESETS.find((preset) => preset.id === 'custom-openai')!,
    [],
  )

  const sdkAddOptions = useMemo(
    () =>
      sdkProviderIds.map((providerId) => {
        const auth = sdkModelsByProvider[providerId]?.find((model) => model.auth)?.auth
        const isConfigured =
          Object.keys(draft?.providers || {}).includes(providerId) || auth?.configured === true
        const accountLabel = !auth?.configured
          ? ''
          : auth.type === 'oauth'
            ? t('models.loggedInAccount')
            : auth.type === 'api_key'
              ? t('models.keySavedAccount')
              : t('models.providerConfigured')
        return {
          providerId,
          modelCount: sdkModelsByProvider[providerId]?.length ?? 0,
          accountLabel,
          isConfigured,
        }
      }),
    [sdkProviderIds, sdkModelsByProvider, draft, t],
  )

  // 汇总全部模型并计算 enabledModels 匹配状态
  const { unifiedProviders, allModels, allKnownKeys, autoEnableAll, explicitScope } = useMemo(() => {
    const rawModels: Array<{
      providerId: string
      providerLabel: string
      id: string
      name?: string
      isLocalJson: boolean
      isOAuth: boolean
      reasoning: boolean
      multimodal: boolean
      contextWindow?: number
      availableThinkingLevels?: string[]
    }> = []

    const sdkModelLookup = new Map<string, ModelInfo>()
    for (const [pid, list] of Object.entries(sdkModelsByProvider)) {
      for (const m of list) sdkModelLookup.set(`${pid}/${m.id}`, m)
    }
    // `model.list({ scope: 'available' })` 直接携带运行时计算好的 availableThinkingLevels，
    // 在旧进程尚未重启或 settings 快照缺思考等级时用它补齐。
    const availableThinkingLookup = new Map<string, string[]>()
    for (const m of availableModels) {
      if (m.provider && m.id && m.availableThinkingLevels?.length) {
        availableThinkingLookup.set(`${m.provider}/${m.id}`, m.availableThinkingLevels)
      }
    }
    const pickLevels = (fullKey: string, fromSettings?: string[]) => {
      const fromAvail = availableThinkingLookup.get(fullKey)
      if (fromAvail && fromAvail.length > (fromSettings?.length ?? 0)) return fromAvail
      return fromSettings ?? fromAvail
    }

    const addedProviderIds = new Set<string>()
    const providerModelCounts = new Map<string, number>()

    for (const pid of providerIds) {
      const p = draft!.providers[pid]
      const preset = guessPresetForProvider(pid, p)
      const label = p.name || preset?.label || pid
      const localList = p.models || []
      addedProviderIds.add(pid)
      let count = 0
      for (const m of localList) {
        const fullKey = `${pid}/${m.id}`
        const sdkMatch = sdkModelLookup.get(fullKey)
        const input = Array.isArray(m.input) ? m.input : ['text']
        const mergedSdkLevels = pickLevels(fullKey, sdkMatch?.availableThinkingLevels)
        const isReasoning = Boolean(m.reasoning || (mergedSdkLevels?.length ?? 0) > 1)
        const computedLevels = m.reasoning !== undefined
          ? modelThinkingLevels({ reasoning: m.reasoning, thinkingLevelMap: m.thinkingLevelMap })
          : mergedSdkLevels
        rawModels.push({
          providerId: pid,
          providerLabel: label,
          id: m.id,
          name: m.name || sdkMatch?.name || m.id,
          isLocalJson: true,
          isOAuth: false,
          reasoning: isReasoning,
          multimodal: input.includes('image'),
          contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : sdkMatch?.contextWindow,
          availableThinkingLevels: computedLevels ?? mergedSdkLevels,
        })
        count++
      }
      providerModelCounts.set(pid, count)
    }

    for (const pid of configuredSdkProviderIds) {
      const sdkList = sdkModelsByProvider[pid] || []
      const auth = sdkList.find((m) => m.auth?.configured)?.auth
      const isOAuth = auth?.type === 'oauth'
      if (addedProviderIds.has(pid)) {
        // 如果该 OAuth provider 同时出现在 models.json（例如仅写了 modelOverrides），补齐未列出的 SDK 模型
        const existingSet = new Set((draft?.providers[pid]?.models || []).map((m) => m.id))
        let added = 0
        for (const m of sdkList) {
          if (existingSet.has(m.id)) continue
          const levels = pickLevels(`${pid}/${m.id}`, m.availableThinkingLevels)
          rawModels.push({
            providerId: pid,
            providerLabel: draft?.providers[pid]?.name || pid,
            id: m.id,
            name: m.name || m.id,
            isLocalJson: false,
            isOAuth,
            reasoning: (levels?.length ?? 0) > 1,
            multimodal: false,
            contextWindow: m.contextWindow,
            availableThinkingLevels: levels,
          })
          added++
        }
        providerModelCounts.set(pid, (providerModelCounts.get(pid) ?? 0) + added)
        continue
      }

      addedProviderIds.add(pid)
      for (const m of sdkList) {
        const levels = pickLevels(`${pid}/${m.id}`, m.availableThinkingLevels)
        rawModels.push({
          providerId: pid,
          providerLabel: pid,
          id: m.id,
          name: m.name || m.id,
          isLocalJson: false,
          isOAuth,
          reasoning: (levels?.length ?? 0) > 1,
          multimodal: false,
          contextWindow: m.contextWindow,
          availableThinkingLevels: levels,
        })
      }
      providerModelCounts.set(pid, sdkList.length)
    }

    const patterns = prefs?.enabledModels
    const isAutoAll = !patterns || patterns.length === 0
    const isExplicit =
      !patterns || patterns.every((key) => key.includes('/') && !/[*?:[\]]/.test(key))

    const enabledSet = new Set(
      filterEnabledModels(
        rawModels.map((m) => ({ provider: m.providerId, id: m.id, name: m.name })),
        patterns,
      ).map((m) => `${m.provider}/${m.id}`),
    )

    const items: UnifiedModelItem[] = rawModels.map((m) => {
      const fullKey = `${m.providerId}/${m.id}`
      const { channel, shortName } = splitProviderChannel(m.providerId, m.id)
      return {
        fullKey,
        providerId: m.providerId,
        providerLabel: m.providerLabel,
        channel,
        shortName,
        displayName: m.name || m.id,
        isLocalJson: m.isLocalJson,
        isOAuth: m.isOAuth,
        reasoning: m.reasoning,
        multimodal: m.multimodal,
        contextWindow: m.contextWindow,
        availableThinkingLevels: m.availableThinkingLevels,
        enabled: isAutoAll ? true : enabledSet.has(fullKey),
      }
    })

    const enabledCountByProvider = new Map<string, number>()
    for (const item of items) {
      if (item.enabled) {
        enabledCountByProvider.set(
          item.providerId,
          (enabledCountByProvider.get(item.providerId) ?? 0) + 1,
        )
      }
    }

    const providerList: UnifiedProviderItem[] = []
    for (const pid of providerIds) {
      const p = draft!.providers[pid]
      const preset = guessPresetForProvider(pid, p)
      const label = p.name || preset?.label || pid
      const protocol =
        API_OPTS.find((o) => o.v === p.api)?.l || p.api || t('models.apiNotSetLabel')
      providerList.push({
        id: pid,
        label,
        kind: 'json',
        endpoint: p.baseUrl || t('models.notSetBaseUrl'),
        protocol,
        preset,
        jsonConfig: p,
        modelCount: providerModelCounts.get(pid) ?? 0,
        enabledCount: enabledCountByProvider.get(pid) ?? 0,
        hasIssue: !p.baseUrl,
      })
    }

    for (const pid of configuredSdkProviderIds) {
      if (providerIds.includes(pid)) continue
      const sdkList = sdkModelsByProvider[pid] || []
      const auth = sdkList.find((m) => m.auth?.configured)?.auth
      const isOAuth = auth?.type === 'oauth'
      const preset = guessPresetForProvider(pid, {})
      providerList.push({
        id: pid,
        label: pid,
        kind: isOAuth ? 'oauth' : 'sdk',
        endpoint: isOAuth ? t('models.workbench.oauthEndpoint') : t('models.workbench.sdkEndpoint'),
        protocol: isOAuth ? t('models.workbench.oauthProtocol') : t('models.authTypeApiKey'),
        preset,
        modelCount: sdkList.length,
        enabledCount: enabledCountByProvider.get(pid) ?? 0,
        authType: auth?.type,
      })
    }

    return {
      unifiedProviders: providerList,
      allModels: items,
      allKnownKeys: items.map((i) => i.fullKey),
      autoEnableAll: isAutoAll,
      explicitScope: isExplicit,
    }
  }, [providerIds, configuredSdkProviderIds, draft, sdkModelsByProvider, availableModels, prefs?.enabledModels, t])

  // 默认选中第一个供应商（如果没有则回退总览）
  useEffect(() => {
    if (!selectedScope && unifiedProviders.length > 0) {
      setSelectedScope(unifiedProviders[0].id)
    }
  }, [selectedScope, unifiedProviders])

  const addFromPreset = (preset: ProviderPreset) => {
    const key = allocateProviderKey(draft?.providers || {}, preset.defaultKey)
    setAddMenuOpen(false)
    setNewProvider({ pid: key, preset })
  }

  const createProvider = ({ pid: key, config }: ProviderDraft) => {
    patchDraft((c) => {
      c.providers[key] = config
    })
    setSelectedScope(key)
    setNewProvider(null)
    toast.success(t('models.addedProviderToast', { label: config.name || key, key }))
  }

  const removeProvider = (id: string) => {
    patchDraft((c) => {
      delete c.providers[id]
    })
    if (selectedScope === id) setSelectedScope('enabled-all')
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRemoteCatalog((prev) => ({ ...prev, [providerId]: { ids: prev[providerId]?.ids || [], error: message } }))
      toast.error(message)
    } finally {
      setFetching(null)
    }
  }

  const addModelToLocal = (providerId: string, modelId: string) => {
    if ((draft?.providers[providerId]?.models || []).some((m) => m.id === modelId)) return
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
    const existing = new Set((draft?.providers[providerId]?.models || []).map((m) => m.id))
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
      if ((draft?.providers[providerId]?.models || []).some((m) => m.id === modelId)) continue
      addModelToLocal(providerId, modelId)
    }
    setManualAddProviderId(null)
    if (ids.length === 1) return
    toast.success(t('models.addedModels', { count: ids.length }))
  }

  const handleReloadProviderModels = (pid: string) => {
    setReloadingProviderId(pid)
    void forceReloadAvailableModels()
      .then(async () => {
        const snapshot = await ipcClient.invoke('model.list', { scope: 'settings' })
        const list = snapshot?.models || []
        setSettingsModels(list)
        const count = list.filter((m) => m.provider === pid).length
        toast.success(t('models.workbench.reloadedSubscriptionModels', { provider: pid, count }))
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setReloadingProviderId(null))
  }

  const handleRefreshCatalog = () => {
    setRefreshing(true)
    void forceReloadAvailableModels()
      .then(async () => {
        const snapshot = await ipcClient.invoke('model.list', { scope: 'settings' })
        setSettingsModels(snapshot?.models || [])
        if (configEqual(currentConfig.current.draft, currentConfig.current.baseline)) {
          const res = await ipcClient.invoke('pi.models.get', {})
          if (configEqual(currentConfig.current.draft, currentConfig.current.baseline)) {
            const cfg = res?.config ?? { providers: {} }
            setFilePath(res?.path || '')
            setParseError(res?.parseError || null)
            setSchemaError(res?.schemaError || null)
            setLoadWarnings(res?.warnings?.length ? res.warnings : [])
            setBaseline(cloneConfig(cfg))
            setDraft(cloneConfig(cfg))
          }
        }
        toast.success(t('models.localCatalogRefreshed'))
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setRefreshing(false))
  }

  if (loading && !draft) {
    return <p className="text-base text-muted-foreground">{t('models.loadingModels')}</p>
  }

  const defaultModelKey =
    prefs?.defaultProvider && prefs?.defaultModel
      ? `${prefs.defaultProvider}/${prefs.defaultModel}`
      : ''
  const pluginModel = settingsDraft?.draft.pluginModel ?? null
  const pluginModelKey = pluginModel ? `${pluginModel.provider}/${pluginModel.modelId}` : ''
  const hasConfigError = Boolean(parseError || schemaError || saveError)
  const isAutoSaving = modelsAutoSave === 'saving' || savingPrefs

  return (
    <div className="space-y-5">
      {/* 紧凑顶部栏：标题 + models.json 同步状态 + 紧凑分段导航 + 刷新按钮 */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[19px] font-semibold tracking-tight text-foreground">
              {t('nav.models')}
            </h2>
            <span
              title={filePath || '~/.pi/agent/models.json'}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-[var(--bg-1)] px-2.5 py-0.5 text-[11.5px] text-foreground-secondary"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  hasConfigError
                    ? 'bg-amber-500'
                    : isAutoSaving
                      ? 'animate-pulse bg-primary'
                      : 'bg-emerald-500',
                )}
              />
              <span>
                {hasConfigError
                  ? t('models.workbench.syncAttention')
                  : isAutoSaving
                    ? t('models.workbench.autoSavingBadge')
                    : modelsAutoSave === 'saved'
                      ? t('models.workbench.autoSavedBadge')
                      : t('models.workbench.syncedBadge')}
              </span>
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-foreground-secondary">
            {t('models.workbench.headerSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {subTabs}
          <button
            type="button"
            className={cn(btnOutline, 'inline-flex items-center gap-1.5 text-[12.5px]')}
            disabled={refreshing}
            onClick={handleRefreshCatalog}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-foreground-secondary', refreshing && 'animate-spin')} strokeWidth={2} />
            <span>{refreshing ? t('models.fetching') : t('models.reload')}</span>
          </button>
        </div>
      </header>

      {hasConfigError && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 whitespace-pre-wrap px-3.5 py-2.5 text-[12.5px] text-amber-900 dark:text-amber-200">
          {parseError && <div>{parseError}</div>}
          {schemaError && <div>{schemaError}</div>}
          {saveError && <div>{saveError}</div>}
        </div>
      )}

      {loadWarnings.length > 0 && !parseError && (
        <details className="ui-enter rounded-xl border border-border/50 bg-muted/20 px-3.5 py-2 text-[12.5px] text-muted-foreground">
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

      {/* 区域一：场景指派双卡 */}
      <ModelAssignmentCards
        allModels={allModels}
        defaultProvider={prefs?.defaultProvider}
        defaultModel={prefs?.defaultModel}
        defaultThinkingLevel={prefs?.defaultThinkingLevel}
        pluginModel={pluginModel}
        onSelectDefault={(item) => {
          const rawModelId = item.fullKey.slice(item.providerId.length + 1)
          setDefaultModel(item.providerId, rawModelId, item.availableThinkingLevels, allKnownKeys)
          toast.success(t('models.workbench.toastSetDefault', { name: item.shortName }))
        }}
        onClearDefault={() => {
          clearDefaultModel()
          toast.message(t('models.workbench.toastClearedDefault'))
        }}
        onChangeDefaultThinking={(level) => setDefaultThinking(level)}
        onSetPluginModel={settingsDraft?.setPluginModel}
      />

      {/* 区域二：供应商与模型双栏工作台 */}
      <ModelWorkbench
        providers={unifiedProviders}
        allModels={allModels}
        selectedScope={selectedScope || 'enabled-all'}
        onSelectScope={setSelectedScope}
        autoEnableAll={autoEnableAll}
        explicitScope={explicitScope}
        enabledPatterns={prefs?.enabledModels}
        defaultModelKey={defaultModelKey}
        pluginModelKey={pluginModelKey}
        thinkingBindings={prefs?.modelThinkingLevels ?? {}}
        fetchingProviderId={fetching}
        reloadingProviderId={reloadingProviderId}
        remoteCatalog={remoteCatalog}
        expandedLocalModel={expandedLocalModel}
        onToggleLocalModel={(rowKey) =>
          setExpandedLocalModel((e) => ({ ...e, [rowKey]: !e[rowKey] }))
        }
        onOpenAddProvider={() => setAddMenuOpen(true)}
        onEditProvider={(pid) => setEditingProviderId(pid)}
        onRemoveProvider={(pid) => {
          const p = draft?.providers[pid]
          setConfirmState({
            title: t('models.deleteProvider'),
            message: t('models.deleteProviderConfirm', {
              name: p?.name || pid,
              id: pid,
            }),
            destructive: true,
            onConfirm: () => {
              setConfirmState(null)
              removeProvider(pid)
            },
          })
        }}
        onLogoutProvider={(pid) => {
          void ipcClient
            .invoke('model.auth.logout', { providerId: pid })
            .then(() =>
              ipcClient.invoke('model.list', { scope: 'settings' }).then((snapshot) => {
                setSettingsModels(snapshot?.models || [])
                toast.success(t('models.workbench.toastLoggedOut', { provider: pid }))
              }),
            )
            .catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : String(error)),
            )
        }}
        onReloadProviderModels={handleReloadProviderModels}
        onFetchRemote={(pid) => void fetchRemoteCatalog(pid)}
        onManualAdd={(pid) => setManualAddProviderId(pid)}
        onAddRemoteModel={(pid, modelId) => addModelToLocal(pid, modelId)}
        onAddAllRemote={(pid) => addAllNewToLocal(pid)}
        onUpdateLocalModel={(pid, modelId, patch) => updateModelEntry(pid, modelId, patch)}
        onRemoveLocalModel={(pid, modelId) => removeModel(pid, modelId)}
        onToggleAutoEnableAll={(autoAll) => setAutoEnableAll(autoAll, allKnownKeys)}
        onToggleModelEnabled={(fullKey, enabled) => {
          const res = setModelEnabled(fullKey, enabled, allKnownKeys)
          if (res.blockedLast) {
            toast.message(t('models.workbench.keepAtLeastOne'))
          }
        }}
        onBatchToggleEnabled={(keys, enabled) => {
          const res = batchSetModelsEnabled(keys, enabled, allKnownKeys)
          if (res.keptOne) {
            toast.message(t('models.workbench.keepAtLeastOne'))
          } else if (res.count > 0) {
            toast.success(
              t(enabled ? 'models.workbench.toastBatchEnabled' : 'models.workbench.toastBatchDisabled', {
                count: res.count,
              }),
            )
          }
        }}
        onApplyEnabledPatterns={setEnabledPatterns}
        onSetDefault={(item) => {
          const rawModelId = item.fullKey.slice(item.providerId.length + 1)
          setDefaultModel(item.providerId, rawModelId, item.availableThinkingLevels, allKnownKeys)
          toast.success(t('models.workbench.toastSetDefault', { name: item.shortName }))
        }}
        onSetPlugin={(item) => {
          if (!settingsDraft?.setPluginModel) return
          const rawModelId = item.fullKey.slice(item.providerId.length + 1)
          settingsDraft.setPluginModel({ provider: item.providerId, modelId: rawModelId })
          toast.success(t('models.workbench.toastSetPlugin', { name: item.shortName }))
        }}
        onSetThinkingBinding={(fullKey, level) => {
          setModelThinking(fullKey, level)
        }}
      />

      {addMenuOpen ? (
        <ProviderTemplateDialog
          onClose={() => setAddMenuOpen(false)}
          onSelectCustom={() => addFromPreset(customPreset)}
          sdkOptions={sdkAddOptions}
          onLoginProvider={(providerId, type) => {
            setAddMenuOpen(false)
            setLoginRequest({ providerId, type })
          }}
        />
      ) : null}

      {loginRequest ? (
        <ModelAuthDialog
          providerId={loginRequest.providerId}
          authType={loginRequest.type}
          providerLabel={loginRequest.providerId}
          onClose={() => setLoginRequest(null)}
          onDone={() => {
            setLoginRequest(null)
            void ipcClient.invoke('model.list', { scope: 'settings' }).then((snapshot) => {
              setSettingsModels(snapshot?.models || [])
            })
            setSelectedScope(loginRequest.providerId)
          }}
        />
      ) : null}

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

      {editingProviderId && draft?.providers[editingProviderId] ? (
        <ProviderConfigDialog
          mode="edit"
          pid={editingProviderId}
          preset={guessPresetForProvider(editingProviderId, draft.providers[editingProviderId])}
          initial={draft.providers[editingProviderId]}
          onSubmit={({ config: next }) => {
            updateProvider(editingProviderId, next)
            setEditingProviderId(null)
          }}
          onCancel={() => setEditingProviderId(null)}
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
