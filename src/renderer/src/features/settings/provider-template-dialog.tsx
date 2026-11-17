import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Plug, Search, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { PROVIDER_PRESETS, type ProviderPreset } from './model-provider-presets'
import { ProviderAvatar } from './models-settings-shared'

export function ProviderTemplateDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect: (preset: ProviderPreset) => void
}) {
  const { t } = useTranslation('settings')
  const titleId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const presets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return PROVIDER_PRESETS.filter((preset) => preset.id !== 'custom-openai').filter((preset) => {
      if (!needle) return true
      const label = t(`models.providerLabels.${preset.id}`, { defaultValue: preset.label })
      const description = t(`models.providerDescriptions.${preset.id}`, { defaultValue: preset.tagline })
      return `${label} ${description} ${preset.defaultKey}`.toLocaleLowerCase().includes(needle)
    })
  }, [query, t])
  const customPreset = PROVIDER_PRESETS.find((preset) => preset.id === 'custom-openai')!

  useEffect(() => {
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

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
        className="overlay-panel flex max-h-[min(720px,calc(100dvh-24px))] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border/70 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Plug className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-foreground">{t('models.selectTemplate')}</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t('models.providerSetupHint')}</p>
            </div>
            <button type="button" aria-label={t('models.close')} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground" onClick={onClose}><X className="h-4 w-4" /></button>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('models.searchProviderPlaceholder')}
              className="settings-field-focus h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[12.5px] text-foreground outline-none transition focus:border-primary"
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('models.presetProviders')}</div>
          {presets.length ? <div className="grid gap-1.5 sm:grid-cols-2">
            {presets.map((preset) => {
              const label = t(`models.providerLabels.${preset.id}`, { defaultValue: preset.label })
              return <TemplateOption key={preset.id} preset={preset} label={label} description={t(`models.providerDescriptions.${preset.id}`, { defaultValue: preset.tagline })} onSelect={onSelect} />
            })}
          </div> : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">{t('models.noProviderTemplateMatch')}</p>}

          <div className="my-3 border-t border-border/60" />
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('models.customProviderGroup')}</div>
          <button
            type="button"
            className="group flex w-full items-center gap-3 rounded-lg border border-dashed border-primary/35 bg-primary/[0.035] px-3 py-3 text-left transition hover:border-primary/65 hover:bg-primary/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => onSelect(customPreset)}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Plug className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">{t('models.customProvider')}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">{t('models.customProviderDescription')}</span>
            </span>
            <span className="shrink-0 rounded-md border border-primary/25 px-2.5 py-1 text-[11px] font-medium text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">{t('models.configure')}</span>
          </button>
        </div>

        <footer className="shrink-0 border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground sm:px-5">{t('models.providerSetupFooter')}</footer>
      </section>
    </div>,
    document.body,
  )
}

function TemplateOption({ preset, label, description, onSelect }: { preset: ProviderPreset; label: string; description: string; onSelect: (preset: ProviderPreset) => void }) {
  const { t } = useTranslation('settings')
  return <button
    type="button"
    className={cn('flex min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background/45 px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-accent/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary')}
    onClick={() => onSelect(preset)}
  >
    <ProviderAvatar preset={preset} label={label} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[12.5px] font-medium text-foreground">{label}</span>
      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{description}</span>
      <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/75">{t('models.keyName')} {preset.defaultKey}{preset.starterModels?.length ? ` · ${t('models.containsModels', { count: preset.starterModels.length })}` : ` · ${t('models.needsFetch')}`}</span>
    </span>
  </button>
}
