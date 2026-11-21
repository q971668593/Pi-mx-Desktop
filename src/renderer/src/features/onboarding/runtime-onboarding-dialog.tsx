import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2, XCircle } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'

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

/**
 * 第一次启动的运行环境引导。
 *
 * 以前新用户要先自己装 node/npm，再在设置里切全局，失败时只看到「目标失败：预期 global，实际
 * builtin」这种黑话。这里把两条路摊开：内置（开箱即用）或全局（推荐，和终端共用一份 pi），
 * 选全局就当场体检 node/npm/pi，缺什么一键装，装完立刻校验。
 */
export function RuntimeOnboardingDialog() {
  const { t } = useTranslation()
  const [state, setState] = useState<Onboarding | null>(null)
  const [step, setStep] = useState<'choose' | 'env'>('choose')
  const [probe, setProbe] = useState<Probe | null>(null)
  const [probing, setProbing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void ipcClient
      .invoke('runtime.onboarding.get')
      .then((s) => alive && setState(s as Onboarding))
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

  const useGlobal = useCallback(async () => {
    setInstalling(true)
    setError(null)
    try {
      const r = (await ipcClient.invoke('sdk.switch', { target: 'global' })) as { ok?: boolean; error?: string }
      if (!r?.ok) throw new Error(r?.error || t('onboarding:globalFail'))
      await finish('global')
      toast.success(t('onboarding:globalReady'))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      void runProbe()
    } finally {
      setInstalling(false)
    }
  }, [finish, runProbe, t])

  const installGlobal = useCallback(async () => {
    setInstalling(true)
    setError(null)
    try {
      const r = (await ipcClient.invoke('sdk.installGlobalCli', {})) as { ok?: boolean; error?: string }
      if (!r?.ok) throw new Error(r?.error || t('onboarding:installFail'))
      await finish('global')
      toast.success(t('onboarding:globalReady'))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      void runProbe()
    } finally {
      setInstalling(false)
    }
  }, [finish, runProbe, t])

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

  return (
    <div className="overlay-backdrop fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" role="presentation">
      <div
        className="overlay-panel w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <h2 id="onboarding-title" className="text-[15px] font-medium">
          {t(step === 'choose' ? 'onboarding:title' : 'onboarding:envTitle')}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground-secondary">
          {t(step === 'choose' ? 'onboarding:intro' : 'onboarding:envIntro')}
        </p>

        {step === 'choose' ? (
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => {
                setStep('env')
                void runProbe()
              }}
              className="motion-lift rounded-lg border border-primary/40 bg-primary/[0.06] p-3 text-left"
            >
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {t('onboarding:globalTitle')}
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{t('onboarding:recommended')}</span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground-secondary">{t('onboarding:globalDesc')}</p>
            </button>
            <button
              type="button"
              onClick={() => void finish('builtin')}
              className="motion-press rounded-lg border border-border p-3 text-left hover:bg-muted/40"
            >
              <div className="text-[13px] font-medium">{t('onboarding:builtinTitle')}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground-secondary">{t('onboarding:builtinDesc')}</p>
            </button>
          </div>
        ) : (
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
                  disabled={installing}
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
                  disabled={installing}
                  onClick={() => void useGlobal()}
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
            <button type="button" onClick={() => void finish('builtin')} className="text-[12px] text-foreground-secondary underline-offset-2 hover:underline">
              {t('onboarding:skipToBuiltin')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
