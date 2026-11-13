import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelInfo } from '@shared/ipc-contract'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useSettingsDraft } from './settings-draft-context'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { selectCls } from './settings-controls'
import type { ModelThinkingLevel } from '@shared/model-thinking-levels'

export function PluginModelSettings() {
  const { t } = useTranslation()
  const { draft, setPluginModel } = useSettingsDraft()
  const [models, setModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    let live = true
    void ipcClient.invoke('model.list', { scope: 'available' }).then((result: { models?: ModelInfo[] }) => {
      if (live) setModels((result?.models || []).filter((model) => model.available !== false && model.provider && model.id))
    }).catch(() => { if (live) setModels([]) })
    return () => { live = false }
  }, [])

  const value = draft.pluginModel ? `${draft.pluginModel.provider}/${draft.pluginModel.modelId}` : ''
  const selected = models.find((model) => `${model.provider}/${model.id}` === value)
  const levels = selected?.availableThinkingLevels ?? []
  const options = models.map((model) => ({ key: `${model.provider}/${model.id}`, label: `${model.name || model.id} · ${model.provider}` }))
  if (value && !options.some((option) => option.key === value)) options.unshift({ key: value, label: value })

  return (
    <SettingsSection title={t('settings:pluginModel.title')} description={t('settings:pluginModel.description')}>
      <SettingRow label={t('settings:pluginModel.label')} description={t('settings:pluginModel.hint')}>
        <select className={selectCls} value={value} aria-label={t('settings:pluginModel.label')} onChange={(event) => {
          const [provider, ...rest] = event.target.value.split('/')
          setPluginModel(provider && rest.length ? { provider, modelId: rest.join('/') } : null)
        }}>
          <option value="">{t('settings:pluginModel.none')}</option>
          {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </SettingRow>
      {draft.pluginModel && <SettingRow label={t('settings:pluginModel.thinking')} description={t('settings:pluginModel.thinkingHint')}>
        <select className={selectCls} value={draft.pluginModel.thinkingLevel || ''} aria-label={t('settings:pluginModel.thinking')} onChange={(event) => {
          const level = event.target.value as ModelThinkingLevel | ''
          setPluginModel({ ...draft.pluginModel!, thinkingLevel: level || undefined })
        }}>
          <option value="">{t('settings:pluginModel.thinkingAuto')}</option>
          {draft.pluginModel.thinkingLevel && !levels.includes(draft.pluginModel.thinkingLevel) && <option value={draft.pluginModel.thinkingLevel} disabled>{draft.pluginModel.thinkingLevel} ({t('settings:pluginModel.thinkingUnavailable')})</option>}
          {levels.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
      </SettingRow>}
    </SettingsSection>
  )
}
