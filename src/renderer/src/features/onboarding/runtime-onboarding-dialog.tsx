import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, KeyRound, Loader2, ShieldCheck, XCircle } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { openSettingsPage } from '@renderer/lib/settings-navigation'
import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import type { ModelInfo } from '@shared/ipc-contract'

const LazyModelAuthDialog = lazy(() =>
  import('@renderer/features/settings/model-auth-dialog').then((m) => ({ default: m.ModelAuthDialog })),
)

type Probe = {
  node: boolean
  nodeVersion: string | null
  npm: boolean
  npmVersion: string | null
  pi: boolean
  piVersion: string | null
  npmGlobalRoot: string | null
  error?: string
}

type Onboarding = { done: boolean; mode: 'builtin' | 'global' | null }

type AuthProviderInfo = {
  providerId: string
  name: string
  oauth: { supported: boolean; loginLabel?: string; subscription?: boolean; methodName?: string }
  apiKey: { supported: boolean; methodName?: string }
}

const POPULAR_PROVIDER_ORDER = [
  'openai-codex',
  'openai',
  'anthropic',
  'github-copilot',
  'deepseek',
  'google',
  'openrouter',
  'xai',
  'kimi-coding',
]

/**
 * 第一次启动的两步式引导：
 * 1) 运行环境（自动静默体检本机环境；已有全局 pi 则一键接管，否则内置 pi 开箱即用）
 * 2) 若尚未配置任何可用模型，直接展示 OAuth / API Key 一键登录；已有模型则自动跳过。
 */
