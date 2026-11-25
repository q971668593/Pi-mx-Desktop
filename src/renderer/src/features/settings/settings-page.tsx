import { lazy, Suspense, useCallback, useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import {
  Activity,
  Boxes,
  Brain,
  ChevronLeft,
  Cpu,
  Inbox,
  LayoutPanelLeft,
  Palette,
  Puzzle,
  Search,
  SlidersHorizontal,
  Smartphone,
  X,
  Zap,
  type AppIconComponent,
} from '@renderer/components/icons'
import {
  SettingsMain,
  SettingsNav,
  SettingsNavGroup,
  SettingsNavItem,
} from '@renderer/features/settings/settings-shell'
import { SettingsDraftProvider } from '@renderer/features/settings/settings-draft-context'
import { SettingsSaveBar } from '@renderer/features/settings/settings-save-bar'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'
import { SettingsSearchContext } from './settings-page-shared'
import {
  consumePendingSettingsRoute,
  OPEN_SETTINGS_PAGE_EVENT,
  type SettingsRouteTarget,
} from '@renderer/lib/settings-navigation'

const ExtensionConfigSubpage = lazy(() =>
  import('@renderer/features/extension-ui/extension-config-subpage').then((m) => ({ default: m.ExtensionConfigSubpage })),
)
const NotificationsSettings = lazy(() =>
  import('@renderer/features/settings/notifications-settings').then((m) => ({ default: m.NotificationsSettings })),
)
const ModelsSettingsPanel = lazy(() =>
  import('@renderer/features/settings/models-settings-panel').then((m) => ({ default: m.ModelsSettingsPanel })),
)
const ImageGenSettingsPage = lazy(() =>
  import('@renderer/features/settings/image-gen-settings-page').then((m) => ({ default: m.ImageGenSettingsPage })),
)
const SkillsSettingsPanel = lazy(() =>
  import('@renderer/features/settings/skills-settings-panel').then((m) => ({ default: m.SkillsSettingsPanel })),
)
const McpSettingsPanel = lazy(() =>
  import('@renderer/features/settings/mcp-settings-panel').then((m) => ({ default: m.McpSettingsPanel })),
)
const ModelRoutingPanel = lazy(() =>
  import('@renderer/features/settings/model-routing-panel').then((m) => ({ default: m.ModelRoutingPanel })),
)
const PromptsSettingsPanel = lazy(() =>
  import('@renderer/features/settings/prompts-settings-panel').then((m) => ({ default: m.PromptsSettingsPanel })),
)
const RightPanelsSettings = lazy(() =>
  import('@renderer/features/settings/right-panels-settings').then((m) => ({ default: m.RightPanelsSettings })),
)
const PromptInjectSettings = lazy(() =>
  import('@renderer/features/settings/prompt-inject-settings').then((m) => ({ default: m.PromptInjectSettings })),
)
const VoiceSettingsPanel = lazy(() =>
  import('@renderer/features/settings/voice-settings-panel').then((m) => ({ default: m.VoiceSettingsPanel })),
)
const MobileSettingsPanel = lazy(() =>
  import('@renderer/features/settings/mobile-settings-panel').then((m) => ({ default: m.MobileSettingsPanel })),
)
const UsageSettingsPanel = lazy(() =>
  import('@renderer/features/settings/usage-settings-panel').then((m) => ({ default: m.UsageSettingsPanel })),
)
const GeneralSettings = lazy(() =>
  import('@renderer/features/settings/settings-general-appearance').then((m) => ({ default: m.GeneralSettings })),
)
const AppearanceSettings = lazy(() =>
  import('@renderer/features/settings/settings-general-appearance').then((m) => ({ default: m.AppearanceSettings })),
)
const PiSettings = lazy(() =>
  import('@renderer/features/settings/settings-general-appearance').then((m) => ({ default: m.PiSettings })),
)
const RuntimeSettingsPage = lazy(() =>
  import('@renderer/features/settings/runtime-settings-panel').then((m) => ({ default: m.RuntimeSettingsPage })),
)
const ExtensionsSettings = lazy(() =>
  import('@renderer/features/settings/settings-extensions-panel').then((m) => ({ default: m.ExtensionsSettings })),
)
const AdaptersSettings = lazy(() =>
  import('@renderer/features/settings/settings-adapters-panel').then((m) => ({ default: m.AdaptersSettings })),
)
const PurgeSettings = lazy(() =>
  import('@renderer/features/settings/purge-settings-panel').then((m) => ({ default: m.PurgeSettings })),
)
const LessonSettingsPanel = lazy(() =>
  import('@renderer/features/settings/lesson-settings-panel').then((m) => ({ default: m.LessonSettingsPanel })),
)

type SettingsPageId =
  | 'general'
  | 'notifications'
  | 'lessons'
  | 'appearance'
  | 'models'
  | 'resources'
  | 'pi'
  | 'purge'
  | 'rightPanels'
  | 'mobile'
  | 'usage'

type ModelsTab = 'models' | 'imageGen' | 'routing' | 'voice'
type ResourcesTab = 'skills' | 'prompts' | 'promptInject' | 'extensions' | 'mcp' | 'adapters'
type PiTab = 'pi' | 'runtimeEnv'

type NavGroup = {
  key: string
  labelKey: string
  pages: { key: SettingsPageId; icon: AppIconComponent }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'common',
    labelKey: 'settings:nav.groupCommon',
    pages: [
      { key: 'general', icon: SlidersHorizontal },
      { key: 'lessons', icon: Brain },
      { key: 'notifications', icon: Inbox },
      { key: 'appearance', icon: Palette },
      { key: 'models', icon: Boxes },
    ],
  },
  {
    key: 'capabilities',
    labelKey: 'settings:nav.groupCapabilities',
    pages: [
      { key: 'resources', icon: Puzzle },
      { key: 'pi', icon: Cpu },
      { key: 'purge', icon: Zap },
    ],
  },
  {
    key: 'workspace',
    labelKey: 'settings:nav.groupWorkspace',
    pages: [
      { key: 'rightPanels', icon: LayoutPanelLeft },
      { key: 'mobile', icon: Smartphone },
      { key: 'usage', icon: Activity },
    ],
  },
]

