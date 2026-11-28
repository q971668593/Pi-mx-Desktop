import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { publishEnabledModels } from '@renderer/lib/enabled-models'
import { loadModelThinkingBindings } from '@renderer/lib/model-thinking-bindings'

export const THINKING_LEVEL_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const FALLBACK_LEVEL = 'medium'

export interface PiModelPreferences {
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  enabledModels?: string[]
  modelThinkingLevels: Record<string, string>
}

function cleanStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parsePreferences(raw: Record<string, unknown> | null | undefined): PiModelPreferences {
  const bindings = raw?.modelThinkingLevels
  return {
    defaultProvider: cleanStr(raw?.defaultProvider),
    defaultModel: cleanStr(raw?.defaultModel),
    defaultThinkingLevel: cleanStr(raw?.defaultThinkingLevel),
    enabledModels: Array.isArray(raw?.enabledModels) ? (raw.enabledModels as unknown[]).map(String) : undefined,
    modelThinkingLevels:
      bindings && typeof bindings === 'object' && !Array.isArray(bindings)
        ? Object.fromEntries(
            Object.entries(bindings as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
  }
}

export function diffModelPreferences(draft: PiModelPreferences, baseline: PiModelPreferences): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const scalarKeys = ['defaultProvider', 'defaultModel', 'defaultThinkingLevel'] as const
  for (const key of scalarKeys) {
    if ((draft[key] ?? null) !== (baseline[key] ?? null)) {
      patch[key] = draft[key] ?? null
    }
  }
  if (JSON.stringify(draft.enabledModels ?? null) !== JSON.stringify(baseline.enabledModels ?? null)) {
    patch.enabledModels = draft.enabledModels ?? null
  }
  if (JSON.stringify(draft.modelThinkingLevels) !== JSON.stringify(baseline.modelThinkingLevels)) {
    patch.modelThinkingLevels = draft.modelThinkingLevels
  }
  return patch
}

export function useModelPreferences() {
  const { t } = useTranslation()
  const [baseline, setBaseline] = useState<PiModelPreferences | null>(null)
  const [draft, setDraft] = useState<PiModelPreferences | null>(null)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const genRef = useRef(0)
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  const savingRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  draftRef.current = draft
  baselineRef.current = baseline

  const load = useCallback(async () => {
    const gen = ++genRef.current
    const res = await ipcClient.invoke('pi.settings.get').catch(() => null)
    if (gen !== genRef.current) return
    const base = parsePreferences((res?.settings as Record<string, unknown> | null) ?? null)
    const initialDraft: PiModelPreferences = {
      ...base,
      defaultThinkingLevel:
        base.defaultThinkingLevel ??
        (base.defaultProvider && base.defaultModel ? FALLBACK_LEVEL : undefined),
    }
    setBaseline(base)
    setDraft(initialDraft)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patchPrefs = useCallback((updater: (prev: PiModelPreferences) => PiModelPreferences) => {
    genRef.current++
    setDraft((prev) => (prev ? updater(prev) : prev))
  }, [])

  // 自动保存 pi.settings（防抖 250ms，无需手动点击底部保存栏）
  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!draft || !baseline || savingRef.current) return
    const changes = diffModelPreferences(draft, baseline)
    if (Object.keys(changes).length === 0) return

    const targetDraft = draft
    const targetSig = JSON.stringify(targetDraft)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      savingRef.current = true
      setSavingPrefs(true)
      void Promise.resolve(ipcClient.invoke('pi.settings.set', { patch: changes }))
        .then(async (res) => {
          if (res?.ok === false) throw new Error(String(res.error || t('common:saveFailed')))
          if ('enabledModels' in changes) publishEnabledModels(targetDraft.enabledModels)
          if ('modelThinkingLevels' in changes) await loadModelThinkingBindings(true)
          setBaseline(targetDraft)
          if (draftRef.current && JSON.stringify(draftRef.current) === targetSig) {
            setDraft(targetDraft)
          }
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : t('common:saveFailed'))
        })
        .finally(() => {
          savingRef.current = false
          setSavingPrefs(false)
        })
    }, 250)

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [draft, baseline, savingPrefs, t])

  // 页面卸载时若仍有待保存改动，立即冲刷写入
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const d = draftRef.current
      const b = baselineRef.current
      if (!d || !b || savingRef.current) return
      const changes = diffModelPreferences(d, b)
      if (Object.keys(changes).length === 0) return
      void Promise.resolve(ipcClient.invoke('pi.settings.set', { patch: changes }))
        .then(() => {
          if ('enabledModels' in changes) publishEnabledModels(d.enabledModels)
          if ('modelThinkingLevels' in changes) void loadModelThinkingBindings(true)
        })
        .catch(() => {})
    }
  }, [])

  const setDefaultModel = useCallback(
    (provider: string, modelId: string, availableLevels?: string[], allKnownKeys?: string[]) => {
      patchPrefs((prev) => {
        const validLevels = (availableLevels ?? []).filter(Boolean)
        const keepLevel =
          prev.defaultThinkingLevel &&
          (validLevels.length === 0 || validLevels.includes(prev.defaultThinkingLevel))
            ? prev.defaultThinkingLevel
            : undefined
        const nextThinking = keepLevel ?? validLevels[0] ?? FALLBACK_LEVEL
        const fullKey = `${provider}/${modelId}`
        let nextEnabled = prev.enabledModels
        if (
          Array.isArray(prev.enabledModels) &&
          prev.enabledModels.every((k) => k.includes('/') && !/[*?:[\]]/.test(k)) &&
          !prev.enabledModels.includes(fullKey)
        ) {
          const base = prev.enabledModels.length ? prev.enabledModels : (allKnownKeys ?? [])
          nextEnabled = Array.from(new Set([...base, fullKey]))
        }
        return {
          ...prev,
          defaultProvider: provider,
          defaultModel: modelId,
          defaultThinkingLevel: nextThinking,
          enabledModels: nextEnabled,
        }
      })
    },
    [patchPrefs],
  )

  const clearDefaultModel = useCallback(() => {
    patchPrefs((prev) => ({
      ...prev,
      defaultProvider: undefined,
      defaultModel: undefined,
      defaultThinkingLevel: undefined,
    }))
  }, [patchPrefs])

  const setDefaultThinking = useCallback(
    (level: string | undefined) => {
      patchPrefs((prev) => ({ ...prev, defaultThinkingLevel: level }))
    },
    [patchPrefs],
  )

  const setAutoEnableAll = useCallback(
    (autoAll: boolean, allKnownKeys: string[]) => {
      patchPrefs((prev) => ({
        ...prev,
        enabledModels: autoAll ? undefined : [...allKnownKeys],
      }))
    },
    [patchPrefs],
  )

  const setModelEnabled = useCallback(
    (fullKey: string, enabled: boolean, allKnownKeys: string[]): { blockedLast?: boolean } => {
      let blockedLast = false
      patchPrefs((prev) => {
        const current = prev.enabledModels?.length ? prev.enabledModels : allKnownKeys
        const next = new Set(current)
        if (enabled) {
          next.add(fullKey)
        } else {
          if (next.has(fullKey) && next.size <= 1) {
            blockedLast = true
            return prev
          }
          next.delete(fullKey)
        }
        return { ...prev, enabledModels: [...next] }
      })
      return { blockedLast }
    },
    [patchPrefs],
  )

  const batchSetModelsEnabled = useCallback(
    (targetKeys: string[], enabled: boolean, allKnownKeys: string[]): { count: number; keptOne?: boolean } => {
      let count = 0
      let keptOne = false
      patchPrefs((prev) => {
        const current = prev.enabledModels?.length ? prev.enabledModels : allKnownKeys
        const next = new Set(current)
        if (enabled) {
          for (const key of targetKeys) {
            if (!next.has(key)) count++
            next.add(key)
          }
        } else {
          for (const key of targetKeys) {
            if (next.has(key)) {
              if (next.size <= 1) {
                keptOne = true
                break
              }
              next.delete(key)
              count++
            }
          }
        }
        return { ...prev, enabledModels: [...next] }
      })
      return { count, keptOne }
    },
    [patchPrefs],
  )

  const setEnabledPatterns = useCallback(
    (patterns: string[] | undefined) => {
      patchPrefs((prev) => ({
        ...prev,
        enabledModels: patterns && patterns.length > 0 ? patterns : undefined,
      }))
    },
    [patchPrefs],
  )

  const setModelThinking = useCallback(
    (fullKey: string, level: string | null) => {
      patchPrefs((prev) => {
        const next = { ...prev.modelThinkingLevels }
        if (level) next[fullKey] = level
        else delete next[fullKey]
        return { ...prev, modelThinkingLevels: next }
      })
    },
    [patchPrefs],
  )

  return {
    prefs: draft,
    savingPrefs,
    reloadPrefs: load,
    setDefaultModel,
    clearDefaultModel,
    setDefaultThinking,
    setAutoEnableAll,
    setModelEnabled,
    batchSetModelsEnabled,
    setEnabledPatterns,
    setModelThinking,
  }
}
