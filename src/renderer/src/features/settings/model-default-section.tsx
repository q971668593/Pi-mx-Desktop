import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelInfo } from '@shared/ipc-contract'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useSettingsDirtySlice } from './use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from './settings-dirty-registry'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { selectCls } from './settings-controls'

export type ModelDefault = {
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
}

const FIELDS = ['defaultProvider', 'defaultModel', 'defaultThinkingLevel'] as const
const FALLBACK_LEVEL = 'medium'

/** 与 model-runtime-advanced 的 THINKING_LEVEL_KEYS 同源；放这里避免两个 section 互相 import。 */
const THINKING_LEVEL_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function fromSettings(raw: Record<string, unknown> | null | undefined): ModelDefault {
  return {
    defaultProvider: str(raw?.defaultProvider),
    defaultModel: str(raw?.defaultModel),
    defaultThinkingLevel: str(raw?.defaultThinkingLevel),
  }
}

/** Only keys that changed, so this section never rewrites settings another page just saved. */
export function changedModelDefaultSettings(draft: ModelDefault, baseline: ModelDefault): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if ((draft[key] ?? null) !== (baseline[key] ?? null)) patch[key] = draft[key]
  }
  // IPC drops `undefined`; `null` tells the Worker to clear the scope.
  for (const key of FIELDS) {
    if (key in patch && patch[key] === undefined) patch[key] = null
  }
  return patch
}

type AuthMap = Record<string, { name?: string; subscription?: boolean }>

/**
 * Settings → Models → 默认模型（常显）。
 * 只做三件事：从已订阅的供应商里挑一个默认模型 + 思考强度。新会话自动用它。
 */
