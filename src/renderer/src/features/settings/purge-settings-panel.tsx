import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { PurgeMode, PurgeState } from '@shared/ipc-contract'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection, Toggle } from '@renderer/features/settings/settings-page-shared'
import { btnOutline, selectCls } from '@renderer/features/settings/settings-controls'

const MODES: PurgeMode[] = ['strict', 'replace', 'append']

/**
 * 破甲开关（设置 › Agent › 破甲）。
 *
 * 与其它设置页不同，这里不走草稿 + 保存栏：开关直接写 <agentDir>/purge/config.json，
 * 扩展每轮请求前读一次，所以拨完对当前会话的下一句话就生效，不需要重启、不需要敲命令。
 */
export function PurgeSettings() {
  const { t } = useTranslation()
  const [state, setState] = useState<PurgeState | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')

  const apply = useCallback((next: PurgeState | null) => {
    if (next) setState(next)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await ipcClient.invoke('purge.getState', {})
      setState(next)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (fn: () => Promise<PurgeState>, okText?: string) => {
      setBusy(true)
      try {
        const next = await fn()
        apply(next)
        if (okText) toast.message(okText)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  const enabled = state?.enabled === true
  const ready = state?.extensionInstalled === true && state?.personaExists === true

  return (
    <div className="space-y-1">
      <SettingsPageHeader
        title={t('settings:nav.purge')}
        description={t('settings:purge.description')}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnOutline}
              disabled={busy}
              onClick={() => void run(() => ipcClient.invoke('purge.reinstall', {}), t('settings:purge.reinstalled'))}
            >
              {t('settings:purge.reinstall')}
            </button>
            <button type="button" className={btnOutline} disabled={busy} onClick={() => void refresh()}>
              {t('settings:purge.refresh')}
            </button>
          </div>
        }
      />

      {loadError && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
          {loadError}
        </div>
      )}
      {state?.error && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
          {state.error}
        </div>
      )}

      <SettingsSection title={t('settings:purge.switchSection')}>
        <SettingRow
          label={t('settings:purge.enableLabel')}
          description={t('settings:purge.enableHint')}
          badge={
            <span
              className={
                enabled
                  ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600'
                  : 'rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-foreground-secondary'
              }
            >
              {enabled ? t('settings:purge.badgeOn') : t('settings:purge.badgeOff')}
            </span>
          }
        >
          <Toggle
            on={enabled}
            disabled={busy || !state}
            onChange={(next) => void run(() => ipcClient.invoke('purge.setEnabled', { enabled: next }))}
          />
        </SettingRow>

        <SettingRow
          label={t('settings:purge.modeLabel')}
          description={t(`settings:purge.modeHint.${state?.mode ?? 'strict'}`)}
        >
          <select
            className={selectCls}
            value={state?.mode ?? 'strict'}
            disabled={busy || !state}
            aria-label={t('settings:purge.modeLabel')}
            onChange={(event) =>
              void run(() => ipcClient.invoke('purge.setMode', { mode: event.target.value as PurgeMode }))
            }
          >
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`settings:purge.mode.${mode}`)}
              </option>
            ))}
          </select>
        </SettingRow>

        {/* 三种模式的差别只有一句话，直接摆出来，别让人靠下拉框一个个试。 */}
        <div className="mt-1 mb-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground-secondary">
            {t('settings:purge.modeCompareTitle')}
          </div>
          <ul className="space-y-1.5">
            {MODES.map((mode) => {
              const active = (state?.mode ?? 'strict') === mode
              return (
                <li
                  key={mode}
                  className={`text-[12.5px] leading-relaxed ${active ? 'text-foreground' : 'text-foreground-secondary'}`}
                >
                  <span className="font-medium">{t(`settings:purge.mode.${mode}`)}</span>
                  {mode === 'replace' && (
                    <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-600">
                      {t('settings:purge.modeRecommended')}
                    </span>
                  )}
                  <span className="mx-1">—</span>
                  <span>{t(`settings:purge.modeCompare.${mode}`)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings:purge.personaSection')}
        description={t('settings:purge.personaHint')}
        action={
          <button
            type="button"
            className={btnOutline}
            disabled={busy}
            onClick={() => void run(() => ipcClient.invoke('purge.choosePersona', {}), t('settings:purge.personaImported'))}
          >
            {t('settings:purge.choosePersona')}
          </button>
        }
      >
        <SettingRow label={t('settings:purge.personaFile')} description={state?.personaFile}>
          <span className="font-mono text-[12px] text-foreground-secondary">
            {state?.personaExists ? t('settings:purge.personaChars', { chars: state.personaChars }) : t('settings:purge.personaMissing')}
          </span>
        </SettingRow>
        <SettingRow label={t('settings:purge.extensionFile')} description={state?.extensionFile}>
          <span className={state?.extensionInstalled ? 'text-[12px] text-emerald-600' : 'text-[12px] text-destructive'}>
            {state?.extensionInstalled ? t('settings:purge.extensionOk') : t('settings:purge.extensionMissing')}
          </span>
        </SettingRow>
        <SettingRow label={t('settings:purge.configFile')} description={state?.configFile}>
          <span className="text-[12px] text-foreground-secondary">{t('settings:purge.configHint')}</span>
        </SettingRow>
      </SettingsSection>

      {!ready && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12.5px] leading-relaxed text-amber-700">
          {state?.extensionInstalled === false ? t('settings:purge.needReinstall') : t('settings:purge.needPersona')}
        </div>
      )}
      <div className="mt-3 px-1 text-[12px] leading-relaxed text-foreground-secondary">{t('settings:purge.footer')}</div>
    </div>
  )
}
