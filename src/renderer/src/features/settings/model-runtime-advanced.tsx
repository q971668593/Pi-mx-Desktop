import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from '@renderer/components/icons'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  ensureAvailableModels,
  peekAvailableModels,
  subscribeAvailableModels,
} from '@renderer/lib/available-models-cache'
import { publishEnabledModels } from '@renderer/lib/enabled-models'
import { loadModelThinkingBindings } from '@renderer/lib/model-thinking-bindings'
import { useSettingsDirtySlice } from './use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from './settings-dirty-registry'
import { SettingRow } from './settings-page-shared'
import { btnOutline, inputCls, selectCls } from './settings-controls'

export const THINKING_LEVEL_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

type Advanced = {
  enabledModels?: string[]
  modelThinkingLevels: Record<string, string>
}

const FIELDS = ['enabledModels', 'modelThinkingLevels'] as const

function fromSettings(raw: Record<string, unknown> | null | undefined): Advanced {
  const bindings = raw?.modelThinkingLevels
  return {
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

/** Only keys that changed, so this section never rewrites settings another page just saved. */
export function changedModelAdvancedSettings(draft: Advanced, baseline: Advanced): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if (JSON.stringify(draft[key] ?? null) !== JSON.stringify(baseline[key] ?? null)) patch[key] = draft[key]
  }
  // IPC drops `undefined`; `null` tells the Worker to clear the scope.
  if ('enabledModels' in patch && patch.enabledModels === undefined) patch.enabledModels = null
  return patch
}

/**
 * Settings → Models → advanced (collapsed by default).
 *
 * 默认模型在上面的 ModelDefaultSection 里选；
 * 这里只留两样「按模型/按范围」的东西 —— 快捷切换的范围（pi `enabledModels`）和
 * 逐模型绑定的思考等级（pi `modelThinkingLevels`，与终端 pi ≥ 0.84 共用）。
 */
