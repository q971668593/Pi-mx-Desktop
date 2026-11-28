import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CapabilityId, CapabilityInfo } from '@shared/capabilities'
import { Clock, Globe, Monitor, Search, SlidersHorizontal, Sparkles, Users, type AppIconComponent } from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useBrowserStore } from '@renderer/features/browser/browser-store'
import {
  capabilityKey,
  DEFAULT_CAPABILITIES,
  loadSessionCapabilities,
  onCapabilityKeyChange,
  setSessionCapability,
  setSessionBrowserMode,
  useSessionCapabilitiesStore,
  withAutoBrowserCapability,
} from '@renderer/lib/session-capabilities'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { usePaneSessionIdentity } from '@renderer/stores/pane-session-context'
import { ComposerPopover } from './composer-popover'

const ICONS: Record<CapabilityId, AppIconComponent> = { 'pi-ui': Sparkles, browser: Globe, chrome: Monitor, 'web-search': Search, computer: Monitor, 'work-team': Users }

let catalogCache: CapabilityInfo[] | null = null

type CacheWarming = 'off' | 'streaming' | 'idle'
const CACHE_MODES: CacheWarming[] = ['off', 'streaming', 'idle']

/**
 * pi's prompt cache warming (`cacheWarming` in settings.json) — the same value as Settings → Runtime,
 * here for quick access. It is global, not per session, and only applies to models that declare a
 * prompt cache lifetime.
 */
