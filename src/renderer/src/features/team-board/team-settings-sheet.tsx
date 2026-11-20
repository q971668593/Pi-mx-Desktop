import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, CheckCheck, Loader2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import {
  isAvailableModelsPending,
  peekAvailableModels,
  refreshAvailableModels,
  subscribeAvailableModels,
} from '@renderer/lib/available-models-cache'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { ModelInfo } from '@shared/ipc-contract'
import type { TeamRoleBinding, TeamSnapshot } from '@shared/team-board'
import { effortLabel, roleAvatar, roleColor, roleLabel, shortModel } from './team-board-lib'

const ALL_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function TeamSettingsSheet({
  workspaceId,
  roles,
  onClose,
  onSaved,
}: {
  workspaceId: string
  roles: TeamRoleBinding[]
  onClose: () => void
  onSaved: (snapshot: TeamSnapshot) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<TeamRoleBinding[]>(() => roles.map((role) => ({ ...role })))
  const [models, setModels] = useState<ModelInfo[]>(() => peekAvailableModels())
  const [loading, setLoading] = useState(() => isAvailableModelsPending())
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeAvailableModels(setModels)
    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    setLoading(isAvailableModelsPending() || models.length === 0)
    void refreshAvailableModels()
      .then(() => setLoadError(''))
      .catch((error) => setLoadError(String(error?.message || error)))
      .finally(() => setLoading(false))
  }, [])

  const byProvider = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const model of models) {
      const provider = model.provider || 'unknown'
      const list = map.get(provider)
      if (list) list.push(model)
      else map.set(provider, [model])
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, rows]) => ({ provider, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) }))
  }, [models])

  const update = (role: TeamRoleBinding['role'], patch: Partial<TeamRoleBinding>) => {
    setDraft((current) => current.map((item) => (item.role === role ? { ...item, ...patch } : item)))
  }

  const effortsFor = (model: string): string[] => {
    const row = models.find((item) => `${item.provider}/${item.id}` === model)
    const levels = row?.availableThinkingLevels
    return levels && levels.length ? levels : ALL_EFFORTS
  }

  const save = async () => {
    setSaving(true)
    try {
      const response = await ipcClient.invoke('teamBoard.roles.save', { workspaceId, roles: draft })
      if (response?.snapshot) onSaved(response.snapshot)
      toast.success(t('team:saved'))
      onClose()
    } catch (error) {
      toast.error(t('team:statusFailed'), { description: String((error as Error)?.message || error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="team-overlay" role="dialog" aria-modal="true" aria-label={t('team:settingsTitle')}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2.5 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('team:back')}
          className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-medium">{t('team:settingsTitle')}</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
          {t('team:save')}
        </button>
      </div>

      <div className="team-sheet-scroll team-scroll">
        <p className="text-2xs leading-relaxed text-foreground-secondary">{t('team:settingsDesc')}</p>
        {loading ? <p className="mt-1 text-2xs text-foreground-tertiary">{t('team:loadingModels')}</p> : null}
        {loadError ? <p className="mt-1 text-2xs text-amber-600">{t('team:modelLoadFailed')}</p> : null}

        <div className="mt-2 space-y-2">
          {draft.map((role) => {
            const accent = roleColor(role.role)
            const efforts = effortsFor(role.model)
            return (
              <div key={role.role} className="team-people-group !p-2" style={{ marginTop: 0 }}>
                <div className="flex items-center gap-1.5">
                  <span className="team-avatar" style={{ '--team-role': accent } as CSSProperties}>
                    <img src={roleAvatar(role.role)} alt="" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{roleLabel(role.role, t)}</div>
                    <div className="truncate text-2xs text-foreground-tertiary">{role.note}</div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1 text-2xs text-foreground-secondary" title={t('team:enabled')}>
                    <input
                      type="checkbox"
                      checked={role.enabled}
                      onChange={(event) => update(role.role, { enabled: event.target.checked })}
                      className="h-3 w-3"
                    />
                    {t('team:enabled')}
                  </label>
                </div>

                <label className="mt-2 block text-2xs text-foreground-secondary">
                  {t('team:model')}
                  <select
                    value={role.model}
                    onChange={(event) => update(role.role, { model: event.target.value, effort: '' })}
                    className="team-sheet-input mt-0.5"
                  >
                    <option value="">{t('team:unbound')}</option>
                    {role.model && !models.some((item) => `${item.provider}/${item.id}` === role.model) ? (
                      <option value={role.model}>{shortModel(role.model)}</option>
                    ) : null}
                    {byProvider.map((group) => (
                      <optgroup key={group.provider} label={group.provider}>
                        {group.rows.map((model) => {
                          const value = `${model.provider}/${model.id}`
                          return (
                            <option key={value} value={value}>
                              {model.name || model.id}
                            </option>
                          )
                        })}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <div className="mt-1.5 flex items-center gap-1.5">
                  <label className="flex-1 text-2xs text-foreground-secondary">
                    {t('team:effort')}
                    <select
                      value={role.effort}
                      onChange={(event) => update(role.role, { effort: event.target.value })}
                      className="team-sheet-input mt-0.5"
                    >
                      <option value="">{t('team:defaultEffort')}</option>
                      {efforts.map((effort) => (
                        <option key={effort} value={effort}>
                          {effortLabel(effort, t)}
                        </option>
                      ))}
                      {role.effort && !efforts.includes(role.effort) ? (
                        <option value={role.effort}>{effortLabel(role.effort, t)}</option>
                      ) : null}
                    </select>
                  </label>
                  <label className="mt-4 flex cursor-pointer items-center gap-1 text-2xs text-foreground-secondary" title={t('team:directEnabled')}>
                    <input
                      type="checkbox"
                      checked={role.directEnabled}
                      onChange={(event) => update(role.role, { directEnabled: event.target.checked })}
                      className="h-3 w-3"
                    />
                    <span className={cn(!role.enabled && 'opacity-40')}>{t('team:directEnabled')}</span>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
