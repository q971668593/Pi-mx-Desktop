import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Check, Loader2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { takeLastSettingsSaveError, useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { SETTINGS_COLUMN, SETTINGS_COLUMN_WIDE } from '@renderer/features/settings/settings-shell'

export function SettingsSaveBar({ wide = false }: { wide?: boolean }) {
  const { t } = useTranslation()
  const { dirty, requiresManualSave, autoSaveStatus, dirtySliceLabels, saving, discard, save } = useSettingsDraft()

  const onSave = async () => {
    const ok = await save()
    if (ok) {
      toast.success(t('common:settingsSaved'))
      window.dispatchEvent(new Event('pi-desktop:asr-config-saved'))
    } else {
      // Known refusals from the main process get their own explanation.
      const message = String((takeLastSettingsSaveError() as Error | null)?.message ?? '')
      toast.error(
        message.includes('AGENT_RUNTIME_BUSY')
          ? t('settings:runtime.switchBusy')
          : message.includes('WSL_ENV_UNAVAILABLE')
            ? t('settings:runtime.switchEnvUnavailable')
            : t('common:saveFailed'),
      )
    }
  }

  if (!requiresManualSave) {
    if (autoSaveStatus === 'idle') return null
    return (
      <div
        role="status"
        aria-live="polite"
        className="settings-autosave-pill pointer-events-none fixed bottom-5 right-6 z-40 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-popover/95 px-3 py-1.5 text-xs text-foreground shadow-lg backdrop-blur-md"
      >
        {autoSaveStatus === 'saving' ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{t('common:autoSaving')}</span>
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span>{t('common:autoSaved')}</span>
          </>
        )}
      </div>
    )
  }

  if (!dirty) return null

  return (
    <div
      className={cn(
        'settings-save-bar-enter shrink-0 border-t border-border/60 bg-[var(--surface-sidebar)]/95 px-4 py-3 backdrop-blur-sm sm:px-6',
        'shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.12)] transition-shadow duration-motion-normal',
      )}
    >
      <div className={cn('flex flex-wrap items-center justify-between gap-3', wide ? SETTINGS_COLUMN_WIDE : SETTINGS_COLUMN)}>
        <div className="min-w-0 text-sm text-muted-foreground">
          <span className="text-amber-700 dark:text-amber-400">{t('common:unsavedChanges')}</span>
          {dirtySliceLabels.length > 0 && (
            <span className="mt-0.5 block truncate text-2xs text-muted-foreground/70">
              {dirtySliceLabels.join(' · ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void discard().then(() => toast.message(t('common:reverted')))}
            className="rounded-md border border-border/50 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          >
            {t('common:discard')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSave()}
            className={cn(
              'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-motion-fast hover:opacity-90',
              saving && 'pointer-events-none opacity-50',
              !saving && 'ring-2 ring-primary/40 ring-offset-2 ring-offset-[var(--surface-sidebar)]',
            )}
          >
            {saving ? t('common:saving') : t('common:save')}
          </button>
        </div>
      </div>
    </div>
  )
}
