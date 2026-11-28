import { toast } from 'sonner'
import type { BackgroundSettings } from '@shared/background'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'
import {
  commitSettingsDraft,
  draftSignature,
  loadSettingsDraftFromDisk,
  previewDraftUi,
  type AgentRuntimeChoice,
  type PluginModelChoice,
  type SettingsDraft,
  type ThemeChoice,
  type LanguageChoice,
} from '@renderer/features/settings/settings-draft'
import type { AsrConfig } from '@shared/asr-types'
import { normalizeAlertSoundVolume, type AlertSoundPreset } from '@shared/alert-sound'
import type { CompletionDeliveryMode, CompletionPreviewMode } from '@shared/completion-preview'
import type { IconTheme } from '@shared/icon-theme'
import type { CustomCssOverride, CustomTheme } from '@shared/custom-theme'
import { normalizeTimelineMaxAutoExpandedTools, normalizeTimelineVisibleTurns } from '@shared/timeline-settings'
import { setAsrConfigPreview } from '@renderer/lib/asr-config-effective'
import {
  defaultRightPanelPrefsForCatalog,
  normalizeRightPanelOrder,
  normalizeRightPanelPrefs,
  reorderPanelIds,
} from '@shared/right-panels'
import {
  anySettingsSliceDirty,
  commitAllSettingsSlices,
  discardAllSettingsSlices,
  getDirtySettingsSlices,
  notifySettingsDirtyChanged,
  registerSettingsDirtySlice,
  subscribeSettingsDirty,
} from '@renderer/features/settings/settings-dirty-registry'

type SettingsDraftContextValue = {
  draft: SettingsDraft
  dirty: boolean
  requiresManualSave: boolean
  autoSaveStatus: 'idle' | 'saving' | 'saved'
  dirtySliceLabels: string[]
  loading: boolean
  saving: boolean
  setTheme: (t: ThemeChoice) => void
  setIconTheme: (theme: IconTheme) => void
  setCustomTheme: (t: CustomTheme) => void
  setCustomCssOverride: (override: CustomCssOverride) => void
  setBackground: (background: BackgroundSettings) => void
  setLanguage: (l: LanguageChoice) => void
  setAutoOpenLastProject: (v: boolean) => void
  setBuiltinBillionContext: (v: boolean) => void
  setAutoCheckRegistryUpdates: (v: boolean) => void
  setIncludePrereleaseUpdates: (v: boolean) => void
  setAlertSoundEnabled: (v: boolean) => void
  setAlertSoundPreset: (v: AlertSoundPreset) => void
  setAlertSoundVolume: (v: number) => void
  setAlertNotificationEnabled: (v: boolean) => void
  setAlertOnExtensionUi: (v: boolean) => void
  setAlertOnRunIdle: (v: boolean) => void
  setAlertOnBackgroundRunIdle: (v: boolean) => void
  setAlertOnRunFailed: (v: boolean) => void
  setAiActivityGlowEnabled: (v: boolean) => void
  setCompletionNotificationTimeoutSeconds: (n: number) => void
  setCompletionNotificationPreview: (v: CompletionPreviewMode) => void
  setCompletionNotificationOnlyWhenUnfocused: (v: boolean) => void
  setCompletionNotificationDndMinutes: (minutes: number | null) => void
  setCompletionNotificationDelivery: (v: CompletionDeliveryMode) => void
  setMaxSessionWorkers: (n: number) => void
  setSessionWorkerIdleTimeoutMinutes: (n: number) => void
  setTimelineMaxAutoExpandedTools: (n: number) => void
  setTimelineVisibleTurns: (n: number) => void
  setAgentRuntime: (r: AgentRuntimeChoice) => void
  setPluginModel: (model: PluginModelChoice) => void
  setExtensionOverride: (id: string, enabled: boolean) => void
  setRightPanelPref: (id: string, on: boolean) => void
  reorderRightPanels: (fromId: string, toIndex: number) => void
  resetRightPanelsToDefault: () => void
  refreshRightPanelCatalog: () => Promise<void>
  setAsrConfig: (patch: Partial<AsrConfig>) => void
  discard: () => Promise<void>
  save: () => Promise<boolean>
}

