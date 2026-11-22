import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { Check, EyeOff, Inbox, Music } from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { ALERT_SOUND_PRESETS } from '@shared/alert-sound'
import { previewAlertSound } from '@renderer/lib/alert-sound'
import { AlertVolumeSlider } from '@renderer/features/settings/alert-volume-slider'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSearchContext, SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { btnOutline, numberInputCls } from '@renderer/features/settings/settings-controls'

type AlertPresetId = 'standard' | 'soundOnly' | 'dnd'

export function NotificationsSettings() {
  const { t } = useTranslation()
  const {
    draft,
    setAlertSoundEnabled,
    setAlertSoundPreset,
    setAlertSoundVolume,
    setAlertNotificationEnabled,
    setAlertOnExtensionUi,
    setAlertOnRunIdle,
    setAlertOnBackgroundRunIdle,
    setAlertOnRunFailed,
    setAiActivityGlowEnabled,
    setCompletionNotificationTimeoutSeconds,
    setCompletionNotificationPreview,
    setCompletionNotificationOnlyWhenUnfocused,
    setCompletionNotificationDndMinutes,
    setCompletionNotificationDelivery,
  } = useSettingsDraft()

  const searchQuery = useContext(SettingsSearchContext).trim().toLocaleLowerCase()
  const [rulesOpen, setRulesOpen] = useState(false)
  const [testingAlert, setTestingAlert] = useState(false)
  const [previewingGlow, setPreviewingGlow] = useState(false)
  const [glowPreviewFailed, setGlowPreviewFailed] = useState(false)
  const [alertTestFeedback, setAlertTestFeedback] = useState<'sent' | 'failed' | null>(null)

  /** Auto-expand detailed rules when a search query matches inside them. */
  const searchMatchesRules =
    !!searchQuery &&
    [
      t('settings:general.completionAlert'),
      t('settings:general.alertOnExtensionUi'),
      t('settings:general.alertOnRunIdle'),
      t('settings:general.alertOnBackgroundRunIdle'),
      t('settings:general.alertOnRunFailed'),
      t('settings:general.alertOnlyUnfocused'),
      t('settings:general.alertPreview.label'),
      t('settings:general.alertDelivery.label'),
      t('settings:general.alertTimeout'),
      t('settings:general.alertDnd.label'),
      t('settings:general.alertTest'),
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(searchQuery)

  const showRules = rulesOpen || searchMatchesRules

  const alertMode: 'both' | 'sound' | 'popup' | 'off' =
    draft.alertNotificationEnabled && draft.alertSoundEnabled
      ? 'both'
      : draft.alertNotificationEnabled
        ? 'popup'
        : draft.alertSoundEnabled
          ? 'sound'
          : 'off'

  const setAlertMode = (mode: 'both' | 'sound' | 'popup' | 'off'): void => {
    setAlertNotificationEnabled(mode === 'both' || mode === 'popup')
    setAlertSoundEnabled(mode === 'both' || mode === 'sound')
  }

  const activePreset: AlertPresetId | null =
    draft.completionNotificationDndUntil && draft.completionNotificationDndUntil > Date.now()
      ? 'dnd'
      : alertMode === 'both'
        ? 'standard'
        : alertMode === 'sound'
          ? 'soundOnly'
          : alertMode === 'off'
            ? 'dnd'
            : null

  const applyScenarioPreset = (preset: AlertPresetId): void => {
    if (preset === 'standard') {
      setAlertNotificationEnabled(true)
      setAlertSoundEnabled(true)
      setAlertOnRunIdle(true)
      setAlertOnRunFailed(true)
      setCompletionNotificationOnlyWhenUnfocused(true)
      setCompletionNotificationDndMinutes(null)
    } else if (preset === 'soundOnly') {
      setAlertNotificationEnabled(false)
      setAlertSoundEnabled(true)
      setAlertOnRunIdle(true)
      setAlertOnRunFailed(true)
      setCompletionNotificationDndMinutes(null)
      previewAlertSound(draft.alertSoundPreset, draft.alertSoundVolume)
    } else {
      setAlertNotificationEnabled(false)
      setAlertSoundEnabled(false)
      setCompletionNotificationDndMinutes(null)
    }
  }

  const handleTestAlert = async () => {
    setTestingAlert(true)
    setAlertTestFeedback(null)
    try {
      const result = await ipcClient.invoke('alerts.test', {})
      setAlertTestFeedback(result?.ok === false ? 'failed' : 'sent')
    } catch {
      setAlertTestFeedback('failed')
    } finally {
      setTestingAlert(false)
    }
  }

  const handlePreviewGlow = async () => {
    setPreviewingGlow(true)
    setGlowPreviewFailed(false)
    try {
      const result = await ipcClient.invoke('aiActivityGlow.preview', {})
      if (result?.ok === false) setGlowPreviewFailed(true)
    } catch {
      setGlowPreviewFailed(true)
    } finally {
      setPreviewingGlow(false)
    }
  }

  const presets = [
    {
      id: 'standard' as const,
      icon: Inbox,
      title: t('settings:notifications.presetStandard'),
      desc: t('settings:notifications.presetStandardDesc'),
    },
    {
      id: 'soundOnly' as const,
      icon: Music,
      title: t('settings:notifications.presetSoundOnly'),
      desc: t('settings:notifications.presetSoundOnlyDesc'),
    },
    {
      id: 'dnd' as const,
      icon: EyeOff,
      title: t('settings:notifications.presetDnd'),
      desc: t('settings:notifications.presetDndDesc'),
    },
  ]

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={t('settings:notifications.title')}
        description={t('settings:notifications.description')}
      />

      <SettingsSection
        title={t('settings:notifications.presetsTitle')}
        description={t('settings:notifications.presetsDesc')}
      >
        <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-3" role="radiogroup" aria-label={t('settings:notifications.presetsTitle')}>
          {presets.map(({ id, icon: Icon, title, desc }) => {
            const selected = activePreset === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => applyScenarioPreset(id)}
                className={cn(
                  'settings-chip group relative flex flex-col items-start gap-1.5 rounded-lg border p-3.5 text-left transition-all duration-motion-fast',
                  selected
                    ? 'border-primary bg-primary/[0.07] text-foreground shadow-sm'
                    : 'border-border/70 bg-transparent text-foreground-secondary hover:border-border hover:bg-accent/40 hover:text-foreground',
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-foreground-secondary')} />
                    {title}
                  </span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : null}
                </div>
                <p className="text-[11.5px] leading-relaxed text-foreground-secondary">{desc}</p>
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings:general.alert')} description={t('settings:general.alertSectionDesc')}>
        <SettingRow label={t('settings:general.alertMode')} description={t('settings:general.alertModeDesc')}>
          <div className="flex flex-wrap gap-1.5">
            {(['both', 'sound', 'popup', 'off'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={alertMode === mode}
                onClick={() => setAlertMode(mode)}
                className={cn(
                  'settings-chip min-h-11 rounded-md border px-3 text-sm',
                  alertMode === mode
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                {t(`settings:general.alertModeOptions.${mode}`)}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={t('settings:general.alertSoundPreset')} description={t('settings:general.alertSoundPresetDesc')}>
          <div className="flex flex-wrap items-center gap-1.5">
            {ALERT_SOUND_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={!draft.alertSoundEnabled}
                aria-pressed={draft.alertSoundPreset === preset}
                onClick={() => {
                  setAlertSoundPreset(preset)
                  previewAlertSound(preset, draft.alertSoundVolume)
                }}
                className={cn(
                  'settings-chip min-h-11 rounded-md border px-3 text-sm disabled:opacity-50',
                  draft.alertSoundPreset === preset
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                {t(`settings:general.alertSounds.${preset}`)}
              </button>
            ))}
            <button
              type="button"
              disabled={!draft.alertSoundEnabled || draft.alertSoundPreset === 'none' || draft.alertSoundVolume <= 0}
              onClick={() => previewAlertSound(draft.alertSoundPreset, draft.alertSoundVolume)}
              className={cn(btnOutline, 'min-h-11')}
            >
              {t('settings:general.alertSoundPreview')}
            </button>
          </div>
        </SettingRow>
        <SettingRow
          label={t('settings:general.alertSoundVolume')}
          description={t('settings:general.alertSoundVolumeDesc')}
        >
          <AlertVolumeSlider
            label={t('settings:general.alertSoundVolume')}
            value={draft.alertSoundVolume}
            disabled={!draft.alertSoundEnabled || draft.alertSoundPreset === 'none'}
            onChange={setAlertSoundVolume}
            onCommit={(volume) => previewAlertSound(draft.alertSoundPreset, volume)}
          />
        </SettingRow>
        {typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? (
          <p className="px-1 pb-2 text-[11px] text-muted-foreground">{t('settings:general.macNotifyHint')}</p>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t('settings:general.aiGlow')} description={t('settings:general.aiGlowDesc')}>
        <SettingRow label={t('settings:general.aiGlowEnabled')} description={t('settings:general.aiGlowEnabledDesc')}>
          <Switch checked={draft.aiActivityGlowEnabled} onCheckedChange={setAiActivityGlowEnabled} />
        </SettingRow>
        <SettingRow label={t('settings:general.aiGlowPreview')} description={t('settings:general.aiGlowPreviewDesc')}>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <button
              type="button"
              className={cn(btnOutline, 'min-h-11')}
              aria-busy={previewingGlow}
              disabled={previewingGlow}
              onClick={() => void handlePreviewGlow()}
            >
              {previewingGlow ? t('settings:general.aiGlowPreviewing') : t('settings:general.aiGlowPreviewAction')}
            </button>
            {glowPreviewFailed ? (
              <span role="status" className="text-xs text-destructive">
                {t('settings:general.aiGlowPreviewFailed')}
              </span>
            ) : null}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('settings:general.completionAlert')}
        description={t('settings:general.completionAlertDesc')}
        action={
          <button
            type="button"
            className="text-xs text-muted-foreground/80 hover:text-foreground"
            onClick={() => setRulesOpen((open) => !open)}
            aria-expanded={showRules}
          >
            {showRules ? t('settings:notifications.rulesHide') : t('settings:notifications.rulesShow')}
          </button>
        }
      >
        {showRules ? (
          <>
            <SettingRow
              label={t('settings:general.alertOnExtensionUi')}
              description={t('settings:general.alertOnExtensionUiDesc')}
            >
              <Switch checked={draft.alertOnExtensionUi} onCheckedChange={setAlertOnExtensionUi} />
            </SettingRow>
            <SettingRow label={t('settings:general.alertOnRunIdle')} description={t('settings:general.alertOnRunIdleDesc')}>
              <Switch checked={draft.alertOnRunIdle} onCheckedChange={setAlertOnRunIdle} />
            </SettingRow>
            <SettingRow
              label={t('settings:general.alertOnBackgroundRunIdle')}
              description={t('settings:general.alertOnBackgroundRunIdleDesc')}
            >
              <Switch checked={draft.alertOnBackgroundRunIdle} onCheckedChange={setAlertOnBackgroundRunIdle} />
            </SettingRow>
            <SettingRow label={t('settings:general.alertOnRunFailed')} description={t('settings:general.alertOnRunFailedDesc')}>
              <Switch checked={draft.alertOnRunFailed} onCheckedChange={setAlertOnRunFailed} />
            </SettingRow>
            <SettingRow
              label={t('settings:general.alertOnlyUnfocused')}
              description={t('settings:general.alertOnlyUnfocusedDesc')}
            >
              <Switch
                checked={draft.completionNotificationOnlyWhenUnfocused}
                onCheckedChange={setCompletionNotificationOnlyWhenUnfocused}
              />
            </SettingRow>
            <SettingRow label={t('settings:general.alertPreview.label')} description={t('settings:general.alertPreviewDesc')}>
              <div className="flex gap-1.5">
                {(['response', 'fixed'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={draft.completionNotificationPreview === mode}
                    onClick={() => setCompletionNotificationPreview(mode)}
                    className={cn(
                      'settings-chip min-h-11 rounded-md border px-3 text-sm',
                      draft.completionNotificationPreview === mode
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {t(`settings:general.alertPreview.${mode}`)}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label={t('settings:general.alertDelivery.label')} description={t('settings:general.alertDeliveryDesc')}>
              <div className="flex flex-wrap gap-1.5">
                {(['auto', 'custom', 'system'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={draft.completionNotificationDelivery === mode}
                    onClick={() => setCompletionNotificationDelivery(mode)}
                    className={cn(
                      'settings-chip min-h-11 rounded-md border px-3 text-sm',
                      draft.completionNotificationDelivery === mode
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {t(`settings:general.alertDelivery.${mode}`)}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label={t('settings:general.alertTimeout')} description={t('settings:general.alertTimeoutDesc')}>
              <input
                type="number"
                min={5}
                max={60}
                step={1}
                value={draft.completionNotificationTimeoutSeconds}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  setCompletionNotificationTimeoutSeconds(n)
                }}
                className={numberInputCls}
              />
            </SettingRow>
            <SettingRow label={t('settings:general.alertDnd.label')} description={t('settings:general.alertDndDesc')}>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { minutes: null as number | null, key: 'off' },
                  { minutes: 3, key: '3m' },
                  { minutes: 30, key: '30m' },
                  { minutes: 60, key: '1h' },
                ].map((opt) => {
                  const selected =
                    opt.minutes == null
                      ? !draft.completionNotificationDndUntil
                      : draft.completionNotificationDndUntil != null &&
                        Math.abs(draft.completionNotificationDndUntil - Date.now() - opt.minutes * 60_000) < 5_000
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setCompletionNotificationDndMinutes(opt.minutes)}
                      className={cn(
                        'settings-chip min-h-11 rounded-md border px-3 text-sm',
                        selected
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent/50',
                      )}
                    >
                      {t(`settings:general.alertDnd.${opt.key}`)}
                    </button>
                  )
                })}
              </div>
            </SettingRow>
            <SettingRow label={t('settings:general.alertTest')} description={t('settings:general.alertTestDesc')}>
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <button
                  type="button"
                  className={cn(btnOutline, 'min-h-11')}
                  aria-busy={testingAlert}
                  disabled={testingAlert}
                  onClick={() => void handleTestAlert()}
                >
                  {testingAlert ? t('settings:general.alertTesting') : t('settings:general.alertTestAction')}
                </button>
                {alertTestFeedback ? (
                  <span
                    role="status"
                    className={cn(
                      'text-xs',
                      alertTestFeedback === 'sent' ? 'text-[var(--success-semantic)]' : 'text-destructive',
                    )}
                  >
                    {alertTestFeedback === 'sent'
                      ? t('settings:general.alertTestSent')
                      : t('settings:general.alertTestFailed')}
                  </span>
                ) : null}
              </div>
            </SettingRow>
          </>
        ) : null}
      </SettingsSection>
    </div>
  )
}
