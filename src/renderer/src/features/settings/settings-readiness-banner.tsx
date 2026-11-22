import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { openSettingsPage } from '@renderer/lib/settings-navigation'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import {
  isAvailableModelsPending,
  peekAvailableModels,
  refreshAvailableModels,
  subscribeAvailableModels,
} from '@renderer/lib/available-models-cache'

/** Compact configuration health strip shown in General settings for one-click jumps. */
export function SettingsReadinessBanner() {
  const { t } = useTranslation()
  const { draft } = useSettingsDraft()
  const [modelCount, setModelCount] = useState(() => peekAvailableModels().length)

  useEffect(() => {
    const unsub = subscribeAvailableModels((models) => {
      setModelCount(models.length)
    })
    if (peekAvailableModels().length === 0 && !isAvailableModelsPending()) {
      void refreshAvailableModels().catch(() => {})
    }
    return unsub
  }, [])

  const modelsReady = modelCount > 0
  const dndActive =
    typeof draft.completionNotificationDndUntil === 'number' &&
    draft.completionNotificationDndUntil > Date.now()
  const notifLabel =
    dndActive || (!draft.alertSoundEnabled && !draft.alertNotificationEnabled)
      ? t('settings:readiness.notificationsOff')
      : !draft.alertNotificationEnabled && draft.alertSoundEnabled
        ? t('settings:readiness.notificationsQuiet')
        : t('settings:readiness.notificationsStandard')

  const pillCls =
    'flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-[var(--bg-2)]/45 px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bg-hover)]'

  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      aria-label={t('settings:readiness.title')}
    >
      <button
        type="button"
        onClick={() => openSettingsPage({ page: 'models' })}
        className={pillCls}
      >
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            modelsReady ? 'bg-emerald-500' : 'bg-amber-500',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {modelsReady
            ? t('settings:readiness.modelsReady', { count: modelCount })
            : t('settings:readiness.modelsMissing')}
        </span>
      </button>

      <button
        type="button"
        onClick={() => openSettingsPage({ page: 'notifications' })}
        className={pillCls}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-primary/70" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-foreground">{notifLabel}</span>
      </button>

      <button
        type="button"
        onClick={() => openSettingsPage({ page: 'pi' })}
        className={pillCls}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-foreground-secondary/45" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {t('settings:readiness.runtimeAction')}
        </span>
      </button>
    </div>
  )
}
