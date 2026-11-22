import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Plug, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { PiModelsProviderConfig } from '@shared/ipc-contract'
import { API_OPTS, ProviderAvatar, inputCls, selectCls } from './models-settings-shared'
import { btnOutline, btnPrimary } from './settings-controls'
import type { ProviderPreset } from './model-provider-presets'

export type ProviderDraft = {
  /** Provider id inside models.json; fixed once created. */
  pid: string
  config: PiModelsProviderConfig
}

const fieldCls = 'settings-field h-9 py-0 text-[13px]'

/**
 * 本地网关（Ollama / LM Studio）常被填成 `localhost:11434`，没有 scheme。
 * 这里只要求非空，缺 scheme 时自动补 `http://`，不拦用户。
 */
function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

/**
 * 新增 / 编辑供应商的连接信息。
 *
 * 添加供应商先选模板再填这一张表：名称、接口、Base URL、API Key。保存才写进
 * models.json 草稿，之后卡片上仍可随时「编辑」重新打开本弹窗。
 */
export function ProviderConfigDialog({
  mode,
  pid,
  preset,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit'
  pid: string
  /** Template used to prefill a new provider (labels / accent / starter models). */
  preset?: ProviderPreset | null
  initial: PiModelsProviderConfig
  onSubmit: (draft: ProviderDraft) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('settings')
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initial.name || preset?.label || '')
  const [api, setApi] = useState<NonNullable<PiModelsProviderConfig['api']>>(
    initial.api || 'openai-completions',
  )
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl || '')
  const [apiKey, setApiKey] = useState(initial.apiKey || '')
  const [keyVisible, setKeyVisible] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    nameRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const error = !baseUrl.trim() ? 'required' : null
  const blocked = !name.trim() || error !== null
  const submit = () => {
    setShowErrors(true)
    if (blocked) return
    onSubmit({
      pid,
      config: {
        ...initial,
        name: name.trim(),
        api,
        baseUrl: normalizeBaseUrl(baseUrl),
        apiKey: apiKey.trim() || undefined,
      },
    })
  }

  const label = preset
    ? t(`models.providerLabels.${preset.id}`, { defaultValue: preset.label })
    : initial.name || pid

  return createPortal(
    <div
      className="overlay-backdrop electron-no-drag fixed inset-0 z-[700] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="overlay-panel flex max-h-[min(720px,calc(100dvh-24px))] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border/70 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plug className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {mode === 'add' ? t('models.configDialogTitleAdd', { provider: label }) : t('models.configDialogTitleEdit')}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {t('models.configDialogHint')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('models.close')}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
            <ProviderAvatar preset={preset ?? undefined} label={label} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-foreground">{label}</div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {t('models.providerIdLabel')} {pid}
              </div>
            </div>
          </div>

          <div>
            <label htmlFor={`${titleId}-name`} className="mb-1 block text-[11.5px] text-foreground-secondary">
              {t('models.labelName')}
            </label>
            <input
              id={`${titleId}-name`}
              ref={nameRef}
              className={cn(inputCls, fieldCls)}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={label}
            />
            {showErrors && !name.trim() ? (
              <p className="mt-1 text-[11.5px] text-destructive">{t('models.configNameRequired')}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor={`${titleId}-api`} className="mb-1 block text-[11.5px] text-foreground-secondary">
              {t('models.labelApi')}
            </label>
            <select
              id={`${titleId}-api`}
              className={cn(selectCls, fieldCls, 'w-full max-w-none')}
              value={api}
              onChange={(event) => setApi(event.target.value as NonNullable<PiModelsProviderConfig['api']>)}
            >
              {API_OPTS.map((option) => (
                <option key={option.v} value={option.v}>
                  {option.l}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${titleId}-base`} className="mb-1 block text-[11.5px] text-foreground-secondary">
              {t('models.labelBaseUrl')}
            </label>
            <input
              id={`${titleId}-base`}
              className={cn(inputCls, fieldCls)}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
            />
            {showErrors && error === 'required' ? (
              <p className="mt-1 text-[11.5px] text-destructive">{t('models.configBaseUrlRequired')}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor={`${titleId}-key`} className="mb-1 block text-[11.5px] text-foreground-secondary">
              {t('models.labelApiKey')}
            </label>
            <div className="relative">
              <input
                id={`${titleId}-key`}
                className={cn(inputCls, fieldCls, 'pr-9')}
                type={keyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="$OPENAI_API_KEY"
                spellCheck={false}
              />
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setKeyVisible((value) => !value)}
                aria-label={keyVisible ? t('models.hideKeyLabel') : t('models.showKeyLabel')}
              >
                {keyVisible ? <EyeOff className="h-3.5 w-3.5" strokeWidth={2} /> : <Eye className="h-3.5 w-3.5" strokeWidth={2} />}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t('models.configApiKeyHint')}</p>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/70 px-4 py-2.5 sm:px-5">
          <button type="button" className={btnOutline} onClick={onCancel}>
            {t('models.cancelBtn')}
          </button>
          <button type="button" className={btnPrimary} onClick={submit}>
            {mode === 'add' ? t('models.configSaveAdd') : t('models.configSaveEdit')}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