function CacheWarmingRow() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<CacheWarming | null>(null)
  useEffect(() => {
    void ipcClient
      .invoke('pi.settings.get')
      .then((res: { settings?: { cacheWarming?: string } | null }) => {
        const v = res?.settings?.cacheWarming
        setMode(CACHE_MODES.includes(v as CacheWarming) ? (v as CacheWarming) : 'streaming')
      })
      .catch(() => setMode('streaming'))
  }, [])
  const choose = (next: CacheWarming) => {
    const prev = mode
    setMode(next)
    void ipcClient
      .invoke('pi.settings.set', { patch: { cacheWarming: next } })
      .then((res: { ok?: boolean }) => {
        if (res?.ok === false) setMode(prev)
      })
      .catch(() => setMode(prev))
  }
  return (
    <div className="border-t border-border/50 pt-1" data-cache-warming={mode ?? ''}>
      <div className="px-3 pb-0.5 text-[11px] text-muted-foreground/65">{t('composer:tools.cacheWarming.group')}</div>
      <div className="flex items-start gap-2 px-3 py-1.5" title={t('composer:tools.cacheWarming.desc')}>
        <Clock className="mt-[3px] h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-foreground">{t('composer:tools.cacheWarming.name')}</div>
          <div
            role="radiogroup"
            aria-label={t('composer:tools.cacheWarming.name')}
            className="mt-1 flex gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5"
          >
            {CACHE_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={mode === null}
                onClick={() => choose(m)}
                className={cn(
                  'flex-1 whitespace-nowrap rounded-[5px] px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground',
                  mode === m && 'bg-background text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]',
                )}
              >
                {t(`composer:tools.cacheWarming.${m}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/**
 * Composer "Tools" menu: per-session capability switches. An enabled capability adds its instructions/tools from the next message
 * on; switching it off revokes its tools at once.
 */
type BrowserMode = 'off' | 'builtin' | 'chrome'

/** Which browser the agent drives in this conversation: none, the built-in panel, or the user's Chrome. */
function BrowserModeRow({ builtin, chrome, enabled, sessionFile }: { builtin: CapabilityInfo; chrome?: CapabilityInfo; enabled: CapabilityId[]; sessionFile: string | null }) {
  const { t } = useTranslation()
  const mode: BrowserMode = enabled.includes('chrome') ? 'chrome' : enabled.includes('browser') ? 'builtin' : 'off'
  const pick = (next: BrowserMode) => setSessionBrowserMode(sessionFile, next)
  // Only the choices this machine can actually switch on; the current one stays visible so it can be
  // turned off even if it just became unavailable (e.g. the Chrome extension was removed).
  const options: { id: BrowserMode; info?: CapabilityInfo }[] = (
    [
      { id: 'off' },
      { id: 'builtin', info: builtin },
      { id: 'chrome', info: chrome },
    ] as { id: BrowserMode; info?: CapabilityInfo }[]
  ).filter((o) => !o.info || o.info.available || mode === o.id || o.id === 'builtin')
  const active = mode === 'chrome' ? chrome : mode === 'builtin' ? builtin : undefined
  const cost = active
    ? [active.tools > 0 ? (active.coreTools ? t('composer:tools.toolCountDeferred', { count: active.tools, core: active.coreTools }) : t('composer:tools.toolCount', { count: active.tools })) : '', active.promptTokens > 0 ? t('composer:tools.tokens', { n: formatTokens(active.promptTokens) }) : '']
        .filter(Boolean)
        .join(' · ')
    : ''
  // The line stays a label only: cost and descriptions live in the tooltip, so a long cost string
  // can never crowd out the label or push the menu into horizontal scrolling.
  const hint = [t(`composer:tools.browserMode.desc.${mode}`), cost].filter(Boolean).join(' · ')
  return (
    <div className="min-w-0 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2" title={hint}>
        <Globe className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{t('composer:tools.browserMode.label')}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={t('composer:tools.browserMode.label')}
        className="mt-1 flex min-w-0 rounded-md border border-border/60 p-0.5"
      >
        {options.map((o) => {
          const disabled = !!o.info && !o.info.available
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={mode === o.id}
              disabled={disabled}
              title={disabled && o.info?.reason ? t(`composer:tools.reasons.${o.info.reason}`) : t(`composer:tools.browserMode.desc.${o.id}`)}
              onClick={() => pick(o.id)}
              className={cn(
                'min-w-0 flex-1 truncate whitespace-nowrap rounded px-1 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                mode === o.id ? 'bg-primary text-primary-foreground' : 'text-foreground-secondary hover:bg-[var(--bg-hover)]',
              )}
            >
              {t(`composer:tools.browserMode.${o.id}`)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ComposerToolsMenu({ disabled, running, location = 'composer' }: { disabled?: boolean; running?: boolean; location?: 'composer' | 'status' }) {
  const { t } = useTranslation()
  const paneIdentity = usePaneSessionIdentity()
  const globalSessionFile = useUIStore((s) => s.historySessionFile)
  const sessionFile = location === 'composer' ? paneIdentity.sessionFile : globalSessionFile
  const shouldTrackDraftKey = location !== 'composer' || paneIdentity.isActive
  const key = capabilityKey(sessionFile)
  const storedEnabled = useSessionCapabilitiesStore((s) => s.byKey[key])
  // Subscribe to browser tabs so auto-mounted browser capability reflects in the badge and menu.
  useBrowserStore((s) => s.tabs)
  const enabled = withAutoBrowserCapability(storedEnabled ?? DEFAULT_CAPABILITIES, key)
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CapabilityInfo[] | null>(catalogCache)
  const prevKey = useRef(key)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void loadSessionCapabilities()
  }, [])

  useEffect(() => {
    if (shouldTrackDraftKey) {
      onCapabilityKeyChange(prevKey.current, key)
    }
    prevKey.current = key
  }, [key, shouldTrackDraftKey])

  useEffect(() => {
    // Refresh on mount and whenever the menu opens.
    void ipcClient
      .invoke('capabilities.catalog')
      .then((res: { capabilities?: CapabilityInfo[] }) => {
        catalogCache = res?.capabilities ?? []
        setCatalog(catalogCache)
      })
      .catch(() => setCatalog([]))
  }, [open, running])

  const label = (id: CapabilityId) => t(`composer:tools.items.${id}.name`)
  const all = catalog ?? []
  const effectiveEnabled = enabled.filter((id) => all.some((cap) => cap.id === id && cap.available))
  const names = effectiveEnabled.map(label).join('、')
  const chrome = all.find((c) => c.id === 'chrome')
  const visible = all.filter((cap) => (cap.id === 'browser' ? cap.available || !!chrome?.available : cap.available))

  return (
    <div className="flex min-w-0 items-center">
      {/* One icon button. Enabled capabilities show as a small count (names in the tooltip
          and the menu), so turning things on never widens the toolbar. */}
      <button
        ref={triggerRef}
        type="button"
        data-composer-tools={location}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={effectiveEnabled.length ? t('composer:tools.enabledTitle', { names }) : t('composer:tools.button')}
        title={effectiveEnabled.length ? t('composer:tools.enabledTitle', { names }) : t('composer:tools.button')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          location === 'status' ? 'workbench-status-trigger' : 'composer-toolbar-btn flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-foreground-secondary/75 disabled:opacity-30',
          open && 'bg-[var(--bg-active)] text-foreground',
          effectiveEnabled.length > 0 && 'text-primary',
        )}
      >
        <SlidersHorizontal className="h-[14px] w-[14px]" />
        {effectiveEnabled.map((id) => (
          <span key={id} className="composer-capability-chip hidden" data-capability={id} />
        ))}
        {location === 'status' && <span className="hidden items-center gap-1.5 lg:flex">
          {(['work-team', 'computer', 'pi-ui', 'web-search', 'browser'] as const).map((id) => {
            const active = effectiveEnabled.includes(id) || (id === 'browser' && effectiveEnabled.includes('chrome'))
            return <span key={id} className={cn('whitespace-nowrap', active ? 'text-primary' : 'text-muted-foreground/60')}>
              {id === 'browser' ? t('composer:tools.browserMode.label') : label(id)} {active ? '●' : '○'}
            </span>
          })}
        </span>}
        {location === 'composer' && effectiveEnabled.length > 0 ? <span className="text-[11px] tabular-nums">{effectiveEnabled.length}</span> : null}
      </button>
      {open ? (
        <ComposerPopover
          anchorSelector={`[data-composer-tools="${location}"]`}
          anchorRef={triggerRef}
          align="start"
          width={280}
          label={t('composer:tools.title')}
          onClose={() => setOpen(false)}
        >
          <div className="px-3 pb-0.5 pt-2 text-[11px] text-muted-foreground/65">{t('composer:tools.title')}</div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1">
            {all.length > 0 && visible.length === 0 ? (
              <div className="px-3 py-1.5 text-[11px] leading-4 text-muted-foreground/70">{t('composer:tools.noneAvailable')}</div>
            ) : null}
            {all
              // One browser row: off / built-in / my Chrome (the two capabilities are exclusive).
              .map((cap) => {
                if (cap.id === 'chrome') return null
                if (cap.id === 'browser') {
                  return <BrowserModeRow key="browser" builtin={cap} chrome={chrome} enabled={effectiveEnabled} sessionFile={sessionFile} />
                }
                if (!cap.available && cap.id !== 'web-search') return null
                const Icon = ICONS[cap.id]
                const on = effectiveEnabled.includes(cap.id)
                const cost = [cap.tools > 0 ? (cap.coreTools ? t('composer:tools.toolCountDeferred', { count: cap.tools, core: cap.coreTools }) : t('composer:tools.toolCount', { count: cap.tools })) : '', cap.promptTokens > 0 ? t('composer:tools.tokens', { n: formatTokens(cap.promptTokens) }) : '']
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <label
                    key={cap.id}
                    title={!cap.available && cap.reason ? t(`composer:tools.reasons.${cap.reason}`) : [t(`composer:tools.items.${cap.id}.desc`), cost].filter(Boolean).join(' · ')}
                    className="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)]"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{label(cap.id)}</span>
                    <Switch
                      checked={on}
                      disabled={!cap.available}
                      aria-label={label(cap.id)}
                      onCheckedChange={(next) => {
                        if (cap.id === 'computer' && next && !window.confirm(t('composer:tools.computerConfirm'))) return
                        setSessionCapability(sessionFile, cap.id, next)
                      }}
                      className="origin-right scale-75"
                    />
                  </label>
                )
              })}
            <CacheWarmingRow />
          </div>
          <div className="border-t border-border/50 px-3 py-1.5 text-[10.5px] leading-4 text-muted-foreground/60">
            {running ? t('composer:tools.noteRunning') : t('composer:tools.note')}
          </div>
        </ComposerPopover>
      ) : null}
    </div>
  )
}