const WIDE_PAGES: SettingsPageId[] = ['rightPanels', 'pi', 'purge', 'models', 'resources']

const MODELS_TABS: { key: ModelsTab; labelKey: string; searchNamespaces: string[] }[] = [
  { key: 'models', labelKey: 'settings:nav.modelsTab', searchNamespaces: ['models'] },
  { key: 'imageGen', labelKey: 'settings:nav.imageGen', searchNamespaces: ['imageGen'] },
  { key: 'routing', labelKey: 'settings:nav.routing', searchNamespaces: ['routing'] },
  { key: 'voice', labelKey: 'settings:nav.voice', searchNamespaces: ['voice'] },
]

const RESOURCES_TABS: { key: ResourcesTab; labelKey: string; searchNamespaces: string[] }[] = [
  { key: 'skills', labelKey: 'settings:nav.skills', searchNamespaces: ['skills'] },
  { key: 'prompts', labelKey: 'settings:nav.prompts', searchNamespaces: ['prompts'] },
  { key: 'promptInject', labelKey: 'settings:nav.promptInject', searchNamespaces: ['promptInject'] },
  { key: 'extensions', labelKey: 'settings:nav.extensions', searchNamespaces: ['extensions'] },
  { key: 'mcp', labelKey: 'settings:nav.mcp', searchNamespaces: ['mcp'] },
  { key: 'adapters', labelKey: 'settings:nav.adapters', searchNamespaces: ['adapters'] },
]

const PI_TABS: { key: PiTab; labelKey: string; searchNamespaces: string[] }[] = [
  { key: 'pi', labelKey: 'settings:nav.piTab', searchNamespaces: ['pi'] },
  { key: 'runtimeEnv', labelKey: 'settings:nav.runtimeEnv', searchNamespaces: ['runtime', 'python'] },
]

function SettingsPanelSkeleton() {
  return (
    <div className="space-y-6 py-1" aria-busy="true">
      <div className="space-y-2">
        <div className="h-6 w-36 animate-pulse rounded-md bg-[var(--bg-2)]" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-[var(--bg-2)]/70" />
      </div>
      <div className="settings-card space-y-3 p-4">
        <div className="h-10 animate-pulse rounded-md bg-[var(--bg-2)]/60" />
        <div className="h-10 animate-pulse rounded-md bg-[var(--bg-2)]/60" />
        <div className="h-10 animate-pulse rounded-md bg-[var(--bg-2)]/50" />
      </div>
    </div>
  )
}