export function ModelRuntimeAdvanced() {
  const { t } = useTranslation()
  const [baseline, setBaseline] = useState<Advanced | null>(null)
  const [draft, setDraft] = useState<Advanced | null>(null)
  const [models, setModels] = useState(() => peekAvailableModels())
  const [newModel, setNewModel] = useState('')
  const [newLevel, setNewLevel] = useState('high')
  const [scopeText, setScopeText] = useState('')
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  draftRef.current = draft
  baselineRef.current = baseline

  const load = useCallback(async () => {
    const res = await ipcClient.invoke('pi.settings.get')
    if (!res?.settings) throw new Error(res?.error || 'settings_load_failed')
    const snapshot = fromSettings((res?.settings as Record<string, unknown> | null) ?? null)
    setBaseline(snapshot)
    setDraft(snapshot)
    setScopeText((snapshot.enabledModels ?? []).join(', '))
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
    void ensureAvailableModels().catch(() => {})
    return subscribeAvailableModels(setModels)
  }, [load])

  const patch = (next: Partial<Advanced>) => {
    setDraft((previous) => (previous ? { ...previous, ...next } : previous))
    notifySettingsDirtyChanged()
  }

  useSettingsDirtySlice({
    id: 'model-advanced',
    label: t('settings:models.advanced.title'),
    isDirty: () =>
      !!draftRef.current &&
      !!baselineRef.current &&
      Object.keys(changedModelAdvancedSettings(draftRef.current, baselineRef.current)).length > 0,
    commit: async () => {
      if (!draftRef.current || !baselineRef.current) return
      const changes = changedModelAdvancedSettings(draftRef.current, baselineRef.current)
      if (Object.keys(changes).length === 0) return
      const res = await ipcClient.invoke('pi.settings.set', { patch: changes })
      if (res?.ok === false) throw new Error(String(res.error || t('common:saveFailed')))
      if ('enabledModels' in changes) publishEnabledModels(draftRef.current.enabledModels)
      await load()
      await loadModelThinkingBindings(true)
    },
    discard: () => {
      void load().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
    },
  })

  const modelKeys = useMemo(
    () => [...models].map((model) => `${model.provider}/${model.id}`).sort((a, b) => a.localeCompare(b)),
    [models],
  )
  const modelsByProvider = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const key of modelKeys) {
      const provider = key.slice(0, key.indexOf('/'))
      const list = map.get(provider)
      if (list) list.push(key)
      else map.set(provider, [key])
    }
    return [...map.entries()]
  }, [modelKeys])

  if (!draft) return null

  const bindings = Object.entries(draft.modelThinkingLevels).sort(([a], [b]) => a.localeCompare(b))
  const unboundKeys = modelKeys.filter((key) => !(key in draft.modelThinkingLevels))
  const levelLabel = (level: string) => `${t(`settings:models.advanced.level.${level}`)} · ${level}`

  const addBinding = () => {
    if (!newModel) return
    patch({ modelThinkingLevels: { ...draft.modelThinkingLevels, [newModel]: newLevel } })
    setNewModel('')
  }

  const explicitScope = !draft.enabledModels || draft.enabledModels.every((key) => key.includes('/') && !/[*?:\[\]]/.test(key))
  const selected = new Set(draft.enabledModels?.length ? draft.enabledModels : modelKeys)

  return (
    <>
    <section className="settings-card space-y-2 px-4 py-3" data-testid="model-cycle-selection">
      <h3 className="text-sm font-semibold">{t('settings:models.cycleSelectionTitle')}</h3>
      <p className="text-xs text-foreground-secondary">{t('settings:models.cycleSelectionDescription')}</p>
      <button type="button" className={btnOutline} onClick={() => { patch({ enabledModels: undefined }); setScopeText('') }}>{t('settings:models.cycleSelectionAll')}</button>
      {!explicitScope ? <p className="text-xs text-foreground-secondary">{t('settings:models.cycleSelectionPatterns')}</p> : modelKeys.length === 0 ? <p className="text-xs text-foreground-secondary">{t('settings:models.cycleSelectionEmpty')}</p> : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {modelKeys.map((key) => <label key={key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={selected.has(key)} disabled={selected.has(key) && selected.size <= 1} onChange={(event) => {
              const next = new Set(selected)
              if (event.target.checked) next.add(key)
              else next.delete(key)
              const patterns = [...next]
              patch({ enabledModels: patterns })
              setScopeText(patterns.join(', '))
            }} />
            <span className="break-all font-mono">{key}</span>
          </label>)}
        </div>
      )}
    </section>
    <details className="settings-card group overflow-hidden" data-testid="model-advanced">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 transition hover:bg-[var(--bg-hover)]/50">
        <span className="text-base font-semibold text-foreground">{t('settings:models.advanced.title')}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground-secondary">
          {t('settings:models.advanced.description')}
        </span>
      </summary>
      <div className="border-t border-border/60">
        <SettingRow label={t('settings:models.advanced.cycleScope')} description={t('settings:models.advanced.cycleScopeDesc')}>
          <input
            className={cn(inputCls, 'w-[min(300px,70vw)] font-mono text-[12px]')}
            aria-label={t('settings:models.advanced.cycleScope')}
            value={scopeText}
            placeholder={t('settings:models.advanced.cycleScopePlaceholder')}
            onChange={(event) => setScopeText(event.target.value)}
            onBlur={() => {
              const patterns = scopeText.split(/[,\n]\s*/).map((part) => part.trim()).filter(Boolean)
              patch({ enabledModels: patterns.length ? patterns : undefined })
            }}
          />
        </SettingRow>
        <div className="model-bindings space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-[13.5px] font-medium text-foreground">{t('settings:models.advanced.bindingsTitle')}</div>
              <p className="mt-0.5 max-w-xl text-[12px] leading-[1.55] text-foreground-secondary">{t('settings:models.advanced.bindingsDesc')}</p>
            </div>
            <span className="text-[11.5px] tabular-nums text-foreground-secondary">
              {t('settings:models.advanced.bindingsCount', { count: bindings.length })}
            </span>
          </div>
          {bindings.length > 0 ? (
            <ul className="model-binding-list">
              {bindings.map(([key, level]) => {
                const slash = key.indexOf('/')
                return (
                  <li key={key} className="model-binding-row">
                    <span className="model-binding-provider">{key.slice(0, slash)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground" title={key}>
                      {key.slice(slash + 1)}
                    </span>
                    {!modelKeys.includes(key) && modelKeys.length > 0 ? (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">{t('settings:models.advanced.bindingMissing')}</span>
                    ) : null}
                    <select
                      className={cn(selectCls, 'h-8 min-h-8 w-[150px] text-[12.5px]')}
                      value={level}
                      aria-label={t('settings:models.advanced.bindingLevel', { model: key })}
                      onChange={(event) => patch({ modelThinkingLevels: { ...draft.modelThinkingLevels, [key]: event.target.value } })}
                    >
                      {THINKING_LEVEL_KEYS.map((option) => (
                        <option key={option} value={option}>
                          {levelLabel(option)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="chrome-icon-btn flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary hover:text-destructive"
                      aria-label={t('settings:models.advanced.removeBinding', { model: key })}
                      title={t('settings:models.advanced.removeBinding', { model: key })}
                      onClick={() => {
                        const next = { ...draft.modelThinkingLevels }
                        delete next[key]
                        patch({ modelThinkingLevels: next })
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-[12px] text-foreground-secondary">{t('settings:models.advanced.bindingsEmpty')}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={cn(selectCls, 'h-8 min-h-8 min-w-[220px] flex-1 text-[12.5px]')}
              value={newModel}
              aria-label={t('settings:models.advanced.pickModel')}
              onChange={(event) => setNewModel(event.target.value)}
            >
              <option value="">{t('settings:models.advanced.pickModel')}</option>
              {modelsByProvider.map(([provider, keys]) => {
                const free = keys.filter((key) => unboundKeys.includes(key))
                if (free.length === 0) return null
                return (
                  <optgroup key={provider} label={provider}>
                    {free.map((key) => (
                      <option key={key} value={key}>
                        {key.slice(provider.length + 1)}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
            <select
              className={cn(selectCls, 'h-8 min-h-8 w-[150px] text-[12.5px]')}
              value={newLevel}
              aria-label={t('settings:models.advanced.pickLevel')}
              onChange={(event) => setNewLevel(event.target.value)}
            >
              {THINKING_LEVEL_KEYS.map((option) => (
                <option key={option} value={option}>
                  {levelLabel(option)}
                </option>
              ))}
            </select>
            <button type="button" className={cn(btnOutline, 'h-8 min-h-8')} disabled={!newModel} onClick={addBinding}>
              <Plus className="mr-1 inline h-3.5 w-3.5" />
              {t('settings:models.advanced.addBinding')}
            </button>
          </div>
        </div>
      </div>
    </details>
    </>
  )
}
