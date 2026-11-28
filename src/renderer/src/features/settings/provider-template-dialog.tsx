import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, KeyRound, Plug, Search, ShieldCheck, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { PROVIDER_PRESETS, type ProviderPreset } from './model-provider-presets'
import { ProviderAvatar } from './models-settings-shared'

export type SdkAddOption = {
  providerId: string
  modelCount: number
  /** 已登录时的第二行账号/来源文案（未配置为空）。 */
  accountLabel: string
  isConfigured: boolean
}

type AuthInfo = {
  name?: string
  oauth?: { supported?: boolean; loginLabel?: string; subscription?: boolean }
  apiKey?: { supported?: boolean }
}

/**
 * 添加供应商（参考账号式大列表）：已配置 / 未配置分组、整行大卡片，
 * 右侧一键登录；最底下只留一个「添加自定义供应商」。
 */
export function ProviderTemplateDialog({
  onClose,
  onSelectCustom,
  sdkOptions,
  onLoginProvider,
}: {
  onClose: () => void
  onSelectCustom: () => void
  sdkOptions: SdkAddOption[]
  onLoginProvider: (providerId: string, type: 'oauth' | 'api_key') => void
}) {
  const { t } = useTranslation('settings')
  const titleId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [authMap, setAuthMap] = useState<Record<string, AuthInfo>>({})
  const [authFailed, setAuthFailed] = useState(false)

  // 打开即问一次「谁支持一键登录」；关掉重开会重新拉，保证状态新鲜。
  useEffect(() => {
    let alive = true
    void Promise.resolve(ipcClient.invoke('model.auth.providers'))
      .then((result: { providers?: Array<AuthInfo & { providerId: string }> } | undefined) => {
        if (!alive) return
        const map: Record<string, AuthInfo> = {}
        for (const provider of result?.providers || []) {
          if (provider?.providerId) map[provider.providerId] = provider
        }
        setAuthMap(map)
      })
      .catch(() => {
        if (alive) setAuthFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return sdkOptions
    return sdkOptions.filter((option) => {
      const name = (authMap[option.providerId]?.name || option.providerId).toLocaleLowerCase()
      return `${name} ${option.providerId}`.includes(needle)
    })
  }, [sdkOptions, query, authMap])

  const configuredList = useMemo(() => filtered.filter((o) => o.isConfigured), [filtered])
  const unconfiguredList = useMemo(() => filtered.filter((o) => !o.isConfigured), [filtered])
  // 有已配置时，未配置组默认收起，搜东西时自动展开。
  const [unconfiguredOpen, setUnconfiguredOpen] = useState(false)
  useEffect(() => {
    if (query.trim()) setUnconfiguredOpen(true)
  }, [query])
  const showUnconfiguredOpen = query.trim() ? true : unconfiguredOpen || configuredList.length === 0

  const customPreset = PROVIDER_PRESETS.find((preset) => preset.id === 'custom-openai')!

  return createPortal(
    <div
      className="overlay-backdrop electron-no-drag fixed inset-0 z-[700] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="overlay-panel flex max-h-[min(860px,calc(100dvh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border/70 px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Plug className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold text-foreground">{t('models.selectProvider')}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{t('models.providerAddHint')}</p>
            </div>
            <button type="button" aria-label={t('models.close')} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground" onClick={onClose}><X className="h-4 w-4" /></button>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('models.searchProviderPlaceholder')}
              className="settings-field-focus h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-[13px] text-foreground outline-none transition focus:border-primary"
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
          {configuredList.length ? (
            <>
              <GroupTitle label={t('models.configuredGroup', { count: configuredList.length })} />
              <div className="overflow-hidden rounded-xl border border-border/60">
                {configuredList.map((option, index) => (
                  <BuiltinRow
                    key={option.providerId}
                    option={option}
                    auth={authMap[option.providerId]}
                    authFailed={authFailed}
                    divided={index > 0}
                    onLogin={onLoginProvider}
                  />
                ))}
              </div>
            </>
          ) : null}

          {unconfiguredList.length ? (
            configuredList.length ? (
              <details
                className="group mt-3 overflow-hidden rounded-xl border border-border/60 bg-background/40"
                open={showUnconfiguredOpen}
                onToggle={(event) => {
                  if (!query.trim()) setUnconfiguredOpen(event.currentTarget.open)
                }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] transition hover:bg-accent/50">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" strokeWidth={2} />
                    <span>{t('models.unconfiguredGroup', { count: unconfiguredList.length })}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {showUnconfiguredOpen ? t('models.workbench.hideRemoteList') : t('models.unconfiguredHint')}
                  </span>
                </summary>
                <div className="border-t border-border/50">
                  {unconfiguredList.map((option, index) => (
                    <BuiltinRow
                      key={option.providerId}
                      option={option}
                      auth={authMap[option.providerId]}
                      authFailed={authFailed}
                      divided={index > 0}
                      onLogin={onLoginProvider}
                    />
                  ))}
                </div>
              </details>
            ) : (
              <>
                <GroupTitle label={t('models.unconfiguredGroup', { count: unconfiguredList.length })} />
                <div className="overflow-hidden rounded-xl border border-border/60">
                  {unconfiguredList.map((option, index) => (
                    <BuiltinRow
                      key={option.providerId}
                      option={option}
                      auth={authMap[option.providerId]}
                      authFailed={authFailed}
                      divided={index > 0}
                      onLogin={onLoginProvider}
                    />
                  ))}
                </div>
              </>
            )
          ) : null}

          {!filtered.length ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12.5px] text-muted-foreground">{t('models.noProviderTemplateMatch')}</p>
          ) : null}

          <button
            type="button"
            className="group mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-primary/35 bg-primary/[0.035] px-4 py-3.5 text-left transition hover:border-primary/65 hover:bg-primary/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={onSelectCustom}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-medium text-primary">+</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-foreground">{t('models.customProvider')}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{t('models.customProviderDescription')}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" strokeWidth={2} />
          </button>
        </div>

        <footer className="shrink-0 border-t border-border/70 px-5 py-3 text-[11.5px] text-muted-foreground sm:px-6">{t('models.providerSetupFooter')}</footer>
      </section>
    </div>,
    document.body,
  )
}

function GroupTitle({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="truncate">{label}</span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  )
}

function accentPresetOf(providerId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.defaultKey === providerId || p.id === providerId)
}

function BuiltinRow({
  option,
  auth,
  authFailed,
  divided,
  onLogin,
}: {
  option: SdkAddOption
  auth?: AuthInfo
  authFailed: boolean
  divided: boolean
  onLogin: (providerId: string, type: 'oauth' | 'api_key') => void
}) {
  const { t } = useTranslation('settings')
  const canOAuth = auth?.oauth?.supported === true
  const canKeyLogin = auth?.apiKey?.supported === true
  const loginType = canOAuth ? 'oauth' : 'api_key'
  const loginLabel = canOAuth
    ? (option.isConfigured ? t('models.reloginAction') : (auth?.oauth?.loginLabel || t('models.signInAction')))
    : (option.isConfigured ? t('models.updateKeyAction') : t('models.apiKeySignInAction'))
  const displayName = auth?.name || option.providerId

  return (
    <div
      className={cn(
        'flex items-center gap-3.5 bg-background/40 px-4 py-3 transition hover:bg-accent/50',
        divided && 'border-t border-border/50',
      )}
    >
      <span className="[&>span]:h-10 [&>span]:w-10 [&>span]:rounded-xl [&>span]:text-sm">
        <ProviderAvatar preset={accentPresetOf(option.providerId)} label={displayName} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-[14px] font-medium text-foreground">{displayName}</span>
          {auth?.oauth?.subscription === true ? (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-px text-[10.5px] font-medium text-primary">{t('models.subscriptionBadge')}</span>
          ) : null}
          {option.isConfigured ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600">
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />{t('models.providerConfigured')}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {option.accountLabel || t('models.providerNotConfigured')}
          {' · '}
          {t('models.builtinCount', { count: option.modelCount })}
        </span>
      </span>
      {canOAuth || canKeyLogin ? (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.06] px-3.5 py-1.5 text-[12px] font-medium text-primary transition hover:bg-primary hover:text-primary-foreground"
          onClick={() => onLogin(option.providerId, loginType)}
        >
          {canOAuth
            ? <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
            : <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />}
          {loginLabel}
        </button>
      ) : (
        <span className="shrink-0 text-[11px] text-muted-foreground">{authFailed ? t('models.authLoginUnavailable') : ''}</span>
      )}
    </div>
  )
}
