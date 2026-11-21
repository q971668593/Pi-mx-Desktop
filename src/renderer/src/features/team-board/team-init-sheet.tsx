import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Check, FolderTree, Loader2, Sparkles } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import type { TeamSnapshot } from '@shared/team-board'

export function TeamInitSheet({
  workspaceId,
  defaultMode,
  projectName,
  specPath,
  onClose,
  onDone,
}: {
  workspaceId: string
  defaultMode: 'new' | 'legacy'
  projectName: string
  specPath: string
  onClose: () => void
  onDone: (snapshot: TeamSnapshot) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'new' | 'legacy'>(defaultMode)
  const [name, setName] = useState(projectName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [useGlobalDefault, setUseGlobalDefault] = useState(true)
  const [globalDefault, setGlobalDefault] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await ipcClient.invoke('pi.settings.get')
        if (cancelled) return
        const provider = String(response?.settings?.defaultProvider || '').trim()
        const model = String(response?.settings?.defaultModel || '').trim()
        if (provider && model) setGlobalDefault(`${provider}/${model}`)
      } catch {
        /* 没有全局默认就不预填 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await ipcClient.invoke('teamBoard.init', {
        workspaceId,
        mode,
        name: name.trim() || projectName,
        ...(useGlobalDefault && globalDefault ? { defaultModel: globalDefault } : {}),
      })
      if (response?.snapshot) onDone(response.snapshot)
      toast.success(t('team:init.done'))
      onClose()
    } catch (caught) {
      setError(String((caught as Error)?.message || caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="team-overlay" role="dialog" aria-modal="true" aria-label={t('team:init.title')}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2.5 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('team:back')}
          className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-medium">{t('team:init.title')}</span>
      </div>

      <div className="team-sheet-scroll team-scroll">
        <div className="team-sheet-role !items-start">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground-secondary">
            {mode === 'new' ? t('team:init.descNew') : t('team:init.descLegacy')}
          </p>
        </div>

        <label className="mt-3 block text-2xs text-foreground-secondary">
          {t('team:init.name')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            autoFocus
            className="team-sheet-input mt-1"
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setMode('new')}
            data-active={mode === 'new'}
            className={cn(
              'rounded-lg border px-2 py-2 text-left text-xs',
              mode === 'new'
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border/50 text-foreground-secondary hover:bg-[var(--bg-hover)]',
            )}
          >
            <div className="font-medium">{t('team:init.modeNew')}</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('legacy')}
            data-active={mode === 'legacy'}
            className={cn(
              'rounded-lg border px-2 py-2 text-left text-xs',
              mode === 'legacy'
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border/50 text-foreground-secondary hover:bg-[var(--bg-hover)]',
            )}
          >
            <div className="font-medium">{t('team:init.modeLegacy')}</div>
          </button>
        </div>

        <button
          type="button"
          role="checkbox"
          aria-checked={useGlobalDefault}
          onClick={() => setUseGlobalDefault((value) => !value)}
          disabled={!globalDefault}
          className="mt-3 flex w-full items-start gap-2 rounded-lg border border-border/50 px-2 py-2 text-left text-xs disabled:opacity-50"
        >
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
              useGlobalDefault && globalDefault ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent',
            )}
          >
            <Check className="h-2.5 w-2.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">{t('team:useGlobalDefault')}</span>
            <span className="block truncate font-mono text-2xs text-foreground-tertiary">
              {globalDefault || t('team:globalDefaultMissing')}
            </span>
          </span>
        </button>

        <div className="mt-3 flex items-start gap-1.5 text-2xs text-foreground-tertiary">
          <FolderTree className="mt-[1px] h-3 w-3 shrink-0" />
          <span className="min-w-0 break-all font-mono">{specPath}</span>
        </div>
        {error ? <p className="mt-2 text-2xs text-destructive">{error}</p> : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/40 px-2.5 py-2">
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)]">
          {t('team:cancel')}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('team:init.confirm')}
        </button>
      </div>
    </div>
  )
}
