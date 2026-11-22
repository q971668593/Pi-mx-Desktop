import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink, Loader2, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { btnOutline, btnPrimary } from './settings-controls'
import type { ModelAuthNotice, ModelAuthPrompt } from '@shared/app-events'

type Phase = 'waiting' | 'prompt' | 'notice' | 'done' | 'error' | 'cancelled'

/**
 * 订阅登录弹窗。
 *
 * 真正的 OAuth 流程在主进程里跑（凭据由 SDK 写进 auth.json），这里只做两件事：
 * 把 `notice`（授权地址 / 设备码 / 进度）显示出来，把 `prompt`（选账号、粘贴回调 URL）交回主进程。
 * 关掉弹窗等于取消，避免主进程里留一个永远等不到回答的登录。
 */
export function ModelAuthDialog({
  providerId,
  authType = 'oauth',
  providerLabel,
  onClose,
  onDone,
}: {
  providerId: string
  authType?: 'oauth' | 'api_key'
  providerLabel: string
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation('settings')
  const [phase, setPhase] = useState<Phase>('waiting')
  const [notice, setNotice] = useState<ModelAuthNotice | null>(null)
  const [noticeLog, setNoticeLog] = useState<string[]>([])
  const [prompt, setPrompt] = useState<ModelAuthPrompt | null>(null)
  const [promptId, setPromptId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const settledRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const cancel = useCallback(() => {
    if (!settledRef.current) void ipcClient.invoke('model.auth.cancel', { providerId }).catch(() => {})
    onClose()
  }, [onClose, providerId])

  useEffect(() => {
    const unsubscribe = onAppEvent((event) => {
      if (event.type !== 'model-auth' || event.providerId !== providerId) return
      if (event.phase === 'prompt' && event.prompt && event.promptId) {
        settledRef.current = false
        setPrompt(event.prompt)
        setPromptId(event.promptId)
        setAnswer('')
        setPhase('prompt')
        return
      }
      if (event.phase === 'notice' && event.notice) {
        setNotice(event.notice)
        setNoticeLog((log) => [...log, describeNotice(event.notice!)])
        setPhase('notice')
        return
      }
      if (event.phase === 'done') {
        settledRef.current = true
        setPhase('done')
        setPrompt(null)
        onDone()
        return
      }
      if (event.phase === 'error') {
        settledRef.current = true
        setError(event.error || t('models.authLoginFailed'))
        setPhase('error')
        return
      }
      if (event.phase === 'cancelled') {
        settledRef.current = true
        setPhase('cancelled')
      }
    })
    return unsubscribe
  }, [onDone, providerId, t])

  // Kick the flow once; a StrictMode double mount must not start two logins.
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void ipcClient.invoke('model.auth.login', { providerId, type: authType }).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      setPhase('error')
    })
  }, [authType, providerId])

  useEffect(() => {
    if (phase === 'prompt') inputRef.current?.focus()
  }, [phase, promptId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cancel])

  const submitAnswer = () => {
    if (!prompt || !promptId) return
    if (prompt.kind !== 'manual_code' && prompt.kind === 'select' && !answer) return
    void ipcClient
      .invoke('model.auth.answer', { providerId, promptId, value: answer })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    setPrompt(null)
    setPromptId(null)
    setPhase('waiting')
  }

  const openUrl = (url: string) => {
    void ipcClient.invoke('shell.openExternal', { url }).catch(() => {})
  }

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const linkUrl = useMemo(() => {
    if (!notice) return null
    if (notice.kind === 'auth_url') return notice.url
    if (notice.kind === 'device_code') return notice.verificationUri
    return null
  }, [notice])

  const deviceCode = notice?.kind === 'device_code' ? notice.userCode : null
  const instructions = notice?.kind === 'auth_url' ? notice.instructions : null
  const progress = notice?.kind === 'progress' || notice?.kind === 'info' ? notice.message : null

  return createPortal(
    <div
      className="overlay-backdrop electron-no-drag fixed inset-0 z-[700] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) cancel()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('models.authDialogTitle', { provider: providerLabel })}
        className="overlay-panel flex max-h-[min(720px,calc(100dvh-24px))] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border/70 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {phase === 'done' ? <Check className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">
              {t('models.authDialogTitle', { provider: providerLabel })}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {t('models.authDialogHint')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('models.close')}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={cancel}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {phase === 'waiting' ? (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('models.authWaiting')}
            </p>
          ) : null}

          {linkUrl ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5">
              <p className="text-[12px] leading-relaxed text-foreground-secondary">
                {instructions || t('models.authOpenHint')}
              </p>
              <div className="flex items-center gap-2">
                <button type="button" className={btnPrimary} onClick={() => openUrl(linkUrl)}>
                  <ExternalLink className="mr-1 inline h-3 w-3" strokeWidth={2} />
                  {t('models.authOpenBrowser')}
                </button>
                <button type="button" className={btnOutline} onClick={() => copy(linkUrl)}>
                  {copied ? (
                    <Check className="mr-1 inline h-3 w-3" strokeWidth={2} />
                  ) : (
                    <Copy className="mr-1 inline h-3 w-3" strokeWidth={2} />
                  )}
                  {t('models.authCopyLink')}
                </button>
              </div>
              <p className="break-all font-mono text-[10.5px] leading-relaxed text-muted-foreground">{linkUrl}</p>
            </div>
          ) : null}

          {deviceCode ? (
            <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5">
              <p className="text-[12px] text-foreground-secondary">{t('models.authDeviceCode')}</p>
              <div className="flex items-center gap-2">
                <code className="rounded bg-background px-2 py-1 font-mono text-[15px] tracking-[0.12em]">{deviceCode}</code>
                <button type="button" className={btnOutline} onClick={() => copy(deviceCode)}>
                  {copied ? (
                    <Check className="mr-1 inline h-3 w-3" strokeWidth={2} />
                  ) : (
                    <Copy className="mr-1 inline h-3 w-3" strokeWidth={2} />
                  )}
                  {t('models.authCopyCode')}
                </button>
              </div>
            </div>
          ) : null}

          {progress ? <p className="text-[12px] text-foreground-secondary">{progress}</p> : null}

          {prompt ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-foreground">{prompt.message}</p>
              {prompt.kind === 'select' ? (
                <div className="space-y-1.5">
                  {(prompt.options || []).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left transition',
                        answer === option.id
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-border/60 hover:bg-[var(--bg-hover)]',
                      )}
                      onClick={() => setAnswer(option.id)}
                    >
                      <span className="block text-[12.5px] text-foreground">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{option.description}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  ref={inputRef}
                  className="settings-field h-9 w-full px-2 text-[12.5px]"
                  value={answer}
                  placeholder={prompt.placeholder}
                  spellCheck={false}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitAnswer()
                  }}
                />
              )}
            </div>
          ) : null}

          {phase === 'done' ? (
            <p className="flex items-center gap-2 text-[12.5px] text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              {t('models.authLoginDone')}
            </p>
          ) : null}

          {phase === 'error' && error ? (
            <p className="whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          ) : null}

          {noticeLog.length > 1 ? (
            <details className="text-[11.5px] text-muted-foreground">
              <summary className="cursor-pointer">{t('models.authLog')}</summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {noticeLog.map((line, index) => (
                  <li key={index} className="list-disc">
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/70 px-4 py-2.5 sm:px-5">
          {phase === 'done' ? (
            <button type="button" className={btnPrimary} onClick={onClose}>
              {t('models.authClose')}
            </button>
          ) : (
            <>
              <button type="button" className={btnOutline} onClick={cancel}>
                {t('models.cancelBtn')}
              </button>
              {prompt ? (
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={prompt.kind === 'select' && !answer}
                  onClick={submitAnswer}
                >
                  {t('models.authContinue')}
                </button>
              ) : null}
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  )
}

function describeNotice(notice: ModelAuthNotice): string {
  switch (notice.kind) {
    case 'auth_url':
      return `auth_url: ${notice.url}`
    case 'device_code':
      return `device_code: ${notice.userCode} @ ${notice.verificationUri}`
    case 'progress':
      return notice.message
    default:
      return notice.message
  }
}
