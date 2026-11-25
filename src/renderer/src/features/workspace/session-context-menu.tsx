import { requestOpenInPane } from '@renderer/features/split/split-dnd'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronRight, Copy, FolderOpen, GitFork, Pencil, Trash2, Columns2 } from '@renderer/components/icons'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { workspacePathsEqual } from '@shared/workspace-path'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { ipcClient } from '@renderer/lib/ipc-client'
import { withUndo } from '@renderer/lib/undo-toast'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import {
  contextMenuDangerItemClass,
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
  useContextMenuPlacement,
} from './context-menu-shared'
import { RenamePromptDialog } from './rename-prompt-dialog'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import type { SessionMenuTarget } from './session-context-menu-types'
import { SessionForkSubmenu } from './session-fork-submenu'
import { PinGlyph } from './pin-glyph'
import { isSessionPinned, togglePinSession, usePinnedSessions } from './pinned-sessions'

export type { SessionMenuTarget } from './session-context-menu-types'

type MenuState = { x: number; y: number; target: SessionMenuTarget } | null

export function SessionContextMenuPortal({
  menu,
  onClose,
  onSessionsChange,
  onSessionRenamed,
  onSessionRemoved,
}: {
  menu: MenuState
  onClose: () => void
  onSessionsChange: (workspacePath?: string) => void
  /** 重命名成功后本地更新侧栏条目标题：避免整列表重拉（重命名不改变列表顺序，重拉只会引起重渲染闪烁） */
  onSessionRenamed?: (payload: { sessionFile: string; title: string; workspacePath: string }) => void
  /** 删除确认后立即从侧栏移除条目：删除 IPC 可能较慢（worker 重建 runtime），不让 UI 干等 */
  onSessionRemoved?: (payload: { sessionFile: string; workspacePath: string }) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 菜单靠下时向上弹，否则底部几项会被窗口底边切掉。
  const panelRef = useRef<HTMLDivElement>(null)
  const placement = useContextMenuPlacement(!!menu, menu, panelRef)
  const { t } = useTranslation()
  const [renameTarget, setRenameTarget] = useState<SessionMenuTarget | null>(null)
  // In-app confirm: a native window.confirm leaves Windows Electron pages untypable (#94).
  const [deleteTarget, setDeleteTarget] = useState<SessionMenuTarget | null>(null)
  const pinnedSessions = usePinnedSessions()

  // Row box of the "Fork" item while its submenu is open.
  const [forkAnchor, setForkAnchor] = useState<DOMRect | null>(null)

  useDismissContextMenu(!!menu, ref, onClose)
  useEffect(() => setForkAnchor(null), [menu])

  const refreshList = (path?: string) => onSessionsChange(path)

  const submitRename = async (title: string) => {
    const target = renameTarget
    if (!target) return
    if (!target.sessionFile) {
      toast.error(t('common:sidebar.renameMissingFile'))
      setRenameTarget(null)
      return
    }
    try {
      const r = await ipcClient.invoke('session.rename', {
        sessionId: target.sessionId,
        sessionFile: target.sessionFile,
        title,
        workspaceId: target.workspacePath,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.renamed'))
        if (onSessionRenamed) {
          onSessionRenamed({ sessionFile: target.sessionFile, title, workspacePath: target.workspacePath })
        } else {
          refreshList(target.workspacePath)
        }
        setRenameTarget(null)
      } else toast.error(r?.error || t('common:sidebar.renameFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  /**
   * 目标对话是否正开在界面上。
   * 以前只比 currentSessionId：新建对话还没回填 id、或 pendingBind 指向这个文件时判不出来，
   * 结果是被归档/删除的对话还留在时间线里，用户以为没生效。
   */
  const detachIfViewing = (target: SessionMenuTarget) => {
    const state = useUIStore.getState()
    const file = target.sessionFile
    const viewing = !!file && (state.currentSessionId === target.sessionId || sessionFilesEqual(state.historySessionFile, file))
    if (viewing) {
      state.setCurrentSession('')
      state.clearTimeline()
      state.loadHistoryItems([])
      state.setHistoryMeta(0, 0, null)
    }
    // 解绑交给主进程按文件比较判断（ipc:session.delete / archive 里做），
    // 渲染层读不到 pendingBind 指针，硬猜只会把别的会话的绑定一起清掉。
  }

  const requestDelete = (target: SessionMenuTarget) => {
    if (!target.sessionFile) toast.error(t('common:sidebar.deleteMissingFile'))
    else setDeleteTarget(target)
    onClose()
  }

  const runDelete = async (target: SessionMenuTarget) => {
    if (!target.sessionFile) return
    // 确认后立即乐观移除侧栏条目：删除 IPC 要等 worker 重建 runtime，不让 UI 干等；
    // 完成或失败后再以整列表刷新校准。
    onSessionRemoved?.({ sessionFile: target.sessionFile, workspacePath: target.workspacePath })
    try {
      const r = await ipcClient.invoke('session.delete', {
        sessionFile: target.sessionFile,
        workspaceId: target.workspacePath,
        title: target.title,
      })
      if (r?.ok) {
        detachIfViewing(target)
        // Drop the deleted session's per-session state so late events cannot resurrect it.
        const deletedFile = target.sessionFile
        void import('@renderer/stores/session-scope').then((m) => m.removeSessionState(deletedFile))
        const trashId = (r as { trashId?: string }).trashId
        if (trashId) {
          // 主进程留了副本：给一次撤销机会，而不是删掉就没了。
          withUndo({
            message: t('common:sidebar.deleted'),
            undoLabel: t('common:sidebar.undoDelete'),
            doneMessage: t('common:sidebar.deleteRestored'),
            onUndo: async () => {
              await ipcClient.invoke('session.restore', { trashId })
              refreshList(target.workspacePath)
            },
          })
        } else {
          toast.success(t('common:sidebar.deleted'))
        }
        refreshList(target.workspacePath)
      } else {
        toast.error(r?.error || t('common:sidebar.deleteFailed'))
        // 失败时也刷新：把乐观移除的条目恢复回来
        refreshList(target.workspacePath)
      }
    } catch (e) {
      toast.error(t('common:sidebar.deleteFailed'))
      refreshList(target.workspacePath)
    }
  }

  /** 归档：会话文件留在磁盘，只从侧栏收起来，去项目右键的「查看归档对话」里找。 */
  const runArchive = async (target: SessionMenuTarget) => {
    if (!target.sessionFile) return
    onClose()
    onSessionRemoved?.({ sessionFile: target.sessionFile, workspacePath: target.workspacePath })
    try {
      const r = await ipcClient.invoke('session.archive', {
        sessionFile: target.sessionFile,
        workspaceId: target.workspacePath,
        title: target.title,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.archived'))
        detachIfViewing(target)
        void import('@renderer/stores/session-scope').then((m) => m.removeSessionState(target.sessionFile || ''))
      } else toast.error(r?.error || t('common:sidebar.archiveFailed'))
      refreshList(target.workspacePath)
    } catch {
      toast.error(t('common:sidebar.archiveFailed'))
      refreshList(target.workspacePath)
    }
  }

  const itemClass = contextMenuItemClass
  const renameDefault =
    renameTarget?.title || renameTarget?.sessionId.slice(0, 8) || ''

  return (
    <>
      {menu
        ? createPortal(
            // One wrapper so outside-click dismissal treats the fork submenu as part of the menu.
            <div ref={ref}>
            <div
              ref={panelRef}
              className={contextMenuPanelClass}
              style={{ left: placement?.left ?? menu.x, top: placement?.top ?? menu.y, ...(placement ? {} : { visibility: 'hidden' as const }) }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerOver={(e) => {
                if (!(e.target as HTMLElement).closest('[data-fork-item]')) setForkAnchor(null)
              }}
            >
              {menu.target.sessionFile ? (() => {
                const file = menu.target.sessionFile
                const pinned = isSessionPinned(pinnedSessions, file)
                return (
                  <button
                    type="button"
                    className={itemClass}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      const nextPinned = togglePinSession(file)
                      toast.success(t(nextPinned ? 'common:sidebar.pinned' : 'common:sidebar.unpinned'))
                      onClose()
                    }}
                  >
                    <PinGlyph filled={pinned} className="h-3 w-3 shrink-0" />
                    {t(pinned ? 'common:sidebar.unpinSession' : 'common:sidebar.pinSession')}
                  </button>
                )
              })() : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    const target = menu.target
                    if (target.sessionFile) {
                      requestOpenInPane({ sessionId: target.sessionId, sessionFile: target.sessionFile, workspace: target.workspacePath, title: target.title })
                    }
                    onClose()
                  }}
                >
                  <Columns2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:split.openInPane')}
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  data-fork-item
                  aria-haspopup="menu"
                  aria-expanded={!!forkAnchor}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerEnter={(e) => setForkAnchor(e.currentTarget.getBoundingClientRect())}
                  onClick={(e) => {
                    e.stopPropagation()
                    setForkAnchor(e.currentTarget.getBoundingClientRect())
                  }}
                >
                  <GitFork className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.fork')}
                  <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-foreground-secondary" strokeWidth={2} />
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void navigator.clipboard.writeText(menu.target.sessionFile || '')
                    toast.success(t('files:toast.copied'))
                    onClose()
                  }}
                >
                  <Copy className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.copySessionPath')}
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void ipcClient.invoke('shell.showItemInFolder', { path: menu.target.sessionFile })
                    onClose()
                  }}
                >
                  <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.openLog')}
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void runArchive(menu.target)
                  }}
                >
                  <Archive className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.archiveSession')}
                </button>
              ) : null}
              <button
                type="button"
                className={itemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setRenameTarget(menu.target)
                  onClose()
                }}
              >
                <Pencil className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.rename')}
              </button>
              <button
                type="button"
                className={contextMenuDangerItemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  requestDelete(menu.target)
                }}
              >
                <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.delete')}
              </button>
            </div>
            {forkAnchor && menu.target.sessionFile ? (
              <SessionForkSubmenu
                anchor={forkAnchor}
                target={{ ...menu.target, sessionFile: menu.target.sessionFile }}
                onDone={onClose}
                onSessionsChange={refreshList}
              />
            ) : null}
            </div>,
            document.body,
          )
        : null}
      <RenamePromptDialog
        open={!!renameTarget}
        title={t('common:sidebar.renameSession')}
        defaultValue={renameDefault}
        onConfirm={submitRename}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common:sidebar.delete')}
        message={t('common:sidebar.deleteSessionTrashConfirm', {
          name: deleteTarget?.title || deleteTarget?.sessionId.slice(0, 8) || '',
        })}
        destructive
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) void runDelete(target)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}