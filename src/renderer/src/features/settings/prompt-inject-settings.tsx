import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection, Toggle } from '@renderer/features/settings/settings-page-shared'
import { btnOutline, btnPrimary, textareaCls } from '@renderer/features/settings/settings-controls'
import { cn } from '@renderer/lib/utils'

type Scope = 'global' | 'project'

type Backup = { name: string; size: number; mtime: number }

type State = {
  enabled: boolean
  text: string
  scope: Scope
  targetPath: string
  fileExists: boolean
  injected: boolean
  hasOtherContent: boolean
  backups: Backup[]
}

const EMPTY: State = {
  enabled: false,
  text: '',
  scope: 'global',
  targetPath: '',
  fileExists: false,
  injected: false,
  hasOtherContent: false,
  backups: [],
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * 提示词注入（个人版）：把一段自定义文本以标记块写进 APPEND_SYSTEM.md。
 * 只改标记块，块外内容不动，每次写入前备份，可随时还原。
 */
export function PromptInjectSettings() {
  const { t } = useTranslation()
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [state, setState] = useState<State>(EMPTY)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = (await ipcClient.invoke('promptInject.get', { workspaceId: workspace })) as { state: State }
      setState(result.state)
      setText(result.state.text)
    } catch (error) {
      console.error('promptInject.get failed', error)
    } finally {
      setLoading(false)
    }
  }, [workspace])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: { enabled?: boolean; text?: string; scope?: Scope }) => {
    setBusy(true)
    try {
      const result = (await ipcClient.invoke('promptInject.save', { workspaceId: workspace, ...patch })) as {
        state: State
      }
      setState(result.state)
      setText(result.state.text)
      toast.success(t('settings:promptInject.applied'))
    } catch (error) {
      console.error('promptInject.save failed', error)
      toast.error(t('settings:promptInject.failed'))
    } finally {
      setBusy(false)
    }
  }

  const revert = async () => {
    setBusy(true)
    try {
      const result = (await ipcClient.invoke('promptInject.revert', { workspaceId: workspace })) as { state: State }
      setState(result.state)
      setText(result.state.text)
      toast.success(t('settings:promptInject.reverted'))
    } catch (error) {
      console.error('promptInject.revert failed', error)
      toast.error(t('settings:promptInject.failed'))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (name: string) => {
    setBusy(true)
    try {
      const result = (await ipcClient.invoke('promptInject.restoreBackup', {
        workspaceId: workspace,
        name,
      })) as { state: State }
      setState(result.state)
      toast.success(t('settings:promptInject.restored'))
    } catch (error) {
      console.error('promptInject.restoreBackup failed', error)
      toast.error(t('settings:promptInject.failed'))
    } finally {
      setBusy(false)
    }
  }

  const openTarget = async () => {
    if (!state.targetPath) return
    await ipcClient.invoke('shell.showItemInFolder', { path: state.targetPath }).catch(() => {})
  }

  const scopeButton = (value: Scope) => (
    <button
      type="button"
      key={value}
      disabled={busy}
      onClick={() => void save({ scope: value })}
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-sm transition-colors disabled:opacity-40',
        state.scope === value
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent',
      )}
    >
      {t(`settings:promptInject.scope_${value}`)}
    </button>
  )

  const statusText = state.injected
    ? t('settings:promptInject.statusInjected')
    : t('settings:promptInject.statusIdle')

  return (
    <div className="space-y-1">
      <SettingsPageHeader
        title={t('settings:promptInject.title')}
        description={t('settings:promptInject.description')}
      />

      <SettingsSection title={t('settings:promptInject.sectionState')}>
        <SettingRow
          label={t('settings:promptInject.enable')}
          description={t('settings:promptInject.enableDesc')}
        >
          <Toggle
            on={state.enabled}
            disabled={busy || loading}
            onChange={(on) => void save({ enabled: on, text })}
          />
        </SettingRow>

        <SettingRow
          label={t('settings:promptInject.scope')}
          description={t('settings:promptInject.scopeDesc')}
        >
          <div className="flex items-center gap-1.5">
            {scopeButton('global')}
            {scopeButton('project')}
          </div>
        </SettingRow>

        <SettingRow label={t('settings:promptInject.target')} description={state.targetPath || '—'}>
          <div className="flex flex-col items-end gap-1">
            <button type="button" disabled={!state.targetPath} onClick={() => void openTarget()} className={btnOutline}>
              {t('settings:promptInject.reveal')}
            </button>
            <span className="text-2xs text-muted-foreground/70">{statusText}</span>
          </div>
        </SettingRow>

        {state.hasOtherContent && (
          <SettingRow
            label={t('settings:promptInject.otherContent')}
            description={t('settings:promptInject.otherContentDesc')}
          >
            <span className="text-xs text-muted-foreground">—</span>
          </SettingRow>
        )}
      </SettingsSection>

      <SettingsSection title={t('settings:promptInject.sectionText')}>
        <div className="settings-row flex flex-col gap-3 px-1 py-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            rows={12}
            placeholder={t('settings:promptInject.textPlaceholder')}
            className={cn(textareaCls, 'min-h-[12rem]')}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-2xs text-muted-foreground/70">{t('settings:promptInject.textHint')}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={() => void revert()} className={btnOutline}>
                {t('settings:promptInject.revert')}
              </button>
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => void save({ enabled: true, text })}
                className={btnPrimary}
              >
                {t('settings:promptInject.apply')}
              </button>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings:promptInject.sectionBackups')}>
        {state.backups.length === 0 ? (
          <div className="settings-row px-1 py-3 text-sm text-muted-foreground">
            {t('settings:promptInject.noBackups')}
          </div>
        ) : (
          state.backups.map((backup) => (
            <SettingRow
              key={backup.name}
              label={formatTime(backup.mtime)}
              description={`${backup.name} · ${formatSize(backup.size)}`}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void restore(backup.name)}
                className={btnOutline}
              >
                {t('settings:promptInject.restore')}
              </button>
            </SettingRow>
          ))
        )}
      </SettingsSection>
    </div>
  )
}
