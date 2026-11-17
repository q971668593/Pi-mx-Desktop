import { useTranslation } from 'react-i18next'
import { Check, AlertCircle } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingRow } from './settings-page-shared'
import { btnOutline } from './settings-controls'
import { type PiInfo, type PiSettingsSnapshot } from './pi-settings-shared'

export function PiSettingsEnvAuthRows({ info, ui }: { info: PiInfo | null; ui: PiSettingsSnapshot }) {
  const { t } = useTranslation()
  const reveal = (path?: string | null) => {
    if (!path) return
    void ipcClient.invoke('shell.showItemInFolder', { path })
  }
  return (
    <>
      <SettingRow label={t('settings:pi.agentDir')} description={t('settings:pi.agentDirDesc')}>
        <div className="flex max-w-[280px] items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={info?.agentDir}>
            {info?.agentDir || '~/.pi/agent'}
          </span>
          <button type="button" className={btnOutline} onClick={() => reveal(info?.agentDir)}>
            {t('settings:pi.reveal')}
          </button>
        </div>
      </SettingRow>
      <SettingRow label={t('settings:pi.auth')} description={t('settings:pi.providerDesc')}>
        {(info?.authProviders?.length ?? 0) > 0 || info?.authStatus === 'configured' ? (
          <div className="flex max-w-xs flex-wrap items-center gap-1.5 sm:justify-end">
            <Check className="h-3.5 w-3.5 text-[var(--success-semantic)]" strokeWidth={2} />
            {(info?.authProviders ?? []).map((p) => (
              <span key={p.provider} className="rounded-md border border-border/60 bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[11px]">
                {p.provider}
              </span>
            ))}
            {(info?.authProviders?.length ?? 0) === 0 ? (
              <span className="text-[12.5px] text-[var(--success-semantic)]">{t('settings:pi.authConfigured')}</span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={2} />
            <span className="text-[12.5px] text-muted-foreground">{t('settings:pi.authNotConfigured')}</span>
          </div>
        )}
      </SettingRow>
      <SettingRow label={t('settings:pi.sessionDir')} description={t('settings:pi.sessionDirDesc')}>
        <div className="flex max-w-[280px] items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {String(ui?.sessionDir || t('settings:pi.sessionDirDefault'))}
          </span>
          {ui?.sessionDir ? (
            <button type="button" className={btnOutline} onClick={() => reveal(String(ui.sessionDir))}>
              {t('settings:pi.reveal')}
            </button>
          ) : null}
        </div>
      </SettingRow>
    </>
  )
}
