import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { showAppUpdateDialog } from '@renderer/lib/app-update-notify'

import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { PiSettingsPanel } from '@renderer/features/settings/pi-settings-panel'
import { AppearanceThemeEditor } from '@renderer/features/settings/appearance-theme-editor'
import { AppearanceBackground } from '@renderer/features/settings/appearance-background'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { SettingsReadinessBanner } from '@renderer/features/settings/settings-readiness-banner'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { btnOutline, numberInputCls } from '@renderer/features/settings/settings-controls'
import { setTitleFollowsLatest } from '@renderer/lib/session-title-follow'
import { Switch } from '@renderer/components/ui/switch'
import {
  Folder,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  ThemedIcon,
  type AppIconComponent,
} from '@renderer/components/icons'
import { ICON_THEMES, normalizeIconTheme, type IconTheme } from '@shared/icon-theme'
import { normalizeBackground } from '@shared/background'
import { normalizeCustomTheme } from '@shared/custom-theme'
import { normalizeTimelineMaxAutoExpandedTools, normalizeTimelineVisibleTurns } from '@shared/timeline-settings'
import { applyUiZoom, readUiZoom } from '@renderer/lib/ui-zoom'
import {
  formatShortcut,
  readShortcutBindings,
  writeShortcutBindings,
  type ShortcutId,
} from '@renderer/lib/shortcut-bindings'

function ShortcutBindingsRow() {
  const { t } = useTranslation()
  const [bindings, setBindings] = useState(readShortcutBindings)
  const [listen, setListen] = useState<ShortcutId | null>(null)
  const ids: ShortcutId[] = ['commandPalette', 'shortcuts', 'completionNotification']
  return (
    <div className="space-y-2">
      {ids.map((id) => (
        <SettingRow
          key={id}
          label={t(`common:shortcuts.${id === 'shortcuts' ? 'thisSheet' : id}`)}
          description={t('common:shortcuts.navOnly')}
        >
          <button
            type="button"
            aria-label={t(`common:shortcuts.${id === 'shortcuts' ? 'thisSheet' : id}`)}
            aria-pressed={listen === id}
            className={`${btnOutline} min-w-[120px] font-mono text-xs`}
            onClick={() => setListen(id)}
            onBlur={() => setListen(null)}
            onKeyDown={(e) => {
              if (listen !== id) return
              e.preventDefault()
              e.stopPropagation()
              if (e.key === 'Escape') { setListen(null); return }
              if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key) || e.repeat) return
              const next = {
                ...bindings,
                [id]: {
                  key: e.key.toLowerCase(),
                  ctrl: e.ctrlKey || e.metaKey,
                  meta: e.ctrlKey || e.metaKey,
                  shift: e.shiftKey,
                  alt: e.altKey,
                },
              }
              setBindings(next)
              writeShortcutBindings(next)
              setListen(null)
            }}
          >
            {listen === id ? t('common:shortcuts.listen') : <kbd>{formatShortcut(bindings[id])}</kbd>}
          </button>
        </SettingRow>
      ))}
    </div>
  )
}

