import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { btnDanger } from '@renderer/features/settings/settings-controls'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { Switch } from '@renderer/components/ui/switch'
import { Globe, Monitor } from '@renderer/components/icons'
import type { CapabilityInfo } from '@shared/capabilities'

export function ExtensionsSettings() {
  const { t, i18n } = useTranslation()
  const translationLanguage: 'Chinese' | 'English' = i18n.resolvedLanguage?.startsWith('zh') ? 'Chinese' : 'English'
  const translationLocale = translationLanguage === 'Chinese' ? 'zh' : 'en'
  const workspaceId = useUIStore((state) => state.currentWorkspace) || ''
  const generation = useRef(0)
  interface ExtRow {
    id: string
    name?: string
    version?: string
    source?: string
    packageSource?: string
    description?: string
    compatibility?: string
    piSync?: boolean
    piEnabled?: boolean
    enabled?: boolean
    inSettingsPackages?: boolean
    workerLoadHint?: string
    loadError?: string
    registeredTools?: string[]
    registeredCommands?: string[]
    capabilitySource?: 'static' | 'runtime'
    runtimeLoaded?: boolean
    adapterId?: string
    tuiOnly?: boolean
  }
  type MissingPkg = { entry: string; repoFolder: string }
  const [extensions, setExtensions] = useState<ExtRow[]>([])
  const [capabilities, setCapabilities] = useState<CapabilityInfo[] | null>(null)
  const [missingRuntime, setMissingRuntime] = useState<MissingPkg[]>([])
  const [syncing, setSyncing] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [installingCapability, setInstallingCapability] = useState<string | null>(null)
  const [section, setSection] = useState<'market' | 'installed' | 'capabilities'>('market')
  const [marketQuery, setMarketQuery] = useState('')
  const [marketType, setMarketType] = useState('extension')
  const [marketSort, setMarketSort] = useState('downloads')
  const [marketPackages, setMarketPackages] = useState<Array<{ name: string; description: string; author?: string; type?: string; source: string; url: string }>>([])
  const [descriptionTranslations, setDescriptionTranslations] = useState<Record<string, Partial<Record<'zh' | 'en', string>>>>({})
  const [detailTranslations, setDetailTranslations] = useState<Record<string, Partial<Record<'zh' | 'en', string>>>>({})
  const [translationMode, setTranslationMode] = useState(false)
  const [translationPending, setTranslationPending] = useState<Record<string, boolean>>({})
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketRefresh, setMarketRefresh] = useState(0)
  const [packageRows, setPackageRows] = useState<Array<{ source: string; name: string }>>([])
  const [packageSettingsPath, setPackageSettingsPath] = useState('')
  const [packageAction, setPackageAction] = useState<string | null>(null)
  const [packageUpdates, setPackageUpdates] = useState<Array<{ source: string; displayName: string; type: 'npm' | 'git'; scope: 'user' | 'project' }>>([])
  const [checkingPackageUpdates, setCheckingPackageUpdates] = useState(false)
  const [packageUpdateNotice, setPackageUpdateNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const translationJobs = useRef(new Set<string>())
  const translationCardElements = useRef(new Map<string, HTMLElement>())
  const translationErrorShown = useRef(false)
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; destructive?: boolean; run: () => void } | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<(typeof marketPackages)[number] | null>(null)
  const [packageDetails, setPackageDetails] = useState<{ version?: string; published?: string; downloads?: string; license?: string; dependencies?: string; installCommand?: string; npmUrl?: string; repositoryUrl?: string; securityNote?: string; readmeExcerpt?: string } | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const detailsRequest = useRef(0)

  const refreshPackages = useCallback(() => {
    ipcClient.invoke('extensions.packages', {}).then((res) => {
      setPackageRows(res?.packages ?? [])
      setPackageSettingsPath(res?.settingsPath ?? '')
      if (res?.error) toast.error(res.error)
    }).catch(() => toast.error(t('settings:extensions.packagesLoadFailed')))
  }, [t])

  const checkPackageUpdates = async () => {
    setCheckingPackageUpdates(true)
    setPackageUpdateNotice(null)
    try {
      const result = await ipcClient.invoke('extensions.checkPackageUpdates', {})
      if (!result?.ok) throw new Error(result?.error || t('settings:extensions.updateCheckFailed'))
      setPackageUpdates(result.updates ?? [])
      const text = result.updates?.length
        ? t('settings:extensions.updateCheckFound', { count: result.updates.length })
        : t('settings:extensions.updateCheckNone')
      setPackageUpdateNotice({ kind: 'success', text })
      toast.success(text)
    } catch (error) {
      const text = error instanceof Error ? error.message : t('settings:extensions.updateCheckFailed')
      setPackageUpdateNotice({ kind: 'error', text })
      toast.error(text)
    } finally { setCheckingPackageUpdates(false) }
  }

  const updatePackage = async (item: { name: string; source: string }) => {
    setPackageAction(item.source)
    try {
      const result = await ipcClient.invoke('extensions.updatePackage', { source: item.source })
      if (!result?.ok) throw new Error(result?.error || t('settings:extensions.updateFailed'))
      setPackageUpdates((current) => current.filter((pkg) => pkg.source !== item.source))
      if (result.warning) toast.warning(t('settings:extensions.packageReloadWarning', { message: result.warning }))
      else toast.success(t('settings:extensions.updateSuccess', { name: item.name }))
      refreshPackages()
      refreshExtensions()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings:extensions.updateFailed'))
    } finally { setPackageAction(null) }
  }

  useEffect(() => {
    let active = true
    setMarketLoading(true)
    setMarketError('')
    const timer = window.setTimeout(() => {
      ipcClient.invoke('extensions.marketplaceSearch', { query: marketQuery, type: marketType, sort: marketSort }).then((res) => {
        if (!active) return
        setMarketPackages(res?.packages ?? [])
        setMarketError(res?.error ?? '')
      }).catch((error) => {
        if (active) setMarketError(error instanceof Error ? error.message : t('settings:extensions.marketLoadFailed'))
      }).finally(() => { if (active) setMarketLoading(false) })
    }, marketQuery ? 300 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [marketQuery, marketType, marketSort, marketRefresh, t])

  const openPackageDetails = async (item: (typeof marketPackages)[number]) => {
    setSelectedPackage(item)
    setPackageDetails(null)
    setDetailsError('')
    setDetailsLoading(true)
    const request = ++detailsRequest.current
    try {
      const response = await ipcClient.invoke('extensions.packageDetails', { name: item.name })
      if (request !== detailsRequest.current) return
      setPackageDetails(response?.details ?? null)
      setDetailsError(response?.error ?? '')
    } catch (error) {
      if (request === detailsRequest.current) setDetailsError(error instanceof Error ? error.message : t('settings:extensions.detailsLoadFailed'))
    } finally {
      if (request === detailsRequest.current) setDetailsLoading(false)
    }
  }

  const closePackageDetails = useCallback(() => {
    detailsRequest.current++
    setSelectedPackage(null)
    setPackageDetails(null)
    setDetailsError('')
    setDetailsLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedPackage) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closePackageDetails() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedPackage, closePackageDetails])

  const installCapability = async (capability: 'web-search' | 'computer') => {
    setInstallingCapability(capability)
    try {
      const result = await ipcClient.invoke('extensions.installCapabilityPackage', { capability })
      if (!result?.ok) toast.error(result?.error || t('common:operationFailed'))
      else {
        if (result.warning) toast.warning(t('settings:extensions.packageReloadWarning', { message: result.warning }))
        else toast.success(result.updated ? t('settings:extensions.capabilityUpdateSuccess.computer') : t(`settings:extensions.capabilityInstallSuccess.${capability}`))
        refreshPackages()
        refreshExtensions()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common:operationFailed'))
    } finally {
      setInstallingCapability(null)
    }
  }

  const translationError = (error?: string) => {
    if (error === 'plugin_model_missing') return t('settings:extensions.translateNeedsModel')
    if (error === 'plugin_model_unavailable') return t('settings:extensions.translateModelUnavailable')
    return t('settings:extensions.translateFailed')
  }

  const translateText = async (text: string, quiet = false): Promise<string | null> => {
    const result = await ipcClient.invoke('extensions.translate', { text, targetLanguage: translationLanguage })
    if (!result?.ok || !result.text) {
      if (!quiet || !translationErrorShown.current) toast.error(translationError(result?.error))
      translationErrorShown.current = true
      return null
    }
    return result.text
  }

  const ensureDescriptionTranslation = async (item: (typeof marketPackages)[number]) => {
    const key = `${item.name}:${translationLocale}`
    if (!item.description || descriptionTranslations[key]?.[translationLocale] || translationJobs.current.has(key)) return
    translationJobs.current.add(key)
    setTranslationPending((current) => ({ ...current, [key]: true }))
    try {
      const translated = await translateText(item.description, true)
      if (translated) {
        setDescriptionTranslations((current) => ({ ...current, [key]: { ...current[key], [translationLocale]: translated } }))
      }
    } catch {
      if (!translationErrorShown.current) toast.error(translationError())
      translationErrorShown.current = true
    } finally {
      translationJobs.current.delete(key)
      setTranslationPending((current) => ({ ...current, [key]: false }))
    }
  }

  const ensureDetailsTranslation = async () => {
    if (!selectedPackage || detailsLoading) return
    const key = `${selectedPackage.name}:${translationLocale}`
    if (detailTranslations[key]?.[translationLocale] || translationJobs.current.has(`details:${key}`)) return
    const original = [selectedPackage.description, packageDetails?.readmeExcerpt, packageDetails?.securityNote].filter(Boolean).join('\n\n')
    if (!original) return
    const jobKey = `details:${key}`
    translationJobs.current.add(jobKey)
    setTranslationPending((current) => ({ ...current, [jobKey]: true }))
    try {
      const translated = await translateText(original.slice(0, 6000), true)
      if (translated) {
        setDetailTranslations((current) => ({ ...current, [key]: { ...current[key], [translationLocale]: translated } }))
      }
    } catch {
      if (!translationErrorShown.current) toast.error(translationError())
      translationErrorShown.current = true
    } finally {
      translationJobs.current.delete(jobKey)
      setTranslationPending((current) => ({ ...current, [jobKey]: false }))
    }
  }

  useEffect(() => {
    if (!translationMode || section !== 'market' || marketLoading || !marketPackages.length) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const element = entry.target as HTMLElement
        const name = element.dataset.packageName
        const item = marketPackages.find((pkg) => pkg.name === name)
        if (item) void ensureDescriptionTranslation(item)
      }
    }, { rootMargin: '120px' })
    for (const element of translationCardElements.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [translationMode, section, marketLoading, marketPackages, translationLocale])

  useEffect(() => {
    if (!translationMode || !selectedPackage || detailsLoading) return
    void ensureDetailsTranslation()
  }, [translationMode, selectedPackage, packageDetails, detailsLoading, translationLocale])

  const refreshExtensions = useCallback(() => {
    const request = ++generation.current
    ipcClient.invoke('extensions.list', { workspaceId }).then((res) => {
      if (request === generation.current) setExtensions(res?.extensions || [])
    }).catch(() => { if (request === generation.current) setExtensions([]) })
    ipcClient.invoke('extensions.missingRuntimePackages').then((res) => {
      setMissingRuntime(res?.missing || [])
    })
    ipcClient.invoke('capabilities.catalog').then((res) => {
      if (request === generation.current) setCapabilities(res?.capabilities ?? [])
    }).catch(() => { if (request === generation.current) setCapabilities([]) })
  }, [workspaceId])

  useEffect(() => {
    refreshExtensions()
    refreshPackages()
    return () => { generation.current++ }
  }, [refreshExtensions, refreshPackages])

  const executeInstall = async (item: { name: string; source: string }) => {
    setPackageAction(item.source)
    try {
      const res = await ipcClient.invoke('extensions.installPackage', { source: item.source })
      if (!res?.ok) { toast.error(res?.error || t('common:operationFailed')); refreshPackages() }
      else {
        if (res.warning) toast.warning(t('settings:extensions.packageReloadWarning', { message: res.warning }))
        else toast.success(t('settings:extensions.installSuccess', { name: item.name }))
        refreshPackages()
        refreshExtensions()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common:operationFailed'))
      refreshPackages()
    } finally { setPackageAction(null) }
  }

  const installMarketPackage = (item: { name: string; source: string }) => setConfirmAction({
    title: t('settings:extensions.installPackage'),
    message: t('settings:extensions.installConfirm', { name: item.name }),
    run: () => { void executeInstall(item) },
  })

  const executeRemovePackage = async (item: { name: string; source: string }) => {
    setPackageAction(item.source)
    try {
      const res = await ipcClient.invoke('extensions.removePackage', { source: item.source })
      if (!res?.ok) { toast.error(res?.error || t('common:operationFailed')); refreshPackages() }
      else {
        if (res.warning) toast.warning(t('settings:extensions.packageReloadWarning', { message: res.warning }))
        else toast.success(t('settings:extensions.removeSuccess', { name: item.name }))
        refreshPackages()
        refreshExtensions()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common:operationFailed'))
      refreshPackages()
    } finally { setPackageAction(null) }
  }

  const removePackage = (item: { name: string; source: string }) => setConfirmAction({
    title: t('settings:extensions.removePackage'),
    message: t('settings:extensions.removeConfirm', { name: item.name }),
    destructive: true,
    run: () => { void executeRemovePackage(item) },
  })

  const openPackageSettings = async () => {
    const res = await ipcClient.invoke('shell.openPath', { path: packageSettingsPath })
    if (!res?.ok) toast.error(res?.error || t('settings:extensions.openSettingsFailed'))
  }

  const handleToggle = async (ext: ExtRow) => {
    if (!ext.piSync) {
      toast.error(ext.inSettingsPackages === false ? t('settings:extensions.workerLoadHint') : t('settings:extensions.notSynced'))
      return
    }
    const next = !(ext.piEnabled ?? ext.enabled)
    setTogglingId(ext.id)
    try {
      const res = await ipcClient.invoke('extensions.setEnabled', { extensionId: ext.id, enabled: next })
      if (!res?.ok) {
        toast.error(res?.error || t('common:saveFailed'))
        return
      }
      toast.success(next ? t('settings:extensions.piEnabled') : t('settings:extensions.piDisabled'))
      refreshExtensions()
    } catch (e) {
      toast.error(t('common:operationFailed'))
    } finally {
      setTogglingId(null)
    }
  }

  const packageExtensions = new Map(
    extensions.filter((ext) => ext.packageSource).map((ext) => [ext.packageSource, ext]),
  )
  const localExtensions = extensions.filter((ext) => !packageRows.some((pkg) => pkg.source === ext.packageSource))
  const searchPackage = packageRows.find(({ source }) => /^(npm:pi-web-access(?:@|$)|git:github\.com\/justhil\/pi-search(?:@|$))/.test(source))
  const computerPackage = packageRows.find(({ source }) => /^npm:pi-agent-computer-use(?:@|$)/.test(source))
  const detailTranslationKey = selectedPackage ? `${selectedPackage.name}:${translationLocale}` : ''
  const activeDetailTranslation = detailTranslations[detailTranslationKey]?.[translationLocale]
  const showTranslatedDetails = translationMode && Boolean(activeDetailTranslation)

  function renderExtensionRow(key: string, name: string, ext?: ExtRow, item?: (typeof packageRows)[number]) {
    const isOn = ext?.piEnabled ?? ext?.enabled ?? false
    const canUpdate = item && packageUpdates.some((update) => update.source === item.source)
    return (
      <article key={key} className="mb-2 rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="break-all text-sm font-medium">{name}{ext?.version ? <span className="ml-2 text-xs font-normal text-muted-foreground">{ext.version}</span> : null}</h3>
            <p className="mt-1 break-all text-xs text-muted-foreground">{item?.source ?? t(ext?.source === 'project' ? 'settings:extensions.sourceProject' : 'settings:extensions.sourceGlobal')}</p>
            {ext?.loadError ? <p className="mt-1 text-xs text-destructive">{ext.loadError}</p> : null}
          </div>
          {ext?.piSync ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t(isOn ? 'settings:extensions.piEnabled' : 'settings:extensions.piDisabled')}
              <Switch checked={isOn} onCheckedChange={() => void handleToggle(ext)} disabled={togglingId === ext.id} />
            </label>
          ) : null}
          {canUpdate && item ? (
            <button type="button" disabled={packageAction !== null} onClick={() => void updatePackage(item)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
              {t(packageAction === item.source ? 'settings:extensions.updatingPackage' : 'settings:extensions.updatePackage')}
            </button>
          ) : null}
          {item ? <button type="button" disabled={packageAction !== null} onClick={() => removePackage(item)} className={btnDanger}>{t(packageAction === item.source ? 'settings:extensions.removingPackage' : 'settings:extensions.removePackage')}</button> : null}
        </div>
        {ext ? (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer hover:text-foreground">{t('settings:extensions.loadDetails')}</summary>
            <div className="mt-2 space-y-1 break-words">
              <p>{t(`settings:extensions.${ext.capabilitySource === 'runtime' ? ext.runtimeLoaded ? 'runtimeConfirmed' : 'runtimeNotLoaded' : 'staticEstimate'}`)}</p>
              {ext.description ? <p>{ext.description}</p> : null}
              {ext.registeredTools?.length ? <p className="font-mono">{ext.registeredTools.join(' · ')}</p> : null}
              {ext.registeredCommands?.length ? <p className="font-mono">{ext.registeredCommands.map((command) => `/${command}`).join(' · ')}</p> : null}
              {ext.workerLoadHint ? <p>{ext.workerLoadHint}</p> : null}
            </div>
          </details>
        ) : null}
      </article>
    )
  }

  return (
    <div className="w-full">
      <SettingsPageHeader
        title={t('settings:extensions.title')}
        description={t('settings:extensions.description')}
      />
      <div className="mb-3 flex gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
        {(['market', 'installed', 'capabilities'] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setSection(tab)} className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', section === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {t(tab === 'capabilities' ? 'settings:extensions.capabilitiesTitle' : `settings:extensions.tab.${tab}`)}{tab === 'installed' ? ` (${packageRows.length + localExtensions.length})` : ''}
          </button>
        ))}
        {section === 'market' ? <button type="button" onClick={() => { translationErrorShown.current = false; setTranslationMode((value) => !value) }} aria-pressed={translationMode} className="rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium transition hover:bg-background hover:text-foreground">
          {translationMode ? t('settings:extensions.showOriginal') : t('settings:extensions.translateTo', { language: translationLanguage === 'Chinese' ? '中文' : 'English' })}
        </button> : null}
        <button type="button" onClick={() => void ipcClient.invoke('shell.openExternal', { url: 'https://pi.dev/packages' })} className="ml-auto rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground">
          {t('settings:extensions.openOfficialMarket')} ↗
        </button>
      </div>
      {section === 'market' ? (
        <section className="mb-3 flex min-h-[300px] flex-col overflow-hidden rounded-lg border border-border/60 bg-card/40 p-3" style={{ height: 'min(70vh, calc(100dvh - 260px))' }}>
          <div className="shrink-0">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
            <label className="sr-only" htmlFor="pi-package-search">{t('settings:extensions.searchPlaceholder')}</label>
            <input id="pi-package-search" value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} placeholder={t('settings:extensions.searchPlaceholder')} className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:border-primary/50" />
            <label className="sr-only" htmlFor="pi-package-type">{t('settings:extensions.filterType')}</label>
            <select id="pi-package-type" value={marketType} onChange={(event) => setMarketType(event.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50">
              {(['all', 'extension', 'skill', 'prompt', 'theme'] as const).map((type) => <option key={type} value={type}>{t(`settings:extensions.type.${type}`)}</option>)}
            </select>
            <label className="sr-only" htmlFor="pi-package-sort">{t('settings:extensions.sortBy')}</label>
            <select id="pi-package-sort" value={marketSort} onChange={(event) => setMarketSort(event.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50">
              {(['downloads', 'recent', 'name'] as const).map((sort) => <option key={sort} value={sort}>{t(`settings:extensions.sort.${sort}`)}</option>)}
            </select>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('settings:extensions.marketHint')}</p>
          <p className="mt-1 text-2xs text-muted-foreground/70">{t('settings:extensions.translationHint')}</p>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {marketLoading ? <div className="py-8 text-center text-sm text-muted-foreground">{t('settings:extensions.marketLoading')}</div> : null}
          {!marketLoading && marketError ? <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{marketError}<button className="ml-2 underline" onClick={() => setMarketRefresh((value) => value + 1)}>{t('common:retry')}</button></div> : null}
          {!marketLoading && !marketError && marketPackages.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">{t('settings:extensions.marketEmpty')}</div> : null}
          <div className="space-y-2">
            {marketPackages.map((item) => {
              const isInstalled = packageRows.some((pkg) => pkg.source === item.source || pkg.source.replace(/@[^/]+$/, '') === item.source)
              const translationKey = `${item.name}:${translationLocale}`
              const translatedDescription = descriptionTranslations[translationKey]?.[translationLocale]
              const showTranslation = translationMode && Boolean(translatedDescription)
              return <article key={item.source} data-package-name={item.name} ref={(element) => { if (element) translationCardElements.current.set(item.name, element); else translationCardElements.current.delete(item.name) }} className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><button type="button" className="text-left text-sm font-semibold hover:text-primary" onClick={() => void openPackageDetails(item)}>{item.name}</button>{item.type ? <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{t(`settings:extensions.type.${item.type}`, { defaultValue: item.type })}</span> : null}</div>
                  <div className="mt-1 flex items-start gap-2"><p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{(showTranslation ? translatedDescription : item.description) || t('settings:extensions.noDescription')}</p>{translationMode && translationPending[translationKey] ? <span role="status" className="shrink-0 text-2xs text-muted-foreground">{t('settings:extensions.translating')}</span> : null}</div>
                  {item.author ? <div className="mt-1 text-2xs text-muted-foreground/70">{t('settings:extensions.byAuthor', { author: item.author })}</div> : null}
                </div>
                {isInstalled ? <span className="rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">{t('settings:extensions.installed')}</span> : <button type="button" disabled={packageAction !== null} onClick={() => installMarketPackage(item)} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">{packageAction === item.source ? t('settings:extensions.installingPackage') : t('settings:extensions.installPackage')}</button>}
              </article>
            })}
          </div>
          </div>
        </section>
      ) : section === 'installed' ? (
        <>
          <section className="mb-3 rounded-lg border border-border/60 bg-card/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-medium">{t('settings:extensions.packageConfigTitle')}</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{t('settings:extensions.packageConfigHint')}</p></div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={checkingPackageUpdates} onClick={() => void checkPackageUpdates()} className="rounded-md border border-border px-3 py-1.5 text-xs transition hover:bg-muted disabled:opacity-50">{checkingPackageUpdates ? t('settings:extensions.checkingUpdates') : t('settings:extensions.checkUpdates')}</button>
                <button type="button" disabled={!packageSettingsPath} onClick={() => void openPackageSettings()} className="rounded-md border border-border px-3 py-1.5 text-xs transition hover:bg-muted disabled:opacity-50">{t('settings:extensions.openPackageSettings')}</button>
              </div>
            </div>
            {packageUpdateNotice ? <p role="status" className={cn('mt-2 text-xs', packageUpdateNotice.kind === 'error' ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300')}>{packageUpdateNotice.text}</p> : null}
            {packageSettingsPath ? <div className="mt-2 truncate font-mono text-2xs text-muted-foreground/70" title={packageSettingsPath}>{packageSettingsPath}</div> : null}
          </section>
          {packageRows.length === 0 && localExtensions.length === 0 ? <div className="mb-3 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('settings:extensions.noInstalledPackages')}</div> : <div className="mb-3 space-y-2">
            {packageRows.map((item) => {
              const ext = packageExtensions.get(item.source)
              return renderExtensionRow(item.source, item.name, ext, item)
            })}
          </div>}
        </>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          {(['web-search', 'computer'] as const).map((id) => {
            const isComputer = id === 'computer'
            const Icon = isComputer ? Monitor : Globe
            const installed = isComputer ? computerPackage : searchPackage
            const capability = capabilities?.find((entry) => entry.id === id)
            const unsupported = capability?.reason === 'computer-use-platform'
            const status = unsupported ? 'unsupported' : capability?.available ? 'ready' : installed ? 'configured' : capability ? 'missing' : 'unknown'
            return (
              <article key={id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="flex-1 text-sm font-semibold">{t(`settings:extensions.capabilityName.${id}`)}</h3>
                  <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{t(`settings:extensions.capabilityStatus.${status}`)}</span>
                </div>
                <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{t(unsupported ? 'composer:tools.reasons.computer-use-platform' : `settings:extensions.capabilityHelp.${id}`)}</p>
                {installed ? (
                  <button type="button" className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => setSection('installed')}>
                    {t('settings:extensions.manageInstalled', { name: installed.name })}
                  </button>
                ) : capability && !unsupported && !capability.available ? (
                  <button type="button" className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={installingCapability !== null} onClick={() => void installCapability(id)}>
                    {t(installingCapability === id ? 'settings:extensions.installingCapability' : 'settings:extensions.installPackage')}
                  </button>
                ) : null}
              </article>
            )
          })}
        </section>
      )}
      {section === 'installed' ? <>
      {missingRuntime.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/8 p-3">
          <div className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('settings:extensions.missingRuntime')}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('settings:extensions.missingRuntimeDesc')}
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            {missingRuntime.map((m) => (
              <li key={m.entry}>· {m.repoFolder} → {m.entry}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={syncing}
            className={cn(btnDanger, 'mt-2')}
            onClick={() => {
              setSyncing(true)
              ipcClient.invoke('extensions.syncGitPackages').then((r) => {
                if (r?.added?.length) toast.success(t('settings:extensions.syncSuccess', { list: r.added.join(', ') }))
                else if (r?.error) toast.error(r.error)
                refreshExtensions()
              }).catch(() => toast.error(t('settings:extensions.syncFailed'))).finally(() => setSyncing(false))
            }}
          >
            {syncing ? t('settings:extensions.syncing') : t('settings:extensions.writePackages')}
          </button>
        </div>
      )}
      {localExtensions.map((ext) => renderExtensionRow(`${ext.source}-${ext.id}`, ext.name ?? ext.id, ext))}
      </> : null}
      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        destructive={confirmAction?.destructive}
        onConfirm={() => { const action = confirmAction; setConfirmAction(null); action?.run() }}
        onCancel={() => setConfirmAction(null)}
      />
      {selectedPackage ? createPortal(
        <div className="electron-no-drag fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePackageDetails() }}>
          <section role="dialog" aria-modal="true" aria-labelledby="pi-package-detail-title" className="overlay-panel flex max-h-[min(82vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
            <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h2 id="pi-package-detail-title" className="text-lg font-semibold">{selectedPackage.name}</h2><span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{t(`settings:extensions.type.${selectedPackage.type}`, { defaultValue: selectedPackage.type })}</span></div>
                {selectedPackage.author ? <p className="mt-1 text-xs text-muted-foreground">{t('settings:extensions.byAuthor', { author: selectedPackage.author })}</p> : null}
              </div>
              <button type="button" aria-label={t('common:close')} onClick={closePackageDetails} className="rounded-md px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">×</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{showTranslatedDetails ? activeDetailTranslation : selectedPackage.description || t('settings:extensions.noDescription')}{translationMode && !activeDetailTranslation && !detailsLoading && translationPending[`details:${detailTranslationKey}`] ? `\n\n${t('settings:extensions.translating')}` : ''}</p>
              {detailsLoading ? <div className="py-8 text-center text-sm text-muted-foreground">{t('settings:extensions.detailsLoading')}</div> : null}
              {!detailsLoading && detailsError ? <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{detailsError}<button type="button" className="ml-2 underline" onClick={() => void openPackageDetails(selectedPackage)}>{t('common:retry')}</button></div> : null}
              {!detailsLoading && packageDetails ? <>
                <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([
                    { key: 'version', value: packageDetails.version }, { key: 'published', value: packageDetails.published }, { key: 'downloads', value: packageDetails.downloads }, { key: 'license', value: packageDetails.license }, { key: 'dependencies', value: packageDetails.dependencies },
                  ] as Array<{ key: string; value?: string }>).filter((entry) => Boolean(entry.value)).map(({ key, value }) => <div key={key} className="min-w-0 rounded-md bg-muted/50 px-3 py-2"><dt className="text-2xs text-muted-foreground">{t(`settings:extensions.detailField.${key}`)}</dt><dd className="mt-1 truncate text-xs font-medium" title={value}>{value}</dd></div>)}
                </dl>
                {packageDetails.readmeExcerpt && !showTranslatedDetails ? <section className="mt-5"><h3 className="text-sm font-semibold">{t('settings:extensions.overview')}</h3><p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{packageDetails.readmeExcerpt}</p></section> : null}
                {packageDetails.securityNote && !showTranslatedDetails ? <p className="mt-4 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">{packageDetails.securityNote}</p> : null}
                {packageDetails.installCommand ? <div className="mt-4 rounded-md bg-muted/60 px-3 py-2 font-mono text-xs">{packageDetails.installCommand}</div> : null}
              </> : null}
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-5 py-3">
              <div className="flex gap-2">
                <button type="button" onClick={() => void ipcClient.invoke('shell.openExternal', { url: selectedPackage.url })} className="rounded-md border border-border px-3 py-1.5 text-xs transition hover:bg-muted">{t('settings:extensions.openCatalogDetails')}</button>
                {packageDetails?.repositoryUrl ? <button type="button" onClick={() => void ipcClient.invoke('shell.openExternal', { url: packageDetails.repositoryUrl })} className="rounded-md border border-border px-3 py-1.5 text-xs transition hover:bg-muted">{t('settings:extensions.viewSource')}</button> : null}
              </div>
              {packageRows.some((pkg) => pkg.source === selectedPackage.source || pkg.source.replace(/@[^/]+$/, '') === selectedPackage.source) ? <span className="rounded-md bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">{t('settings:extensions.installed')}</span> : <button type="button" disabled={packageAction !== null} onClick={() => installMarketPackage(selectedPackage)} className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">{packageAction === selectedPackage.source ? t('settings:extensions.installingPackage') : t('settings:extensions.installPackage')}</button>}
            </footer>
          </section>
        </div>, document.body,
      ) : null}
    </div>
  )
}