function SettingsSubTabs<T extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: {
  tabs: { key: T; label: string }[]
  active: T
  onSelect: (tab: T) => void
  ariaLabel: string
}) {
  return (
    <div className="settings-subtabs mb-6 flex flex-wrap gap-1 rounded-xl border border-border/50 bg-[var(--bg-1)]/70 p-1" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.key)}
            className={cn(
              'settings-subtab rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all duration-motion-fast',
              selected
                ? 'bg-[var(--bg-base)] text-foreground shadow-sm ring-1 ring-border/60'
                : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState<SettingsPageId>('general')
  const [modelsTab, setModelsTab] = useState<ModelsTab>('models')
  const [resourcesTab, setResourcesTab] = useState<ResourcesTab>('skills')
  const [piTab, setPiTab] = useState<PiTab>('pi')
  const [settingsQuery, setSettingsQuery] = useState('')
  const [configExt, setConfigExt] = useState<string | null>(null)
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

  const applyRouteTarget = useCallback((target: SettingsRouteTarget | null) => {
    if (!target?.page) return
    setConfigExt(null)
    const reqPage = target.page
    const reqTab = target.tab
    if (reqPage === 'models' || reqPage === 'imageGen' || reqPage === 'routing' || reqPage === 'voice') {
      setPage('models')
      const resolved = reqPage === 'models' ? (reqTab as ModelsTab | undefined) : reqPage
      if (resolved && MODELS_TABS.some((x) => x.key === resolved)) setModelsTab(resolved)
      return
    }
    if (
      reqPage === 'resources' ||
      reqPage === 'skills' ||
      reqPage === 'prompts' ||
      reqPage === 'promptInject' ||
      reqPage === 'extensions' ||
      reqPage === 'mcp' ||
      reqPage === 'adapters'
    ) {
      setPage('resources')
      const resolved = reqPage === 'resources' ? (reqTab as ResourcesTab | undefined) : reqPage
      if (resolved && RESOURCES_TABS.some((x) => x.key === resolved)) setResourcesTab(resolved)
      return
    }
    if (reqPage === 'purge' || (reqPage === 'pi' && reqTab === 'purge')) {
      setPage('purge')
      return
    }
    if (reqPage === 'pi' || reqPage === 'runtimeEnv') {
      setPage('pi')
      const resolved = reqPage === 'pi' ? (reqTab as PiTab | undefined) : reqPage
      if (resolved && PI_TABS.some((x) => x.key === resolved)) setPiTab(resolved)
      return
    }
    if (
      reqPage === 'general' ||
      reqPage === 'notifications' ||
      reqPage === 'appearance' ||
      reqPage === 'rightPanels' ||
      reqPage === 'mobile' ||
      reqPage === 'usage'
    ) {
      setPage(reqPage)
    }
  }, [])

  // 外置 adapter.json 可能在设置外被修改；进入设置时刷新 Main 缓存与右栏目录
  useEffect(() => {
    invalidateRightPanelCatalog()
    void ipcClient.invoke('adapters.json.catalog', { refresh: true, workspaceId: useUIStore.getState().currentWorkspace || '' }).catch(() => {})
    applyRouteTarget(consumePendingSettingsRoute())
  }, [applyRouteTarget])

  useEffect(() => {
    const onOpenRoute = (event: Event) => {
      const detail = (event as CustomEvent<SettingsRouteTarget | undefined>).detail
      if (detail) {
        consumePendingSettingsRoute()
        applyRouteTarget(detail)
      }
    }
    window.addEventListener(OPEN_SETTINGS_PAGE_EVENT, onOpenRoute)
    return () => window.removeEventListener(OPEN_SETTINGS_PAGE_EVENT, onOpenRoute)
  }, [applyRouteTarget])

  // B-layer slash config-page routing -> open embedded config subpage
  useEffect(() => {
    if (pendingExtensionConfig) {
      setConfigExt(pendingExtensionConfig)
      setPage('resources')
      setResourcesTab('adapters')
      requestExtensionConfig(null)
    }
  }, [pendingExtensionConfig, requestExtensionConfig])

  const searchTextForTab = useCallback(
    (tabKey: string, labelKey: string, namespaces: string[]) =>
      `${tabKey} ${t(labelKey)} ${namespaces.map((ns) => JSON.stringify(t(`settings:${ns}`, { returnObjects: true }))).join(' ')}`.toLocaleLowerCase(),
    [t],
  )

  const searchTextForPage = useCallback(
    (key: SettingsPageId): string => {
      if (key === 'general') {
        return `${key} ${t('settings:nav.general')} ${JSON.stringify(t('settings:general', { returnObjects: true }))} ${JSON.stringify(t('common:shortcuts', { returnObjects: true }))}`.toLocaleLowerCase()
      }
      if (key === 'notifications') {
        return `${key} ${t('settings:nav.notifications')} ${JSON.stringify(t('settings:notifications', { returnObjects: true }))} ${JSON.stringify(t('settings:general', { returnObjects: true }))}`.toLocaleLowerCase()
      }
      if (key === 'models') {
        return [key, t('settings:nav.models'), ...MODELS_TABS.map((tab) => searchTextForTab(tab.key, tab.labelKey, tab.searchNamespaces))].join(' ').toLocaleLowerCase()
      }
      if (key === 'resources') {
        return [key, t('settings:nav.resources'), ...RESOURCES_TABS.map((tab) => searchTextForTab(tab.key, tab.labelKey, tab.searchNamespaces))].join(' ').toLocaleLowerCase()
      }
      if (key === 'pi') {
        return [key, t('settings:nav.pi'), ...PI_TABS.map((tab) => searchTextForTab(tab.key, tab.labelKey, tab.searchNamespaces))].join(' ').toLocaleLowerCase()
      }
      return `${key} ${t(`settings:nav.${key}`)} ${JSON.stringify(t(`settings:${key}`, { returnObjects: true }))}`.toLocaleLowerCase()
    },
    [t, searchTextForTab],
  )

  const wide = WIDE_PAGES.includes(page)
  const filteredGroups = useMemo(() => {
    const query = settingsQuery.trim().toLocaleLowerCase()
    return NAV_GROUPS.map((group) => ({
      ...group,
      pages: group.pages.filter((item) => (!query ? true : searchTextForPage(item.key).includes(query))),
    })).filter((group) => group.pages.length > 0)
  }, [settingsQuery, searchTextForPage])

  const pages = filteredGroups.flatMap((group) => group.pages)
  const selectedVisible = pages.some((item) => item.key === page)
  const firstMatch = pages[0]?.key
  useEffect(() => {
    if (!selectedVisible && firstMatch) setPage(firstMatch)
  }, [selectedVisible, firstMatch])

  // Auto-switch to the matching sub-tab when searching inside a tabbed category.
  useEffect(() => {
    const query = settingsQuery.trim().toLocaleLowerCase()
    if (!query) return
    if (page === 'models') {
      const current = MODELS_TABS.find((tab) => tab.key === modelsTab)
      if (!current || !searchTextForTab(current.key, current.labelKey, current.searchNamespaces).includes(query)) {
        const hit = MODELS_TABS.find((tab) => searchTextForTab(tab.key, tab.labelKey, tab.searchNamespaces).includes(query))
        if (hit) setModelsTab(hit.key)
      }
    } else if (page === 'resources') {
      const current = RESOURCES_TABS.find((tab) => tab.key === resourcesTab)
      if (!current || !searchTextForTab(current.key, current.labelKey, current.searchNamespaces).includes(query)) {
        const hit = RESOURCES_TABS.find((tab) => searchTextForTab(tab.key, tab.labelKey, tab.searchNamespaces).includes(query))
        if (hit) setResourcesTab(hit.key)
      }
    } else if (page === 'pi') {
      const current = PI_TABS.find((tab) => tab.key === piTab)
      if (!current || !searchTextForTab(current.key, current.labelKey, current.searchNamespaces).includes(query)) {
        const hit = PI_TABS.find((tab) => searchTextForTab(tab.key, tab.labelKey, tab.searchNamespaces).includes(query))
        if (hit) setPiTab(hit.key)
      }
    }
  }, [settingsQuery, page, modelsTab, resourcesTab, piTab, searchTextForTab])

  const activePageKey =
    page === 'models'
      ? `models:${modelsTab}`
      : page === 'resources'
        ? `resources:${resourcesTab}`
        : page === 'pi'
          ? `pi:${piTab}`
          : page

  return (
    <SettingsDraftProvider>
      <SettingsSearchContext.Provider value={settingsQuery}>
      <div className="settings-layout flex h-full min-h-0 w-full overflow-hidden">
        <SettingsNav title={t('settings:title')}>
          <div className="workbench-search mx-1">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <input type="search" value={settingsQuery} aria-label={t('settings:search')} placeholder={t('settings:search')} onChange={(event) => { setSettingsQuery(event.target.value); setConfigExt(null) }} />
            {settingsQuery && <button type="button" className="workbench-icon" aria-label={t('common:sidebar.clearSearch')} onClick={() => setSettingsQuery('')}><X className="h-3.5 w-3.5" /></button>}
          </div>
          {filteredGroups.map((group) => (
            <SettingsNavGroup key={group.key} label={t(group.labelKey)}>
              {group.pages.map((p) => (
                <SettingsNavItem
                  key={p.key}
                  active={page === p.key}
                  icon={p.icon}
                  label={t(`settings:nav.${p.key}`)}
                  onClick={() => {
                    setConfigExt(null)
                    setPage(p.key)
                  }}
                />
              ))}
            </SettingsNavGroup>
          ))}
        </SettingsNav>

        {configExt ? (
          // 适配器配置子页：仍不进草稿、不挂保存栏，仅在主区替换内容
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-[var(--bg-base)] px-4 py-2.5">
              <button
                type="button"
                onClick={() => setConfigExt(null)}
                className="electron-no-drag chrome-icon-btn flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" strokeWidth={2} />
                {t('settings:adapters.backToAdapters')}
              </button>
              <span className="text-base font-medium">{t('settings:adapters.configTitle', { id: configExt })}</span>
            </div>
            <SettingsMain wide pageKey={`ext:${configExt}`}>
              <Suspense fallback={<SettingsPanelSkeleton />}>
                <ExtensionConfigSubpage extensionId={configExt} />
              </Suspense>
            </SettingsMain>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {settingsQuery.trim() && <div className="settings-search-summary flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-2 text-xs text-foreground-secondary"><span role="status">{t('settings:searchResults', { count: pages.length })}</span><button type="button" className="workbench-button" onClick={() => setSettingsQuery('')}>{t('common:sidebar.clearSearch')}</button></div>}
          <SettingsMain wide={wide} pageKey={activePageKey} footer={<SettingsSaveBar wide={wide} />}>
            {pages.length === 0 ? <div className="workbench-empty"><Search className="h-6 w-6 opacity-50" /><p>{t('settings:noSearchResults')}</p><span>{t('settings:searchHint')}</span></div> : <Suspense fallback={<SettingsPanelSkeleton />}>
            {page === 'general' && <GeneralSettings />}
            {page === 'lessons' && <LessonSettingsPanel />}
            {page === 'notifications' && <NotificationsSettings />}
            {page === 'appearance' && <AppearanceSettings />}
            {page === 'models' && (
              <>
                <SettingsSubTabs
                  ariaLabel={t('settings:nav.models')}
                  tabs={MODELS_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
                  active={modelsTab}
                  onSelect={setModelsTab}
                />
                {modelsTab === 'models' && <ModelsSettingsPanel />}
                {modelsTab === 'imageGen' && <ImageGenSettingsPage />}
                {modelsTab === 'routing' && <ModelRoutingPanel />}
                {modelsTab === 'voice' && <VoiceSettingsPanel />}
              </>
            )}
            {page === 'resources' && (
              <>
                <SettingsSubTabs
                  ariaLabel={t('settings:nav.resources')}
                  tabs={RESOURCES_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
                  active={resourcesTab}
                  onSelect={setResourcesTab}
                />
                {resourcesTab === 'skills' && <SkillsSettingsPanel />}
                {resourcesTab === 'prompts' && <PromptsSettingsPanel />}
                {resourcesTab === 'promptInject' && <PromptInjectSettings />}
                {resourcesTab === 'extensions' && <ExtensionsSettings />}
                {resourcesTab === 'mcp' && <McpSettingsPanel />}
                {resourcesTab === 'adapters' && <AdaptersSettings />}
              </>
            )}
            {page === 'pi' && (
              <>
                <SettingsSubTabs
                  ariaLabel={t('settings:nav.pi')}
                  tabs={PI_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
                  active={piTab}
                  onSelect={setPiTab}
                />
                {piTab === 'pi' && <PiSettings />}
                {piTab === 'runtimeEnv' && <RuntimeSettingsPage />}
              </>
            )}
            {page === 'purge' && <PurgeSettings />}
            {page === 'rightPanels' && <RightPanelsSettings />}
            {page === 'mobile' && <MobileSettingsPanel />}
            {page === 'usage' && <UsageSettingsPanel />}
            </Suspense>}
          </SettingsMain>
          </div>
        )}
      </div>
      </SettingsSearchContext.Provider>
    </SettingsDraftProvider>
  )
}
