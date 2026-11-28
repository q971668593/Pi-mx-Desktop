import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import {
  filterEnabledModels,
  peekEnabledModels,
  refreshEnabledModels,
  subscribeEnabledModels,
} from '@renderer/lib/enabled-models'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { ModelInfo } from '@shared/ipc-contract'
import {
  TEAM_MAX_CONCURRENCY_MAX,
  TEAM_MAX_CONCURRENCY_MIN,
  type TeamRoleBinding,
  type TeamSnapshot,
} from '@shared/team-board'
import { effortLabel, notifyTeamBoardChanged, roleAvatar, roleColor, roleLabel } from './team-board-lib'

const ALL_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const CONCURRENCY_OPTIONS = Array.from(
  { length: TEAM_MAX_CONCURRENCY_MAX - TEAM_MAX_CONCURRENCY_MIN + 1 },
  (_, i) => TEAM_MAX_CONCURRENCY_MIN + i,
)

function rolesSignature(list: readonly TeamRoleBinding[]): string {
  return list
    .map((r) => `${r.role}|${r.model}|${r.effort}|${r.enabled ? '1' : '0'}|${r.directEnabled ? '1' : '0'}|${r.note}`)
    .join('\n')
}

export function TeamSettingsSheet({
  workspaceId,
  sessionFile,
  roles,
  projectRoles,
  roleScope,
  defaultModel,
  defaultModelOverride,
  maxConcurrency,
  autoReview,
  onClose,
  onSaved,
}: {
  workspaceId: string
  sessionFile?: string
  roles: TeamRoleBinding[]
  projectRoles?: TeamRoleBinding[]
  roleScope?: 'session' | 'project'
  defaultModel: string
  defaultModelOverride: string
  maxConcurrency: number
  autoReview: boolean
  onClose: () => void
  onSaved: (snapshot: TeamSnapshot) => void
}) {
  const { t } = useTranslation()
  const hasSessionScope = Boolean(sessionFile)
  const [scope, setScope] = useState<'session' | 'project'>(hasSessionScope ? 'session' : 'project')
  const [sessionDraft, setSessionDraft] = useState<TeamRoleBinding[]>(() => roles.map((role) => ({ ...role })))
  const [projectDraft, setProjectDraft] = useState<TeamRoleBinding[]>(() =>
    (projectRoles ?? roles).map((role) => ({ ...role })),
  )
  const [sessionDirty, setSessionDirty] = useState(false)
  const [projectDirty, setProjectDirty] = useState(false)
  const prevSessionFileRef = useRef(sessionFile)
  const draft = scope === 'session' ? sessionDraft : projectDraft
  const [models, setModels] = useState<ModelInfo[]>(() => peekAvailableModels())
  const [enabledScope, setEnabledScope] = useState<string[] | undefined>(() => peekEnabledModels())
  const [loading, setLoading] = useState(() => isAvailableModelsPending())
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [preset, setPreset] = useState(defaultModelOverride)
  const [concurrency, setConcurrency] = useState(maxConcurrency)
  const [autoReviewDraft, setAutoReviewDraft] = useState(autoReview)
  const effectivePreset = preset || defaultModel

  useEffect(() => {
    if (prevSessionFileRef.current === sessionFile) return
    prevSessionFileRef.current = sessionFile
    setScope(Boolean(sessionFile) ? 'session' : 'project')
    setSessionDraft(roles.map((role) => ({ ...role })))
    setProjectDraft((projectRoles ?? roles).map((role) => ({ ...role })))
    setSessionDirty(false)
    setProjectDirty(false)
  }, [projectRoles, roles, sessionFile])

  useEffect(() => {
    if (sessionDirty) return
    setSessionDraft((prev) => (rolesSignature(prev) === rolesSignature(roles) ? prev : roles.map((role) => ({ ...role }))))
  }, [roles, sessionDirty])

  useEffect(() => {
    if (projectDirty) return
    const nextProject = projectRoles ?? roles
    setProjectDraft((prev) => (rolesSignature(prev) === rolesSignature(nextProject) ? prev : nextProject.map((role) => ({ ...role }))))
  }, [projectDirty, projectRoles, roles])

  useEffect(() => {
    const unsubModels = subscribeAvailableModels(setModels)
    const unsubEnabled = subscribeEnabledModels(setEnabledScope)
    return () => {
      unsubModels()
      unsubEnabled()
    }
  }, [])

  useEffect(() => {
    setLoading(isAvailableModelsPending() || models.length === 0)
    void Promise.all([
      refreshAvailableModels()
        .then(() => setLoadError(''))
        .catch((error) => setLoadError(String(error?.message || error))),
      refreshEnabledModels(),
    ]).finally(() => setLoading(false))
  }, [])

  const enabledModels = useMemo(() => filterEnabledModels(models, enabledScope), [models, enabledScope])

  const byProvider = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const model of enabledModels) {
      const provider = model.provider || 'unknown'
      const list = map.get(provider)
      if (list) list.push(model)
      else map.set(provider, [model])
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, rows]) => ({ provider, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) }))
  }, [enabledModels])

  const modelOptions = (selected: string) => (
    <>
      {selected && !enabledModels.some((item) => `${item.provider}/${item.id}` === selected) ? (
        <option value={selected}>{selected}</option>
      ) : null}
      {byProvider.map(({ provider, rows }) => (
        <optgroup key={provider} label={provider}>
          {rows.map((model) => (
            <option key={model.id} value={`${provider}/${model.id}`}>{model.name || model.id}</option>
          ))}
        </optgroup>
      ))}
    </>
  )

  const update = (role: TeamRoleBinding['role'], patch: Partial<TeamRoleBinding>) => {
    const updater = (current: TeamRoleBinding[]) =>
      current.map((item) => (item.role === role ? { ...item, ...patch } : item))
    if (scope === 'session') {
      setSessionDirty(true)
      setSessionDraft(updater)
    } else {
      setProjectDirty(true)
      setProjectDraft(updater)
    }
  }

  const effortsFor = (model: string): string[] => {
    const row = models.find((item) => `${item.provider}/${item.id}` === model)
    const levels = row?.availableThinkingLevels
    return levels && levels.length ? levels : ALL_EFFORTS
  }

  const save = async () => {
    setSaving(true)
    try {
      const globalFields = {
        ...(preset !== defaultModelOverride ? { defaultModelOverride: preset } : {}),
        ...(concurrency !== maxConcurrency ? { maxConcurrency: concurrency } : {}),
        ...(autoReviewDraft !== autoReview ? { autoReview: autoReviewDraft } : {}),
      }
      let finalSnapshot: TeamSnapshot | undefined
      if (hasSessionScope && projectDirty && sessionDirty) {
        await ipcClient.invoke('teamBoard.roles.save', {
          workspaceId,
          ...(sessionFile ? { sessionFile } : {}),
          scope: 'project',
          roles: projectDraft,
          ...globalFields,
        })
        const res = await ipcClient.invoke('teamBoard.roles.save', {
          workspaceId,
          ...(sessionFile ? { sessionFile } : {}),
          scope: 'session',
          roles: sessionDraft,
        })
        finalSnapshot = res?.snapshot
      } else {
        const targetScope: 'session' | 'project' = hasSessionScope
          ? (projectDirty && !sessionDirty ? 'project' : sessionDirty && !projectDirty ? 'session' : scope)
          : 'project'
        const targetRoles = targetScope === 'session' ? sessionDraft : projectDraft
        const res = await ipcClient.invoke('teamBoard.roles.save', {
          workspaceId,
          ...(sessionFile ? { sessionFile } : {}),
          scope: targetScope,
          roles: targetRoles,
          ...globalFields,
        })
        finalSnapshot = res?.snapshot
      }
      setSessionDirty(false)
      setProjectDirty(false)
      if (finalSnapshot) onSaved(finalSnapshot)
      notifyTeamBoardChanged()
      toast.success(t('team:saved'))
      onClose()
    } catch (error) {
      toast.error(t('team:statusFailed'), { description: String((error as Error)?.message || error) })
    } finally {
      setSaving(false)
    }
  }

  const resetToProjectDefault = async () => {
    if (!sessionFile) return
    setResetting(true)
    try {
      const response = await ipcClient.invoke('teamBoard.roles.save', {
        workspaceId,
        sessionFile,
        scope: 'session',
        clearSessionRoles: true,
        roles: projectDraft,
      })
      setSessionDirty(false)
      if (response?.snapshot) {
        setSessionDraft(response.snapshot.roles.map((role) => ({ ...role })))
        onSaved(response.snapshot)
      }
      notifyTeamBoardChanged()
      toast.success(t('team:subagentSection.resetDone'))
    } catch (error) {
      toast.error(t('team:statusFailed'), { description: String((error as Error)?.message || error) })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="team-overlay" role="dialog" aria-modal="true" aria-label={t('team:settingsTitle')}>
      <div className="team-sheet-head flex shrink-0 items-center gap-2">
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
          disabled={saving || resetting}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
          {t('team:save')}
        </button>
      </div>

      <div className="team-sheet-scroll team-scroll">
        {hasSessionScope ? (
          <div className="team-sheet-card mb-2.5">
            <div className="flex items-center gap-1.5">
              <div className="team-seg">
                <button
                  type="button"
                  onClick={() => setScope('session')}
                  data-active={scope === 'session'}
                  className="team-seg-btn"
                >
                  {t('team:subagentSection.scopeSession')}
                </button>
                <button
                  type="button"
                  onClick={() => setScope('project')}
                  data-active={scope === 'project'}
                  className="team-seg-btn"
                >
                  {t('team:subagentSection.scopeProject')}
                </button>
              </div>
              {scope === 'session' && roleScope === 'session' ? (
                <button
                  type="button"
                  disabled={resetting || saving}
                  onClick={() => void resetToProjectDefault()}
                  className="ml-auto rounded-md px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-300"
                >
                  {resetting ? t('team:loadingModels') : t('team:subagentSection.resetToProjectDefault')}
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-foreground-tertiary">
              {scope === 'session'
                ? t('team:subagentSection.scopeSessionHint')
                : t('team:subagentSection.scopeProjectHint')}
            </p>
          </div>
        ) : null}
        <p className="text-2xs leading-relaxed text-foreground-secondary">{t('team:settingsDesc')}</p>
        <div className="team-sheet-card mt-2">
          <label className="block text-2xs text-foreground-secondary">
            {t('team:defaultModel')}
            <select
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
              className="team-sheet-input mt-0.5"
            >
              <option value="">{t('team:followGlobalModel')}</option>
              {modelOptions(preset)}
            </select>
          </label>
          <p className="mt-1 text-[10.5px] text-foreground-tertiary">{t('team:defaultModelHint')}</p>
          <label className="mt-2.5 block text-2xs text-foreground-secondary">
            {t('team:maxConcurrency')}
            <select
              value={concurrency}
              onChange={(event) => setConcurrency(Number(event.target.value))}
              className="team-sheet-input mt-0.5"
            >
              {CONCURRENCY_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-[10.5px] text-foreground-tertiary">{t('team:maxConcurrencyHint')}</p>
          <label className="mt-2.5 flex cursor-pointer items-center gap-1.5 text-2xs text-foreground-secondary">
            <input
              type="checkbox"
              checked={autoReviewDraft}
              onChange={(event) => setAutoReviewDraft(event.target.checked)}
              className="h-3 w-3"
            />
            <span>{t('team:autoReview')}</span>
          </label>
          <p className="mt-0.5 text-[10.5px] text-foreground-tertiary">{t('team:autoReviewHint')}</p>
        </div>
        {effectivePreset ? null : <p className="mt-1.5 text-2xs text-foreground-secondary">{t('team:globalDefaultMissing')}</p>}
        {loading ? <p className="mt-1.5 text-2xs text-foreground-tertiary">{t('team:loadingModels')}</p> : null}
        {loadError ? <p className="mt-1.5 text-2xs text-amber-600">{t('team:modelLoadFailed')}</p> : null}

        <div className="mt-2.5 space-y-2">
          {draft.map((role) => {
            const accent = roleColor(role.role)
            const efforts = effortsFor(role.model || effectivePreset)
            return (
              <div key={role.role} className="team-sheet-card !p-2.5">
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
                    <option value="">{t('team:inheritModel', { model: effectivePreset || t('team:unbound') })}</option>
                    {modelOptions(role.model)}
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
