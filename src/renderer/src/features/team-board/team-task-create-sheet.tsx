import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { TEAM_ROLES, type TeamSnapshot } from '@shared/team-board'
import { roleLabel } from './team-board-lib'

export function TeamTaskCreateSheet({
  workspaceId,
  defaultRole,
  onClose,
  onDone,
}: {
  workspaceId: string
  defaultRole: string
  onClose: () => void
  onDone: (snapshot: TeamSnapshot) => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [role, setRole] = useState(defaultRole || 'Builder')
  const [output, setOutput] = useState('')
  const [ownedPaths, setOwnedPaths] = useState('')
  const [note, setNote] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!title.trim()) return
    setBusy(true)
    setError('')
    try {
      const parsedOwnedPaths = ownedPaths
        .split(/[、,，;；\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      const response = await ipcClient.invoke('teamBoard.task.create', {
        workspaceId,
        title: title.trim(),
        role,
        output: output.trim() || undefined,
        ...(parsedOwnedPaths.length ? { ownedPaths: parsedOwnedPaths } : {}),
        note: note.trim() || undefined,
        acceptance: acceptance
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      })
      if (response?.snapshot) onDone(response.snapshot)
      toast.success(t('team:taskCreated'))
      onClose()
    } catch (caught) {
      setError(String((caught as Error)?.message || caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="team-overlay" role="dialog" aria-modal="true" aria-label={t('team:newTaskTitle')}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2.5 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('team:back')}
          className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-medium">{t('team:newTaskTitle')}</span>
      </div>

      <div className="team-sheet-scroll team-scroll">
        <label className="block text-2xs text-foreground-secondary">
          {t('team:titleLabel')}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            autoFocus
            className="team-sheet-input mt-1"
          />
        </label>

        <label className="mt-2 block text-2xs text-foreground-secondary">
          {t('team:role')}
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="team-sheet-input mt-1"
          >
            {TEAM_ROLES.map((item) => (
              <option key={item} value={item}>
                {roleLabel(item, t)}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-2 block text-2xs text-foreground-secondary">
          {t('team:acceptance')}
          <textarea
            value={acceptance}
            onChange={(event) => setAcceptance(event.target.value)}
            rows={4}
            placeholder={t('team:acceptancePlaceholder')}
            className="team-sheet-input mt-1 resize-y"
          />
        </label>

        <label className="mt-2 block text-2xs text-foreground-secondary">
          {t('team:output')}
          <input
            value={output}
            onChange={(event) => setOutput(event.target.value)}
            placeholder="src/…"
            className="team-sheet-input mt-1 font-mono"
          />
        </label>

        <label className="mt-2 block text-2xs text-foreground-secondary">
          {t('team:ownedPaths')}
          <input
            value={ownedPaths}
            onChange={(event) => setOwnedPaths(event.target.value)}
            placeholder={t('team:ownedPathsPlaceholder')}
            className="team-sheet-input mt-1 font-mono"
          />
        </label>

        <label className="mt-2 block text-2xs text-foreground-secondary">
          {t('team:note')}
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="team-sheet-input mt-1"
          />
        </label>

        {error ? <p className="mt-2 text-2xs text-destructive">{error}</p> : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/40 px-2.5 py-2">
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)]">
          {t('team:cancel')}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !title.trim()}
          className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {t('team:create')}
        </button>
      </div>
    </div>
  )
}
