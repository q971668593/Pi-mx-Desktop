import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, RotateCcw, Search, Trash2, X } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { toast } from 'sonner'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import './session-vault.css'

export type TrashRow = {
  id: string
  sessionFile: string
  workspaceId: string
  title: string
  deletedAt: number
}

const DAY_MS = 24 * 60 * 60_000

function formatWhen(ms: number, locale: string): string {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function daysLeft(deletedAt: number): number {
  if (!deletedAt) return 5
  return Math.max(0, Math.ceil((deletedAt + 5 * DAY_MS - Date.now()) / DAY_MS))
}

/**
 * 回收站：全屏列表。
 *
 * 删除对话不再直接销毁，先进这里；可以还原，也可以彻底删掉。
 * 保留 5 天，过期由主进程自动清空（打开列表时也会顺带清一遍）。
 */
export function SessionTrashDialog({
  projectName,
  onClose,
  onChanged,
}: {
  projectName: (path: string) => string
  onClose: () => void
  /** workspaceId 传回被还原/删除条目所属项目，方便外部只刷新那个项目。 */
  onChanged?: (workspaceId?: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [rows, setRows] = useState<TrashRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<TrashRow | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await ipcClient.invoke('session.trash.list', {})
      setRows(Array.isArray(r?.entries) ? (r.entries as TrashRow[]) : [])
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    // 确认框开着时 Esc 只关确认框：以前会连整个弹窗一起关掉，用户以为点错了。
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || purgeTarget) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, purgeTarget])

  const filter = query.trim().toLowerCase()
  const shown = useMemo(() => (rows || []).filter((row) => {
    if (!filter) return true
    return [row.title, row.sessionFile, projectName(row.workspaceId)]
      .some((value) => String(value || '').toLowerCase().includes(filter))
  }), [rows, filter, projectName])

  const restore = async (row: TrashRow) => {
    setBusy(row.id)
    try {
      const r = await ipcClient.invoke('session.restore', { trashId: row.id })
      if (r?.ok) {
        toast.success(t('common:sidebar.deleteRestored'))
        setRows((prev) => (prev || []).filter((item) => item.id !== row.id))
        onChanged?.(row.workspaceId)
      } else toast.error(t('common:sidebar.trashRestoreFailed'))
    } finally {
      setBusy(null)
    }
  }

  const purge = async (row: TrashRow) => {
    setBusy(row.id)
    try {
      const r = await ipcClient.invoke('session.trash.purge', { trashId: row.id })
      if (r?.ok) {
        toast.success(t('common:sidebar.trashPurged'))
        setRows((prev) => (prev || []).filter((item) => item.id !== row.id))
        onChanged?.(row.workspaceId)
      } else toast.error(r?.error || t('common:sidebar.trashPurgeFailed'))
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <div className="session-vault-backdrop electron-no-drag" role="dialog" aria-modal="true" aria-labelledby="session-trash-title"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="session-vault">
        <header className="session-vault-header">
          <span className="session-vault-tile session-vault-tile-danger"><Trash2 size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="session-trash-title">
              {t('common:sidebar.trashTitle')}
              <span className="session-vault-count">{rows ? rows.length : '…'}</span>
            </h2>
            <p>{t('common:sidebar.trashDialogHint')}</p>
          </div>
          <button type="button" className="session-vault-close" aria-label={t('common:sidebar.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label className="session-vault-search">
          <Search size={15} />
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common:sidebar.searchTrash')} aria-label={t('common:sidebar.searchTrash')} />
        </label>
        <div className="session-vault-body" aria-live="polite">
          {rows === null ? (
            <div className="session-vault-empty"><Loader2 size={20} className="animate-spin" /><strong>{t('common:sidebar.loading')}</strong></div>
          ) : shown.length === 0 ? (
            <div className="session-vault-empty">
              <Trash2 size={22} />
              <strong>{rows.length ? t('common:sidebar.noTrashMatch') : t('common:sidebar.trashEmpty')}</strong>
              <p>{rows.length ? t('common:sidebar.tryAnotherKeyword') : t('common:sidebar.trashEmptyHint')}</p>
            </div>
          ) : shown.map((row) => (
            <div className="session-vault-card" key={row.id}>
              <span className="session-vault-tile session-vault-tile-danger"><Trash2 size={15} /></span>
              <div className="min-w-0 flex-1">
                <strong className="session-vault-title" title={row.title || row.sessionFile}>
                  {row.title || row.sessionFile.split(/[\\/]/).pop()}
                </strong>
                <p className="session-vault-meta">
                  <span>{projectName(row.workspaceId)}</span>
                  <span>{formatWhen(row.deletedAt, i18n.language)}</span>
                  <span className="session-vault-expiry">{t('common:sidebar.trashDaysLeft', { count: daysLeft(row.deletedAt) })}</span>
                </p>
              </div>
              <button type="button" className="session-vault-button" disabled={busy === row.id} onClick={() => void restore(row)}>
                <RotateCcw size={14} />{t('common:sidebar.trashRestore')}
              </button>
              <button type="button" className="session-vault-button session-vault-button-danger" disabled={busy === row.id}
                onClick={() => setPurgeTarget(row)}>
                <Trash2 size={14} />{t('common:sidebar.trashPurge')}
              </button>
            </div>
          ))}
        </div>
      </div>
      <ConfirmDialog
        open={!!purgeTarget}
        title={t('common:sidebar.trashPurge')}
        message={t('common:sidebar.trashPurgeConfirm', {
          name: purgeTarget?.title || purgeTarget?.sessionFile.split(/[\\/]/).pop() || '',
        })}
        destructive
        onConfirm={() => {
          const target = purgeTarget
          setPurgeTarget(null)
          if (target) void purge(target)
        }}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>,
    document.body,
  )
}