export function ModelDefaultSection({ models }: { models: ModelInfo[] }) {
  const { t } = useTranslation()
  const [baseline, setBaseline] = useState<ModelDefault | null>(null)
  const [draft, setDraft] = useState<ModelDefault | null>(null)
  const [authMap, setAuthMap] = useState<AuthMap | null>(null)
  // load() 是异步的：用户在它回来之前改了选择，就不能再用旧快照覆盖草稿，
  // 否则会出现“供应商存上了、思考强度被清空”的半截配置。
  const genRef = useRef(0)
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  draftRef.current = draft
  baselineRef.current = baseline

  const load = useCallback(async () => {
    const gen = ++genRef.current
    const res = await ipcClient.invoke('pi.settings.get').catch(() => null)
    if (gen !== genRef.current) return
    const baseline = fromSettings((res?.settings as Record<string, unknown> | null) ?? null)
    // 读回来的老配置可能没有强度：有模型没强度时补一个“中”，并标脏提醒保存。
    const draft: ModelDefault = {
      ...baseline,
      defaultThinkingLevel:
        baseline.defaultThinkingLevel ??
        (baseline.defaultProvider && baseline.defaultModel ? FALLBACK_LEVEL : undefined),
    }
    setBaseline(baseline)
    setDraft(draft)
  }, [])

  useEffect(() => {
    void load()
    // 哪些供应商是订阅登录的：只问一次，失败就不过滤（总比不让选强）。
    void Promise.resolve(ipcClient.invoke('model.auth.providers'))
      .then((result: { providers?: Array<{ providerId: string; name?: string; oauth?: { subscription?: boolean } }> } | undefined) => {
        const map: AuthMap = {}
        for (const p of result?.providers || []) {
          if (p?.providerId) map[p.providerId] = { name: p.name, subscription: p.oauth?.subscription }
        }
        setAuthMap(map)
      })
      .catch(() => setAuthMap({}))
  }, [load])

  const patch = (next: Partial<ModelDefault>) => {
    genRef.current++
    setDraft((previous) => (previous ? { ...previous, ...next } : previous))
    notifySettingsDirtyChanged()
  }

  useSettingsDirtySlice({
    id: 'model-default',
    label: t('settings:models.default.title'),
    isDirty: () =>
      !!draftRef.current &&
      !!baselineRef.current &&
      Object.keys(changedModelDefaultSettings(draftRef.current, baselineRef.current)).length > 0,
    commit: async () => {
      if (!draftRef.current || !baselineRef.current) return
      const changes = changedModelDefaultSettings(draftRef.current, baselineRef.current)
      if (Object.keys(changes).length === 0) return
      const res = await ipcClient.invoke('pi.settings.set', { patch: changes })
      if (res?.ok === false) throw new Error(String(res.error || t('common:saveFailed')))
      await load()
    },
    discard: () => {
      void load()
    },
  })

  const byProvider = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const m of models) {
      if (!m.provider || !m.id) continue
      const list = map.get(m.provider)
      if (list) {
        if (!list.some((x) => x.id === m.id)) list.push(m)
      } else map.set(m.provider, [m])
    }
    for (const list of map.values()) list.sort((a, b) => a.id.localeCompare(b.id))
    return map
  }, [models])

  const providerIds = useMemo(() => {
    const ids = [...byProvider.keys()].sort((a, b) => a.localeCompare(b))
    if (authMap === null) return ids
    const configured = ids.filter((id) => {
      const list = byProvider.get(id) ?? []
      // 没有鉴权信息时不拦；有就只留配好的
      if (!list.some((m) => m.auth !== undefined)) return true
      return list.some((m) => m.auth?.configured)
    })
    const subs = configured.filter((id) => authMap[id]?.subscription)
    // 订阅信息拿不到或一个订阅都没有时，退回“已配置的”而不是空列表
    if (Object.keys(authMap).length > 0 && subs.length > 0) return subs.sort((a, b) => a.localeCompare(b))
    return configured
  }, [byProvider, authMap])

  const modelOptions = useMemo(() => {
    if (!draft?.defaultProvider) return []
    return (byProvider.get(draft.defaultProvider) ?? []).map((m) => m.id)
  }, [byProvider, draft?.defaultProvider])

  const levelOptions = useMemo(() => {
    const current = draft?.defaultProvider && draft?.defaultModel
      ? (byProvider.get(draft.defaultProvider) ?? []).find((m) => m.id === draft.defaultModel)
      : undefined
    const available = (current?.availableThinkingLevels ?? []).filter(Boolean)
    if (available.length > 0) return available
    return [...THINKING_LEVEL_KEYS]
  }, [byProvider, draft?.defaultProvider, draft?.defaultModel])

  if (!draft) return null

  const pickProvider = (provider: string) => {
    if (!provider) {
      patch({ defaultProvider: undefined, defaultModel: undefined, defaultThinkingLevel: undefined })
      return
    }
    const first = (byProvider.get(provider) ?? [])[0]?.id
    const keepLevel = draft.defaultThinkingLevel && levelOptions.includes(draft.defaultThinkingLevel)
      ? draft.defaultThinkingLevel
      : undefined
    patch({
      defaultProvider: provider,
      defaultModel: first,
      defaultThinkingLevel: keepLevel ?? (byProvider.get(provider) ?? [])[0]?.availableThinkingLevels?.[0] ?? FALLBACK_LEVEL,
    })
  }

  const pickModel = (id: string) => {
    if (!id || !draft.defaultProvider) {
      patch({ defaultModel: undefined, defaultThinkingLevel: undefined })
      return
    }
    const info = (byProvider.get(draft.defaultProvider) ?? []).find((m) => m.id === id)
    const available = (info?.availableThinkingLevels ?? []).filter(Boolean)
    const keepLevel = draft.defaultThinkingLevel && (available.length === 0 || available.includes(draft.defaultThinkingLevel))
      ? draft.defaultThinkingLevel
      : undefined
    patch({ defaultModel: id, defaultThinkingLevel: keepLevel ?? available[0] ?? FALLBACK_LEVEL })
  }

  const levelLabel = (level: string) => {
    const known = (THINKING_LEVEL_KEYS as readonly string[]).includes(level)
    return known ? `${t(`settings:models.advanced.level.${level}`)} · ${level}` : level
  }

  const summary = draft.defaultProvider && draft.defaultModel
    ? `${draft.defaultProvider}/${draft.defaultModel}${draft.defaultThinkingLevel ? ` · ${draft.defaultThinkingLevel}` : ''}`
    : t('settings:models.default.auto')

  return (
    <SettingsSection title={t('settings:models.default.title')} description={t('settings:models.default.description')}>
      <div className="text-[12.5px] leading-[1.6] text-foreground-secondary">
        {t('settings:models.default.current', { value: summary })}
      </div>
      <SettingRow label={t('settings:models.default.provider')} description={t('settings:models.default.providerDesc')}>
          <select
            className={selectCls}
            value={draft.defaultProvider ?? ''}
            aria-label={t('settings:models.default.provider')}
            onChange={(event) => pickProvider(event.target.value)}
          >
            <option value="">{t('settings:models.default.autoOption')}</option>
            {providerIds.map((id) => (
              <option key={id} value={id}>
                {authMap?.[id]?.name || id}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('settings:models.default.model')} description={t('settings:models.default.modelDesc')}>
          <select
            className={selectCls}
            value={draft.defaultModel ?? ''}
            aria-label={t('settings:models.default.model')}
            disabled={!draft.defaultProvider}
            onChange={(event) => pickModel(event.target.value)}
          >
            <option value="">{t('settings:models.default.pickModel')}</option>
            {modelOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('settings:models.default.thinking')} description={t('settings:models.default.thinkingDesc')}>
          <select
            className={selectCls}
            value={draft.defaultThinkingLevel ?? ''}
            aria-label={t('settings:models.default.thinking')}
            disabled={!draft.defaultProvider}
            onChange={(event) => patch({ defaultThinkingLevel: event.target.value || undefined })}
          >
            <option value="">{t('settings:models.default.pickLevel')}</option>
            {levelOptions.map((level) => (
              <option key={level} value={level}>
                {levelLabel(level)}
              </option>
            ))}
          </select>
        </SettingRow>
    </SettingsSection>
  )
}