export function RuntimeOnboardingDialog() {
  const { t } = useTranslation()
  const [state, setState] = useState<Onboarding | null>(null)
  const [step, setStep] = useState<'choose' | 'env' | 'model'>('choose')
  const [chosenMode, setChosenMode] = useState<'builtin' | 'global'>('builtin')
  const [probe, setProbe] = useState<Probe | null>(null)
  const [probing, setProbing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [checkingModels, setCheckingModels] = useState(false)
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[]>([])
  const [loadingAuthProviders, setLoadingAuthProviders] = useState(false)
  const [authTarget, setAuthTarget] = useState<{ providerId: string; type: 'oauth' | 'api_key'; label: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void ipcClient
      .invoke('runtime.onboarding.get')
      .then((s) => {
        if (!alive) return
        const ob = s as Onboarding
        setState(ob)
        if (ob && !ob.done) {
          void ipcClient
            .invoke('runtime.probe')
            .then((p) => {
              if (alive && p && typeof (p as Probe).pi === 'boolean') setProbe(p as Probe)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const runProbe = useCallback(async () => {
    setProbing(true)
    setError(null)
    try {
      setProbe((await ipcClient.invoke('runtime.probe')) as Probe)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setProbing(false)
    }
  }, [])

  const finish = useCallback(async (mode: 'builtin' | 'global') => {
    await ipcClient.invoke('runtime.onboarding.complete', { mode }).catch(() => {})
    setState({ done: true, mode })
  }, [])

  const loadCuratedAuthProviders = useCallback(async () => {
    setLoadingAuthProviders(true)
    try {
      const res = (await ipcClient.invoke('model.auth.providers')) as { providers?: AuthProviderInfo[] } | undefined
      const all = (res?.providers ?? []).filter((p) => p.oauth?.supported || p.apiKey?.supported)
      const rank = new Map(POPULAR_PROVIDER_ORDER.map((id, i) => [id, i]))
      const curated = all
        .filter((p) => rank.has(p.providerId))
        .sort((a, b) => (rank.get(a.providerId) ?? 99) - (rank.get(b.providerId) ?? 99))
      setAuthProviders((curated.length > 0 ? curated : all).slice(0, 6))
    } catch {
      setAuthProviders([])
    } finally {
      setLoadingAuthProviders(false)
    }
  }, [])

  const proceedToModelStep = useCallback(
    async (mode: 'builtin' | 'global', readyToast?: string) => {
      setChosenMode(mode)
      setCheckingModels(true)
      try {
        const res = (await ipcClient.invoke('model.list', { scope: 'available' })) as
          | { models?: ModelInfo[] }
          | undefined
        const available = (res?.models ?? []).filter((m) => m.available)
        if (available.length > 0) {
          await finish(mode)
          toast.success(readyToast || t('onboarding:readyToChat'))
          return
        }
        setStep('model')
        void loadCuratedAuthProviders()
      } catch {
        await finish(mode)
        if (readyToast) toast.success(readyToast)
      } finally {
        setCheckingModels(false)
      }
    },
    [finish, loadCuratedAuthProviders, t],
  )

  const switchToGlobal = useCallback(async () => {
    setInstalling(true)
    setError(null)
    try {
      const r = (await ipcClient.invoke('sdk.switch', { target: 'global' })) as { ok?: boolean; error?: string }
      if (!r?.ok) throw new Error(r?.error || t('onboarding:globalFail'))
      await proceedToModelStep('global', t('onboarding:globalReady'))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setStep('env')
      void runProbe()
    } finally {
      setInstalling(false)
    }
  }, [proceedToModelStep, runProbe, t])

  const installGlobal = useCallback(async () => {
    setInstalling(true)
    setError(null)
    try {
      const r = (await ipcClient.invoke('sdk.installGlobalCli', {})) as { ok?: boolean; error?: string }
      if (!r?.ok) throw new Error(r?.error || t('onboarding:installFail'))
      await proceedToModelStep('global', t('onboarding:globalReady'))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      void runProbe()
    } finally {
      setInstalling(false)
    }
  }, [proceedToModelStep, runProbe, t])

  const handleAuthDone = useCallback(async () => {
    setAuthTarget(null)
    invalidateAvailableModels()
    prefetchAvailableModels()
    await finish(chosenMode)
    toast.success(t('onboarding:modelReady'))
  }, [chosenMode, finish, t])

  if (!state || state.done) return null

  const row = (ok: boolean, label: string, detail: string | null | undefined) => (
    <div className="flex items-center gap-2 text-[12.5px]">
      {probing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-secondary" aria-hidden />
      ) : ok ? (
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
      )}
      <span className="text-foreground">{label}</span>
      <span className="ml-auto font-mono text-[11px] text-foreground-secondary">{detail ?? '—'}</span>
    </div>
  )

  const globalInstalled = probe?.pi === true
  const preferBuiltin = probe !== null && !globalInstalled

  return (
    <div className="overlay-backdrop fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="presentation">
      <div
        className="overlay-panel w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <h2 id="onboarding-title" className="text-[15px] font-medium">
          {t(step === 'choose' ? 'onboarding:title' : step === 'env' ? 'onboarding:envTitle' : 'onboarding:modelTitle')}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground-secondary">
          {t(step === 'choose' ? 'onboarding:intro' : step === 'env' ? 'onboarding:envIntro' : 'onboarding:modelIntro')}
        </p>

        {step === 'choose' ? (
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              disabled={installing || checkingModels}
              onClick={() => {
                if (globalInstalled) {
                  void switchToGlobal()
                } else {
                  setStep('env')
                  void runProbe()
                }
              }}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
                !preferBuiltin
                  ? 'motion-lift border-primary/40 bg-primary/[0.06]'
                  : 'motion-press border-border hover:bg-muted/40',
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {t('onboarding:globalTitle')}
                {globalInstalled && probe?.piVersion ? (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                    {t('onboarding:detectedVersion', { version: probe.piVersion })}
                  </span>
                ) : !preferBuiltin ? (
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                    {t('onboarding:recommended')}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground-secondary">{t('onboarding:globalDesc')}</p>
            </button>
            <button
              type="button"
              disabled={installing || checkingModels}
              onClick={() => void proceedToModelStep('builtin')}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
                preferBuiltin
                  ? 'motion-lift border-primary/40 bg-primary/[0.06]'
                  : 'motion-press border-border hover:bg-muted/40',
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {t('onboarding:builtinTitle')}
                {preferBuiltin ? (
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                    {t('onboarding:outOfBox')}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground-secondary">{t('onboarding:builtinDesc')}</p>
            </button>
          </div>
        ) : step === 'env' ? (
          <div className="mt-4 space-y-2">
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              {row(probe?.node === true, t('onboarding:node'), probe?.nodeVersion)}
              {row(probe?.npm === true, t('onboarding:npm'), probe?.npmVersion)}
              {row(probe?.pi === true, t('onboarding:pi'), probe?.piVersion)}
              {probe?.npmGlobalRoot ? (
                <div className="truncate text-[11px] text-foreground-secondary/80" title={probe.npmGlobalRoot}>
                  {t('onboarding:npmRoot', { path: probe.npmGlobalRoot })}
                </div>
              ) : null}
            </div>
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[12px] leading-relaxed text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {probe && (!probe.node || !probe.npm) ? (
                <button
                  type="button"
                  onClick={() => void ipcClient.invoke('shell.openExternal', { url: 'https://nodejs.org/zh-cn/download' }).catch(() => {})}
                  className="rounded-md border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted"
                >
                  {t('onboarding:downloadNode')}
                </button>
              ) : null}
              {probe?.node && probe.npm && !probe.pi ? (
                <button
                  type="button"
                  disabled={installing || checkingModels}
                  onClick={() => void installGlobal()}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
                  )}
                >
                  {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  {t(installing ? 'onboarding:installing' : 'onboarding:installNow')}
                </button>
              ) : null}
              {probe?.pi ? (
                <button
                  type="button"
                  disabled={installing || checkingModels}
                  onClick={() => void switchToGlobal()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  {t('onboarding:useGlobal')}
                </button>
              ) : null}
              <button type="button" onClick={() => void runProbe()} disabled={probing} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted disabled:opacity-60">
                {t('onboarding:recheck')}
              </button>
              <button type="button" onClick={() => setStep('choose')} className="ml-auto rounded-md px-2 py-1.5 text-[12.5px] text-foreground-secondary hover:text-foreground">
                {t('onboarding:back')}
              </button>
            </div>
            <button
              type="button"
              disabled={checkingModels}
              onClick={() => void proceedToModelStep('builtin')}
              className="text-[12px] text-foreground-secondary underline-offset-2 hover:underline"
            >
              {t('onboarding:skipToBuiltin')}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {loadingAuthProviders ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 p-4 text-[12.5px] text-foreground-secondary">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                <span>{t('onboarding:modelLoading')}</span>
              </div>
            ) : authProviders.length === 0 ? (
              <p className="rounded-lg border border-border/60 p-3 text-[12px] leading-relaxed text-foreground-secondary">
                {t('onboarding:modelEmpty')}
              </p>
            ) : (
              <div className="max-h-[260px] divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60">
                {authProviders.map((provider) => (
                  <div key={provider.providerId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                        <span className="truncate">{provider.name || provider.providerId}</span>
                        {provider.oauth.subscription ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                            {t('onboarding:subscriptionTag')}
                          </span>
                        ) : null}
                      </div>
                      <span className="font-mono text-[11px] text-foreground-secondary/80">{provider.providerId}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {provider.oauth.supported ? (
                        <button
                          type="button"
                          onClick={() =>
                            setAuthTarget({
                              providerId: provider.providerId,
                              type: 'oauth',
                              label: provider.name || provider.providerId,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                          {provider.oauth.loginLabel || t('onboarding:signInOAuth')}
                        </button>
                      ) : null}
                      {provider.apiKey.supported ? (
                        <button
                          type="button"
                          onClick={() =>
                            setAuthTarget({
                              providerId: provider.providerId,
                              type: 'api_key',
                              label: provider.name || provider.providerId,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] text-foreground hover:bg-muted"
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden />
                          {t('onboarding:signInApiKey')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  void finish(chosenMode)
                  openSettingsPage({ page: 'models' })
                }}
                className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground hover:bg-muted"
              >
                {t('onboarding:openModelSettings')}
              </button>
              <button
                type="button"
                onClick={() => void finish(chosenMode)}
                className="rounded-md px-2.5 py-1.5 text-[12px] text-foreground-secondary hover:text-foreground"
              >
                {t('onboarding:skipModel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {authTarget ? (
        <Suspense fallback={null}>
          <LazyModelAuthDialog
            providerId={authTarget.providerId}
            authType={authTarget.type}
            providerLabel={authTarget.label}
            onClose={() => setAuthTarget(null)}
            onDone={() => void handleAuthDone()}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
