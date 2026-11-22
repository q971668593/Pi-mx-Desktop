import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, KeyRound, Loader2, ShieldCheck } from '@renderer/components/icons'
import type { ModelInfo } from '@shared/ipc-contract'
import { cn } from '@renderer/lib/utils'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { ModelAuthDialog } from './model-auth-dialog'
import { btnOutline } from './settings-controls'

interface ModelsSdkProviderSectionProps {
  providerIds: string[]
  modelsByProvider: Record<string, ModelInfo[]>
  /** Called after a login / logout wrote auth.json, so the panel can re-read auth status. */
  onAuthChanged?: () => void
}

type AuthProviderInfo = {
  providerId: string
  name: string
  oauth: { supported: boolean; loginLabel?: string; subscription?: boolean; methodName?: string }
  apiKey: { supported: boolean; methodName?: string }
}

/**
 * The active SDK's built-in providers.
 *
 * Catalog rows stay read-only, but anything that ships an OAuth login gets a sign-in /
 * sign-out button: subscription plans (ChatGPT / SuperGrok / Claude Pro…) are configured
 * here instead of being pasted as an API key into models.json.
 */
export function ModelsSdkProviderSection({
  providerIds,
  modelsByProvider,
  onAuthChanged,
}: ModelsSdkProviderSectionProps) {
  const { t } = useTranslation('settings')
  const authOf = (id: string) => modelsByProvider[id]?.find((model) => model.auth)?.auth
  const ordered = [...providerIds].sort((a, b) => Number(!!authOf(b)?.configured) - Number(!!authOf(a)?.configured))

  const [authProviders, setAuthProviders] = useState<Record<string, AuthProviderInfo>>({})
  const [authLoaded, setAuthLoaded] = useState(false)
  const [loggingIn, setLoggingIn] = useState<{ providerId: string; type: 'oauth' | 'api_key' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const loadAuthProviders = useCallback(() => {
    // 测试环境里 invoke 被 mock 成非 Promise，统一包一层避免崩。
    void Promise.resolve(ipcClient.invoke('model.auth.providers'))
      .then((result: { providers?: AuthProviderInfo[] } | undefined) => {
        const map: Record<string, AuthProviderInfo> = {}
        for (const provider of result?.providers || []) map[provider.providerId] = provider
        setAuthProviders(map)
        setAuthLoaded(true)
      })
      .catch(() => {
        setAuthProviders({})
        setAuthLoaded(true)
      })
  }, [])

  // 只有用户真的展开这一段才去问「哪些供应商支持订阅登录」——面板首次加载不额外发 IPC。
  const handleSectionToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && !authLoaded) loadAuthProviders()
  }

  // A login finished (possibly from another window): re-read auth status.
  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.type !== 'model-auth') return
        if (event.phase === 'done' || event.phase === 'cancelled' || event.phase === 'error') {
          onAuthChanged?.()
        }
      }),
    [onAuthChanged],
  )

  const logout = (providerId: string) => {
    setBusy(providerId)
    void Promise.resolve(ipcClient.invoke('model.auth.logout', { providerId }))
      .then(() => onAuthChanged?.())
      .catch(() => {})
      .finally(() => setBusy(null))
  }

  const dialogLabel = useMemo(() => {
    if (!loggingIn) return ''
    return authProviders[loggingIn.providerId]?.name || loggingIn.providerId
  }, [authProviders, loggingIn])

  return (
    <section className="settings-section" data-testid="sdk-provider-section">
      <details className="settings-card group overflow-hidden" onToggle={handleSectionToggle}>
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 transition hover:bg-[var(--bg-hover)]/50">
          <ChevronRight className="h-3 w-3 shrink-0 text-foreground-secondary transition-transform group-open:rotate-90" strokeWidth={2} />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-medium text-foreground">{t('models.sdkProvidersTitle')}</span>
            <span className="mt-0.5 block text-[11.5px] text-foreground-secondary">{t('models.sdkProvidersDescription', { count: providerIds.length })}</span>
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">{providerIds.length}</span>
        </summary>
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          {providerIds.length === 0 ? (
            <p className="px-1 py-3 text-[12px] text-foreground-secondary">{t('models.sdkProvidersEmpty')}</p>
          ) : <>
            <p className="px-1 pb-2 text-[11.5px] leading-relaxed text-foreground-secondary">{t('models.sdkProvidersHelp')}</p>
            <div className="divide-y divide-border/50">
          {ordered.map((providerId) => {
            const models = modelsByProvider[providerId]
            const auth = authOf(providerId)
            const configured = !!auth?.supported && !!auth.configured
            const info = authProviders[providerId]
            const canLogin = info?.oauth.supported === true
            const authDetail = auth?.supported
              ? auth.configured
                ? [auth.type === 'oauth' ? t('models.authTypeOAuth') : auth.type === 'api_key' ? t('models.authTypeApiKey') : null, auth.source || null]
                    .filter(Boolean)
                    .join(' · ')
                : t('models.authNotConfigured')
              : t('models.authUnavailable')

            return (
              <details key={providerId} className="group" data-sdk-provider={providerId}>
                <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-2 py-2 hover:bg-[var(--bg-hover)]/50">
                  <ChevronRight className="h-3 w-3 shrink-0 text-foreground-secondary transition-transform group-open:rotate-90" strokeWidth={2} />
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', configured ? 'bg-emerald-500/80' : 'bg-foreground/15')} />
                  <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">{providerId}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-foreground-secondary">{t('models.sdkAvailableModelCount', { count: models.length })}</span>
                  <span className={cn('ml-auto shrink-0 truncate text-[12px]', configured ? 'text-foreground' : 'text-foreground-secondary')}>{authDetail}</span>
                </summary>
                <div className="space-y-2 pb-3 pl-[2.6rem] pr-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {canLogin ? (
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={busy === providerId}
                        onClick={() => setLoggingIn({ providerId, type: 'oauth' })}
                      >
                        <ShieldCheck className="mr-1 inline h-3 w-3" strokeWidth={2} />
                        {info?.oauth.loginLabel || t('models.authSignIn')}
                        {info?.oauth.subscription ? (
                          <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">
                            {t('models.authSubscription')}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    {configured && auth?.type === 'oauth' ? (
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={busy === providerId}
                        onClick={() => logout(providerId)}
                      >
                        {busy === providerId ? (
                          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                        ) : (
                          <KeyRound className="mr-1 inline h-3 w-3" strokeWidth={2} />
                        )}
                        {t('models.authSignOut')}
                      </button>
                    ) : null}
                    {!canLogin && info?.apiKey.supported && !configured ? (
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={busy === providerId}
                        onClick={() => setLoggingIn({ providerId, type: 'api_key' })}
                      >
                        <KeyRound className="mr-1 inline h-3 w-3" strokeWidth={2} />
                        {t('models.authSignInWithKey')}
                      </button>
                    ) : null}
                    {!canLogin && !info?.apiKey.supported && !configured ? (
                      <span className="text-[11.5px] text-muted-foreground">{t('models.authNoInteractiveLogin')}</span>
                    ) : null}
                  </div>
                  <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                    {models.map((model) => (
                      <li key={model.id} className="truncate font-mono text-[11.5px] text-foreground-secondary" title={model.id}>
                        {model.id}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )
          })}
            </div>
          </>}
        </div>
      </details>

      {loggingIn ? (
        <ModelAuthDialog
          providerId={loggingIn.providerId}
          authType={loggingIn.type}
          providerLabel={dialogLabel}
          onClose={() => setLoggingIn(null)}
          onDone={() => onAuthChanged?.()}
        />
      ) : null}
    </section>
  )
}