export function GeneralSettings() {
  const { t } = useTranslation()
  const {
    draft,
    setAutoOpenLastProject,
    setAutoCheckRegistryUpdates,
    setIncludePrereleaseUpdates,
    setLanguage,
    setMaxSessionWorkers,
    setSessionWorkerIdleTimeoutMinutes,
  } = useSettingsDraft()
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [fixedOrder, setFixedOrder] = useState(false)
  /** 侧栏：对话名跟随最新消息（键 sessionTitleFollowsLatest，侧栏不再直接提供开关）。 */
  const [titleFollowsLatest, setTitleFollowsLatestState] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updateCheck, setUpdateCheck] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const updateCheckAttemptRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      updateCheckAttemptRef.current += 1
    }
  }, [])

  useEffect(() => {
    ipcClient.invoke('settings.get', { key: 'recentProjects' }).then((res) => {
      if (res?.settings?.recentProjects) setRecentProjects(res.settings.recentProjects)
    })
    ipcClient.invoke('settings.get', { key: 'recentProjectsFixedOrder' }).then((res) => {
      if (typeof res?.settings?.recentProjectsFixedOrder === 'boolean') {
        setFixedOrder(res.settings.recentProjectsFixedOrder)
      }
    })
    // 直接读盘上的值：模块缓存可能被别处写过，设置页显示的必须是持久化状态
    ipcClient.invoke('settings.get', { key: 'sessionTitleFollowsLatest' }).then((res) => {
      if (mountedRef.current) setTitleFollowsLatestState(res?.settings?.sessionTitleFollowsLatest === true)
    })
    ipcClient.invoke('desktop.appName').then((res) => {
      if (mountedRef.current && res?.version) setAppVersion(res.version)
    }).catch(() => {})
  }, [])

  const toggleTitleFollowsLatest = (next: boolean) => {
    setTitleFollowsLatestState(next)
    // setTitleFollowsLatest 自己会写配置、更新模块缓存并广播 settings-changed（侧栏据此重读）
    void setTitleFollowsLatest(next).catch(() => {
      if (mountedRef.current) setTitleFollowsLatestState(!next)
    })
  }

  const toggleFixedOrder = (next: boolean) => {
    setFixedOrder(next)
    void ipcClient.invoke('settings.set', { key: 'recentProjectsFixedOrder', value: next }).then(() => {
      // 通知侧栏立即按新顺序重排
      window.dispatchEvent(new CustomEvent('pi-desktop:settings-changed', { detail: { key: 'recentProjectsFixedOrder' } }))
    })
  }

  // 「检查失败」后面要说清为什么：GitHub 限流、网络不通、还是仓库没发版。
  const updateFailReasonLabel = (reason: unknown) =>
    t(`settings:general.updateFailReason_${typeof reason === 'string' && reason ? reason : 'unknown'}`)

  const handleCheckUpdate = async () => {
    const attempt = ++updateCheckAttemptRef.current
    setCheckingUpdate(true)
    setUpdateCheck(null)

    try {
      const result = await ipcClient.invoke('app.checkUpdate', {})
      if (!mountedRef.current || attempt !== updateCheckAttemptRef.current) return

      if (result.status === 'available') {
        setUpdateCheck(
          t('settings:general.updateHasNew', {
            version: result.update.latestVersion,
            current: result.update.currentVersion,
          }),
        )
        showAppUpdateDialog(result.update)
      } else if (result.status === 'up-to-date') {
        setUpdateCheck(t('settings:general.updateLatest', { version: result.latestVersion }))
      } else {
        setUpdateCheck(t('settings:general.updateCheckFailedReason', { reason: updateFailReasonLabel(result.reason) }))
      }
      setCheckingUpdate(false)
    } catch {
      if (!mountedRef.current || attempt !== updateCheckAttemptRef.current) return
      setUpdateCheck(t('settings:general.updateCheckFailedReason', { reason: updateFailReasonLabel('unknown') }))
      setCheckingUpdate(false)
    }
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={t('settings:general.title')} description={t('settings:general.description')} />

      <SettingsReadinessBanner />

      <SettingsSection title={t('settings:general.startup')}>
        <SettingRow label={t('settings:general.openLastProject')} description={t('settings:general.openLastProjectDesc')}>
          <Switch checked={draft.autoOpenLastProject} onCheckedChange={setAutoOpenLastProject} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.autoCheckUpdate')}
          description={t('settings:general.autoCheckUpdateDesc')}
        >
          <Switch checked={draft.autoCheckRegistryUpdates} onCheckedChange={setAutoCheckRegistryUpdates} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.prerelease')}
          description={t('settings:general.prereleaseDesc')}
        >
          <Switch checked={draft.includePrereleaseUpdates} onCheckedChange={setIncludePrereleaseUpdates} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.appVersion')}
          description={t('settings:general.appVersionDesc')}
          badge={
            appVersion ? (
              <span className="settings-key font-mono">
                {appVersion.startsWith('v') ? appVersion : `v${appVersion}`}
              </span>
            ) : undefined
          }
        >
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-busy={checkingUpdate}
                onClick={() => void handleCheckUpdate()}
                className={btnOutline}
              >
                {checkingUpdate ? t('settings:general.checking') : t('settings:general.checkUpdate')}
              </button>
              <button
                type="button"
                onClick={() =>
                  void ipcClient.invoke('app.openRelease', { url: 'https://github.com/q971668593/Pi-mx-Desktop' })
                }
                className={btnOutline}
                title={t('settings:general.openGitHub')}
              >
                {t('settings:general.openGitHub')}
              </button>
            </div>
            {updateCheck && (
              <span className="max-w-[220px] text-xs text-muted-foreground/70 sm:text-right">{updateCheck}</span>
            )}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:general.language')}>
        <SettingRow label={t('settings:general.language')} description={t('settings:general.languageDesc')}>
          <div className="flex gap-1.5">
            {[
              { key: 'zh' as const, label: t('settings:general.langZh') },
              { key: 'en' as const, label: t('settings:general.langEn') },
            ].map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLanguage(l.key)}
                className={cn(
                  'settings-chip rounded-md border px-2.5 py-1.5 text-sm transition-all duration-motion-fast ease-motion-ease',
                  draft.language === l.key
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('common:shortcuts.title')}>
        <ShortcutBindingsRow />
      </SettingsSection>

      <SettingsSection
        title={t('settings:general.sidebarSection')}
        description={t('settings:general.sidebarSectionDesc')}
      >
        <SettingRow
          label={t('settings:general.titleFollowsLatest')}
          description={t('settings:general.titleFollowsLatestDesc')}
          settingKey="sessionTitleFollowsLatest"
        >
          <Switch checked={titleFollowsLatest} onCheckedChange={toggleTitleFollowsLatest} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.fixedOrder')}
          description={t('settings:general.fixedOrderDesc')}
          settingKey="recentProjectsFixedOrder"
        >
          <Switch checked={fixedOrder} onCheckedChange={toggleFixedOrder} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:general.recentProjects')}>
        {recentProjects.length > 0 ? (
          <div className="space-y-1 py-3">
            {recentProjects.map((p, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-hover)]">
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                <span className="truncate font-mono text-muted-foreground">{p}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <Sparkles className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />
            <p className="mt-2 text-sm text-muted-foreground/70">{t('settings:general.noRecentProjects')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground/50">{t('settings:general.noRecentProjectsHint')}</p>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('settings:general.workersAdvanced')}
        action={
          <button
            type="button"
            className="text-xs text-muted-foreground/70 hover:text-foreground"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? t('settings:general.hideAdvanced') : t('settings:general.showAdvanced')}
          </button>
        }
      >
        {advancedOpen ? (
          <>
            <SettingRow
              label={t('settings:general.maxSessionWorkers')}
              description={t('settings:general.maxSessionWorkersDesc')}
            >
              <input
                type="number"
                min={1}
                step={1}
                value={draft.maxSessionWorkers}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  setMaxSessionWorkers(n)
                }}
                className={numberInputCls}
              />
            </SettingRow>
            <SettingRow
              label={t('settings:general.sessionWorkerIdleTimeout')}
              description={t('settings:general.sessionWorkerIdleTimeoutDesc')}
            >
              <input
                type="number"
                min={0}
                step={1}
                value={draft.sessionWorkerIdleTimeoutMinutes}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  setSessionWorkerIdleTimeoutMinutes(n)
                }}
                className={numberInputCls}
              />
            </SettingRow>
          </>
        ) : null}
      </SettingsSection>
    </div>
  )
}

