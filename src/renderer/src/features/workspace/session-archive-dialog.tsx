import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Archive, Loader2, RotateCcw, Search, Trash2, X } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { toast } from 'sonner'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import './session-vault.css'

export type ArchiveRow = {
  id: string
  sessionFile: string
  workspaceId: string
  title: string
  archivedAt: number
}

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

/**
 * 归档对话：全屏列表。
 *
 * 归档不是删除——会话文件还在磁盘上，这里只是「收起来的对话」的统一入口，
 * 可以搜索、还原回侧栏，也可以直接扔进回收站。
 */
export function SessionArchiveDialog({
  workspacePath,
  projectName,
  onClose,
  onChanged,
}: {
  /** 只看这个项目的归档；不传就是全部项目的归档。 */
  workspacePath?: string
  projectName: (path: string) => string
  onClose: () => void
  /** workspaceId 传回被还原/删除条目所属项目，方便外部只刷新那个项目。 */
  onChanged?: (workspaceId?: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [rows, setRows] = useState<ArchiveRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ArchiveRow | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await ipcClient.invoke('session.archive.list', workspacePath ? { workspaceId: workspacePath } : {})
      setRows(Array.isArray(r?.entries) ? (r.entries as ArchiveRow[]) : [])
    } catch {
      setRows([])
    }
  }, [workspacePath])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    // 确认框开着时 Esc 只关确认框，不连整个弹窗一起关。
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || deleteTarget) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, deleteTarget])

  const filter = query.trim().toLowerCase()
  const shown = useMemo(() => (rows || []).filter((row) => {
    if (!filter) return true
    return [row.title, row.sessionFile, projectName(row.workspaceId)]
      .some((value) => String(value || '').toLowerCase().includes(filter))
  }), [rows, filter, projectName])

  const restore = async (row: ArchiveRow) => {
    setBusy(row.id)
    try {
      const r = await ipcClient.invoke('session.archive.restore', { id: row.id })
      if (r?.ok) {
        toast.success(t('common:sidebar.archiveRestored'))
        setRows((prev) => (prev || []).filter((item) => item.id !== row.id))
        onChanged?.(row.workspaceId || workspacePath)
      } else toast.error(r?.error || t('common:sidebar.archiveRestoreFailed'))
    } finally {
      setBusy(null)
    }
  }

  const purge = async (row: ArchiveRow) => {
    setBusy(row.id)
    try {
      // 归档里的「删除」：真删文件，同时清掉归档记录，之后能在回收站里找回来。
      const r = await ipcClient.invoke('session.delete', {
        sessionFile: row.sessionFile,
        workspaceId: row.workspaceId || workspacePath || '',
        title: row.title,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.deleted'))
        setRows((prev) => (prev || []).filter((item) => item.id !== row.id))
        onChanged?.(row.workspaceId)
      } else if (r?.error === 'session_file_missing' || r?.error === 'no session file') {
        // 文件早就不在了（外部删除/WSL 卸载）：删文件无从谈起，直接摘掉归档记录即可。
        const dropped = await ipcClient.invoke('session.archive.drop', { id: row.id })
        if (dropped?.ok) {
          toast.success(t('common:sidebar.deleted'))
          setRows((prev) => (prev || []).filter((item) => item.id !== row.id))
          onChanged?.(row.workspaceId)
        } else toast.error(r?.error || t('common:sidebar.deleteFailed'))
      } else toast.error(r?.error || t('common:sidebar.deleteFailed'))
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <div className="session-vault-backdrop electron-no-drag" role="dialog" aria-modal="true" aria-labelledby="session-archive-title"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="session-vault">
        <header className="session-vault-header">
          <span className="session-vault-tile"><Archive size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="session-archive-title">
              {workspacePath ? projectName(workspacePath) : t('common:sidebar.allProjects')}
              <span className="session-vault-count">{rows ? rows.length : '…'}</span>
            </h2>
            <p>{t('common:sidebar.archiveDialogHint')}</p>
          </div>
          <button type="button" className="session-vault-close" aria-label={t('common:sidebar.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label className="session-vault-search">
          <Search size={15} />
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common:sidebar.searchArchived')} aria-label={t('common:sidebar.searchArchived')} />
        </label>
        <div className="session-vault-body" aria-live="polite">
          {rows === null ? (
            <div className="session-vault-empty"><Loader2 size={20} className="animate-spin" /><strong>{t('common:sidebar.loading')}</strong></div>
          ) : shown.length === 0 ? (
            <div className="session-vault-empty">
              <Archive size={22} />
              <strong>{rows.length ? t('common:sidebar.noArchivedMatch') : t('common:sidebar.noArchived')}</strong>
              <p>{rows.length ? t('common:sidebar.tryAnotherKeyword') : t('common:sidebar.noArchivedHint')}</p>
            </div>
          ) : shown.map((row) => (
            <div className="session-vault-card" key={row.id}>
              <span className="session-vault-tile"><Archive size={15} /></span>
              <div className="min-w-0 flex-1">
                <strong className="session-vault-title" title={row.title || row.sessionFile}>
                  {row.title || row.sessionFile.split(/[\\/]/).pop()}
                </strong>
                <p className="session-vault-meta">
                  <span>{projectName(row.workspaceId)}</span>
                  <span>{formatWhen(row.archivedAt, i18n.language)}</span>
                </p>
              </div>
              <button type="button" className="session-vault-button" disabled={busy === row.id} onClick={() => void restore(row)}>
                <RotateCcw size={14} />{t('common:sidebar.archiveRestore')}
              </button>
              <button type="button" className="session-vault-button session-vault-button-danger" disabled={busy === row.id}
                onClick={() => setDeleteTarget(row)}>
                <Trash2 size={14} />{t('common:sidebar.delete')}
              </button>
            </div>
          ))}
        </div>
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common:sidebar.delete')}
        message={t('common:sidebar.deleteSessionTrashConfirm', {
          name: deleteTarget?.title || deleteTarget?.sessionFile.split(/[\\/]/).pop() || '',
        })}
        destructive
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) void purge(target)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>,
    document.body,
  )
}