let lastSaveError: unknown = null

/** The error behind the last failed save (consumed once), so the save bar can say why. */
export function takeLastSettingsSaveError(): unknown {
  const error = lastSaveError
  lastSaveError = null
  return error
}

const SettingsDraftContext = createContext<SettingsDraftContextValue | null>(null)

export function useSettingsDraft(): SettingsDraftContextValue {
  const ctx = useContext(SettingsDraftContext)
  if (!ctx) throw new Error('useSettingsDraft must be used within SettingsDraftProvider')
  return ctx
}

export function useOptionalSettingsDraft(): SettingsDraftContextValue | null {
  return useContext(SettingsDraftContext)
}

function isAgentRuntimeChanged(
  next: SettingsDraft | null,
  baseline: SettingsDraft | null,
): boolean {
  if (!next || !baseline) return false
  return (
    next.agentRuntime.mode !== baseline.agentRuntime.mode ||
    next.agentRuntime.distro !== baseline.agentRuntime.distro
  )
}

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [baselineSig, setBaselineSig] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [autoSaveFailed, setAutoSaveFailed] = useState(false)
  const [sliceDirtyTick, setSliceDirtyTick] = useState(0)
  const draftDirtyRef = useRef(false)
  const draftRef = useRef<SettingsDraft | null>(null)
  const baselineDraftRef = useRef<SettingsDraft | null>(null)
  const baselineSigRef = useRef('')
  const discardDraftRef = useRef<() => Promise<void>>(async () => {})
  const autoSaveTimerRef = useRef<number | null>(null)
  const autoSaveHideTimerRef = useRef<number | null>(null)
  const autoSavingRef = useRef(false)
  const i18nRef = useRef(i18n)
  i18nRef.current = i18n
  const tRef = useRef(t)
  tRef.current = t

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const d = await loadSettingsDraftFromDisk(i18nRef.current.language)
      setDraft(d)
      baselineDraftRef.current = d
      const sig = draftSignature(d)
      baselineSigRef.current = sig
      setBaselineSig(sig)
      setAutoSaveFailed(false)
      setAsrConfigPreview(d.asrConfig)
      // Re-apply disk theme so the selected option matches the document (preview only on patch/discard/save otherwise).
      previewDraftUi(d, i18nRef.current)
      useUIStore.getState().setTheme(d.theme)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, []) // 仅 mount 时加载一次

  const draftDirty = draft ? draftSignature(draft) !== baselineSig : false
  draftDirtyRef.current = draftDirty
  draftRef.current = draft
  baselineSigRef.current = baselineSig

  useEffect(() => {
    return subscribeSettingsDirty(() => setSliceDirtyTick((n) => n + 1))
  }, [])

  useEffect(() => {
    return registerSettingsDirtySlice({
      id: 'app',
      label: 'App & Right Panels',
      isDirty: () => draftDirtyRef.current,
      commit: async () => {
        const d = draftRef.current
        if (!d) return
        if (draftSignature(d) === baselineSigRef.current) return
        const savedAsr = await commitSettingsDraft(d, i18nRef.current, baselineDraftRef.current)
        const committed = { ...d, asrConfig: savedAsr }
        baselineDraftRef.current = committed
        setDraft((prev) => (prev ? { ...prev, asrConfig: savedAsr } : prev))
        setAsrConfigPreview(savedAsr)
        const sig = draftSignature(committed)
        baselineSigRef.current = sig
        setBaselineSig(sig)
        setAutoSaveFailed(false)
      },
      discard: () => discardDraftRef.current(),
    })
  }, [])

  const externalDirtySlices = useMemo(() => {
    void sliceDirtyTick
    return getDirtySettingsSlices().filter((s) => s.id !== 'app')
  }, [sliceDirtyTick])
  const agentRuntimeDirty = isAgentRuntimeChanged(draft, baselineDraftRef.current)
  const dirty = draftDirty || externalDirtySlices.length > 0
  const requiresManualSave = agentRuntimeDirty || externalDirtySlices.length > 0 || autoSaveFailed
  const dirtySliceLabels = useMemo(() => {
    const labels: string[] = []
    if (agentRuntimeDirty) labels.push(tRef.current('settings:runtime.title', 'Runtime'))
    for (const s of externalDirtySlices) labels.push(s.label || s.id)
    if (autoSaveFailed && labels.length === 0) labels.push('App & Right Panels')
    return labels
  }, [agentRuntimeDirty, externalDirtySlices, autoSaveFailed])

  const patch = useCallback((fn: (d: SettingsDraft) => SettingsDraft) => {
    setAutoSaveFailed(false)
    setDraft((prev) => {
      if (!prev) return prev
      const next = fn(prev)
      previewDraftUi(next, i18nRef.current)
      setAsrConfigPreview(next.asrConfig)
      window.dispatchEvent(new CustomEvent('pi-desktop:asr-config-preview', { detail: next.asrConfig }))
      return next
    })
    notifySettingsDirtyChanged()
  }, [])

  const discard = useCallback(async () => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    const d = await loadSettingsDraftFromDisk(i18nRef.current.language)
    setDraft(d)
    baselineDraftRef.current = d
    const sig = draftSignature(d)
    setBaselineSig(sig)
    baselineSigRef.current = sig
    draftDirtyRef.current = false
    setAutoSaveFailed(false)
    setAutoSaveStatus('idle')
    previewDraftUi(d, i18nRef.current)
    setAsrConfigPreview(d.asrConfig)
    window.dispatchEvent(new CustomEvent('pi-desktop:asr-config-preview', { detail: d.asrConfig }))
    useUIStore.getState().applyRightPanelRuntime(d.rightPanelCatalog, d.rightPanelPrefs, d.rightPanelOrder)
    notifySettingsDirtyChanged()
  }, [])

  discardDraftRef.current = discard

  const save = useCallback(async (): Promise<boolean> => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    // Recompute from refs so we never skip commit after a stale dirty closure.
    const appDirtyNow =
      !!draftRef.current && draftSignature(draftRef.current) !== baselineSigRef.current
    const dirtyNow = appDirtyNow || anySettingsSliceDirty()
    if (!dirtyNow) return true
    setSaving(true)
    try {
      await commitAllSettingsSlices()
      const d = draftRef.current
      if (d) {
        // Prefer signature of the committed draft (commit mutates asrConfig in place).
        baselineDraftRef.current = d
        const sig = draftSignature(d)
        baselineSigRef.current = sig
        draftDirtyRef.current = false
        setBaselineSig(sig)
        setDraft({ ...d })
        setAsrConfigPreview(d.asrConfig)
        window.dispatchEvent(new CustomEvent('pi-desktop:asr-config-preview', { detail: d.asrConfig }))
      }
      setAutoSaveFailed(false)
      setSliceDirtyTick((n) => n + 1)
      notifySettingsDirtyChanged()
      return true
    } catch (e) {
      console.error('[settings] save failed', e)
      lastSaveError = e
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  // Debounced auto-save for regular app preferences (excluding agentRuntime which needs confirmation/restart).
  useEffect(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (!draft || !draftDirty || agentRuntimeDirty || saving || autoSaveFailed || autoSavingRef.current) {
      return
    }
    const targetDraft = draft
    const targetSig = draftSignature(targetDraft)
    const prevBaseline = baselineDraftRef.current
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      if (!draftRef.current || isAgentRuntimeChanged(draftRef.current, baselineDraftRef.current)) return
      autoSavingRef.current = true
      setAutoSaveStatus('saving')
      void commitSettingsDraft(targetDraft, i18nRef.current, prevBaseline)
        .then((savedAsr) => {
          const asrChanged =
            JSON.stringify(targetDraft.asrConfig) !== JSON.stringify(savedAsr)
          const latest = draftRef.current
          const unchangedDuringSave = latest && draftSignature(latest) === targetSig
          const committedSnap = { ...targetDraft, asrConfig: savedAsr }
          baselineDraftRef.current = committedSnap
          const committedSig = draftSignature(committedSnap)
          baselineSigRef.current = committedSig
          setBaselineSig(committedSig)
          if (unchangedDuringSave) {
            if (asrChanged) {
              setDraft((prev) => (prev ? { ...prev, asrConfig: savedAsr } : prev))
            }
            setAsrConfigPreview(savedAsr)
            draftDirtyRef.current = false
          }
          window.dispatchEvent(new Event('pi-desktop:asr-config-saved'))
          setAutoSaveStatus('saved')
          if (autoSaveHideTimerRef.current !== null) {
            window.clearTimeout(autoSaveHideTimerRef.current)
          }
          autoSaveHideTimerRef.current = window.setTimeout(() => {
            autoSaveHideTimerRef.current = null
            setAutoSaveStatus('idle')
          }, 1800)
          notifySettingsDirtyChanged()
        })
        .catch((err) => {
          console.error('[settings] auto-save failed', err)
          lastSaveError = err
          setAutoSaveFailed(true)
          setAutoSaveStatus('idle')
          toast.error(tRef.current('common:saveFailed'))
        })
        .finally(() => {
          autoSavingRef.current = false
        })
    }, 300)

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [draft, draftDirty, agentRuntimeDirty, saving, autoSaveFailed])

  // Flush pending regular preference changes if the user closes Settings before the 300ms debounce fires.
  useEffect(() => {
    return () => {
      if (autoSaveHideTimerRef.current !== null) {
        window.clearTimeout(autoSaveHideTimerRef.current)
      }
      const latest = draftRef.current
      const baseline = baselineDraftRef.current
      if (
        latest &&
        baseline &&
        draftSignature(latest) !== baselineSigRef.current &&
        !isAgentRuntimeChanged(latest, baseline) &&
        !autoSavingRef.current
      ) {
        void commitSettingsDraft(latest, i18nRef.current, baseline).catch(() => {})
      }
    }
  }, [])

  const discardAll = useCallback(async () => {
    await discardAllSettingsSlices()
    setSliceDirtyTick((n) => n + 1)
  }, [])

  const refreshRightPanelCatalog = useCallback(async () => {
    invalidateRightPanelCatalog()
    const res = await ipcClient.invoke('rightPanels.catalog')
    const cat = (res?.catalog as SettingsDraft['rightPanelCatalog']) || []
    setDraft((prev) => {
      if (!prev) return prev
      const next: SettingsDraft = {
        ...prev,
        rightPanelCatalog: cat,
        rightPanelPrefs: normalizeRightPanelPrefs(prev.rightPanelPrefs, cat),
        rightPanelOrder: normalizeRightPanelOrder(prev.rightPanelOrder, cat),
      }
      previewDraftUi(next, i18nRef.current)
      return next
    })
  }, [])

  const value = useMemo((): SettingsDraftContextValue | null => {
    if (!draft) return null
    return {
      draft,
      dirty,
      requiresManualSave,
      autoSaveStatus,
      dirtySliceLabels,
      loading,
      saving,
      setTheme: (t) => patch((d) => ({ ...d, theme: t })),
      setIconTheme: (iconTheme) => patch((d) => ({ ...d, iconTheme })),
      setCustomTheme: (t) => patch((d) => ({ ...d, customTheme: t })),
      setCustomCssOverride: (override) => patch((d) => ({ ...d, customCssOverride: override })),
      setBackground: (background) => patch((d) => ({ ...d, background })),
      setLanguage: (l) => patch((d) => ({ ...d, language: l })),
      setAutoOpenLastProject: (v) => patch((d) => ({ ...d, autoOpenLastProject: v })),
      setBuiltinBillionContext: (v) => patch((d) => ({ ...d, builtinBillionContext: v })),
      setAutoCheckRegistryUpdates: (v) => patch((d) => ({ ...d, autoCheckRegistryUpdates: v })),
      setIncludePrereleaseUpdates: (v) => patch((d) => ({ ...d, includePrereleaseUpdates: v })),
      setAlertSoundEnabled: (v) => patch((d) => ({ ...d, alertSoundEnabled: v })),
  setAlertSoundPreset: (v) => patch((d) => ({ ...d, alertSoundPreset: v })),
  setAlertSoundVolume: (v) => patch((d) => ({ ...d, alertSoundVolume: normalizeAlertSoundVolume(v) })),
      setAlertNotificationEnabled: (v) => patch((d) => ({ ...d, alertNotificationEnabled: v })),
      setAlertOnExtensionUi: (v) => patch((d) => ({ ...d, alertOnExtensionUi: v })),
      setAlertOnRunIdle: (v) => patch((d) => ({ ...d, alertOnRunIdle: v })),
      setAlertOnBackgroundRunIdle: (v) => patch((d) => ({ ...d, alertOnBackgroundRunIdle: v })),
      setAlertOnRunFailed: (v) => patch((d) => ({ ...d, alertOnRunFailed: v })),
      setAiActivityGlowEnabled: (v) => patch((d) => ({ ...d, aiActivityGlowEnabled: v })),
      setCompletionNotificationTimeoutSeconds: (n) =>
        patch((d) => ({
          ...d,
          completionNotificationTimeoutSeconds: Number.isFinite(n) ? Math.min(60, Math.max(5, Math.round(n))) : d.completionNotificationTimeoutSeconds,
        })),
      setCompletionNotificationPreview: (v) => patch((d) => ({ ...d, completionNotificationPreview: v })),
      setCompletionNotificationOnlyWhenUnfocused: (v) =>
        patch((d) => ({ ...d, completionNotificationOnlyWhenUnfocused: v })),
      setCompletionNotificationDndMinutes: (minutes) =>
        patch((d) => ({
          ...d,
          completionNotificationDndUntil: minutes == null ? null : Date.now() + minutes * 60_000,
        })),
      setCompletionNotificationDelivery: (v) => patch((d) => ({ ...d, completionNotificationDelivery: v })),
      setMaxSessionWorkers: (n) =>
        patch((d) => ({
          ...d,
          maxSessionWorkers: Number.isFinite(n) && n >= 1 ? Math.floor(n) : d.maxSessionWorkers,
        })),
      setSessionWorkerIdleTimeoutMinutes: (n) =>
        patch((d) => ({
          ...d,
          sessionWorkerIdleTimeoutMinutes:
            Number.isFinite(n) && n >= 0 ? Math.floor(n) : d.sessionWorkerIdleTimeoutMinutes,
        })),
      setTimelineMaxAutoExpandedTools: (n) =>
        patch((d) => ({
          ...d,
          timelineMaxAutoExpandedTools: normalizeTimelineMaxAutoExpandedTools(n),
        })),
      setTimelineVisibleTurns: (n) => patch((d) => ({ ...d, timelineVisibleTurns: normalizeTimelineVisibleTurns(n) })),
      setAgentRuntime: (r) => patch((d) => ({ ...d, agentRuntime: r })),
      setPluginModel: (model) => patch((d) => ({ ...d, pluginModel: model })),
      setExtensionOverride: (id, enabled) =>
        patch((d) => ({
          ...d,
          extensionOverrides: { ...d.extensionOverrides, [id]: enabled },
        })),
      setRightPanelPref: (id, on) =>
        patch((d) => ({
          ...d,
          rightPanelPrefs: { ...d.rightPanelPrefs, [id]: on },
        })),
      reorderRightPanels: (fromId, toIndex) =>
        patch((d) => ({
          ...d,
          rightPanelOrder: reorderPanelIds(d.rightPanelOrder, fromId, toIndex),
        })),
      resetRightPanelsToDefault: () =>
        patch((d) => ({
          ...d,
          rightPanelPrefs: defaultRightPanelPrefsForCatalog(d.rightPanelCatalog, []),
          rightPanelOrder: normalizeRightPanelOrder([], d.rightPanelCatalog),
        })),
      setAsrConfig: (p: Partial<AsrConfig>) =>
        patch((d) => ({ ...d, asrConfig: { ...d.asrConfig, ...p } })),
      refreshRightPanelCatalog,
      discard: discardAll,
      save,
    }
  }, [draft, dirty, requiresManualSave, autoSaveStatus, dirtySliceLabels, loading, saving, patch, discardAll, save, refreshRightPanelCatalog])

  if (!value) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('common:loadingSettings')}</div>
  }

  return <SettingsDraftContext.Provider value={value}>{children}</SettingsDraftContext.Provider>
}