export function AppearanceSettings() {
  const { t } = useTranslation()
  const {
    draft,
    setTheme,
    setIconTheme,
    setCustomTheme,
    setBackground,
    setTimelineMaxAutoExpandedTools,
    setTimelineVisibleTurns,
  } = useSettingsDraft()
  const [zoom, setZoom] = useState(readUiZoom)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const handleResetAppearance = () => {
    setTheme('system')
    setIconTheme(normalizeIconTheme(null))
    setCustomTheme(normalizeCustomTheme(null))
    setBackground(normalizeBackground(null))
    setTimelineVisibleTurns(normalizeTimelineVisibleTurns(undefined))
    setTimelineMaxAutoExpandedTools(normalizeTimelineMaxAutoExpandedTools(undefined))
    setZoom(1)
    applyUiZoom(1)
    setConfirmResetOpen(false)
    toast.success(t('settings:appearance.resetDefaultsDone'))
  }

  const themes: { key: 'light' | 'dark' | 'system'; icon: AppIconComponent }[] = [
    { key: 'light', icon: Sun },
    { key: 'dark', icon: Moon },
    { key: 'system', icon: Monitor },
  ]

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHeader
        title={t('settings:appearance.title')}
        description={t('settings:appearance.description')}
        action={
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            className={btnOutline}
          >
            {t('settings:appearance.resetDefaults')}
          </button>
        }
      />

      <ConfirmDialog
        open={confirmResetOpen}
        title={t('settings:appearance.resetDefaultsConfirmTitle')}
        message={t('settings:appearance.resetDefaultsConfirmBody')}
        confirmLabel={t('settings:appearance.resetDefaults')}
        onConfirm={handleResetAppearance}
        onCancel={() => setConfirmResetOpen(false)}
      />

      <SettingsSection title={t('settings:appearance.themeTitle')}>
        <SettingRow label={t('settings:appearance.themeLabel')} description={t('settings:appearance.themeDesc')}>
          <div className="flex flex-wrap gap-1.5">
            {themes.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={draft.theme === key}
                onClick={() => setTheme(key)}
                className={cn(
                  'settings-chip flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-all duration-motion-fast ease-motion-ease',
                  draft.theme === key
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50'
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                {t(`settings:appearance.theme${key.charAt(0).toUpperCase() + key.slice(1)}`)}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:appearance.iconThemeTitle')}>
        <SettingRow
          label={t('settings:appearance.iconThemeLabel')}
          description={t('settings:appearance.iconThemeDesc')}
        >
          <div className="flex flex-wrap gap-1.5">
            {ICON_THEMES.map((theme: IconTheme) => (
              <button
                key={theme}
                type="button"
                aria-pressed={draft.iconTheme === theme}
                onClick={() => setIconTheme(theme)}
                className={cn(
                  'settings-chip flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-all duration-motion-fast ease-motion-ease',
                  draft.iconTheme === theme
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  <ThemedIcon theme={theme} name="settings" className="h-3 w-3" />
                  <ThemedIcon theme={theme} name="terminal" className="h-3 w-3" />
                  <ThemedIcon theme={theme} name="search" className="h-3 w-3" />
                </span>
                {t(`settings:appearance.iconTheme${theme.charAt(0).toUpperCase() + theme.slice(1)}`)}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:appearance.density')}>
        <SettingRow label={t('settings:appearance.zoom')} description={t('settings:appearance.zoomDesc')}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('settings:appearance.zoom')}>
            {([0.9, 1, 1.1] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={zoom === n}
                className={cn(
                  'settings-chip rounded-md border px-2.5 py-1.5 text-sm',
                  zoom === n ? 'border-primary bg-primary/5' : 'border-border text-muted-foreground',
                )}
                onClick={() => {
                  setZoom(n)
                  applyUiZoom(n)
                }}
              >
                {Math.round(n * 100)}%
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      <AppearanceThemeEditor />
      <AppearanceBackground />

      <SettingsSection title={t('settings:appearance.timeline')}>
        <SettingRow
          label={t('settings:appearance.timelineVisibleTurns')}
          description={t('settings:appearance.timelineVisibleTurnsDesc')}
        >
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            value={draft.timelineVisibleTurns}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setTimelineVisibleTurns(n)
            }}
            className={numberInputCls}
          />
        </SettingRow>
        <SettingRow
          label={t('settings:appearance.timelineToolAutoExpandMax')}
          description={t('settings:appearance.timelineToolAutoExpandMaxDesc')}
        >
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            value={draft.timelineMaxAutoExpandedTools}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setTimelineMaxAutoExpandedTools(n)
            }}
            className={numberInputCls}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  )
}

export function PiSettings() {
  return <PiSettingsPanel />
}
