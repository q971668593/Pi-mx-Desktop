import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import {
  contextMenuDangerItemClass,
  contextMenuItemClass,
  contextMenuPanelClass,
  useContextMenuPlacement,
  useDismissContextMenu,
} from './context-menu-shared'
import { RenamePromptDialog } from './rename-prompt-dialog'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'

type MenuState = { x: number; y: number; path: string; label: string } | null
type RenameState = { path: string; label: string } | null

export function SandboxContextMenuPortal({
  menu,
  onClose,
  onListChange,
}: {
  menu: MenuState
  onClose: () => void
  onListChange: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const [renameState, setRenameState] = useState<RenameState>(null)
  // In-app confirm: a native window.confirm leaves Windows Electron pages untypable (#94).
  const [deleteState, setDeleteState] = useState<RenameState>(null)

  useDismissContextMenu(!!menu, panelRef, onClose)
  // 靠下就向上弹：菜单底部几项不会被窗口底边切掉。
  const placement = useContextMenuPlacement(!!menu, menu, panelRef)

  const submitRename = async (label: string) => {
    const state = renameState
    if (!state) return
    try {
      const r = await ipcClient.invoke('workspace.sandbox.rename', {
        path: state.path,
        label,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.renamed'))
        onListChange()
        setRenameState(null)
      } else toast.error(t('common:sidebar.renameFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  const runDelete = async (path: string) => {
    try {
      const r = await ipcClient.invoke('workspace.sandbox.delete', { path })
      if (r?.ok) {
        const cur = useUIStore.getState().currentWorkspace
        if (cur === path) {
          useUIStore.getState().setWorkspace(null)
          useUIStore.getState().clearTimeline()
          useUIStore.getState().setCurrentSession('')
          useUIStore.getState().loadHistoryItems([])
          useUIStore.getState().setHistoryMeta(0, 0, null)
        }
        toast.success(t('common:sidebar.deleted'))
        onListChange()
      } else toast.error(t('common:sidebar.deleteFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.deleteFailed'))
    }
  }

  const itemClass = contextMenuItemClass

  return (
    <>
      {menu
        ? createPortal(
            <div
              ref={panelRef}
              className={contextMenuPanelClass}
              style={{ left: placement?.left ?? menu.x, top: placement?.top ?? menu.y, ...(placement ? {} : { visibility: 'hidden' as const }) }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={itemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setRenameState({ path: menu.path, label: menu.label })
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
                  setDeleteState({ path: menu.path, label: menu.label })
                  onClose()
                }}
              >
                <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.delete')}
              </button>
            </div>,
            document.body,
          )
        : null}
      <RenamePromptDialog
        open={!!renameState}
        title={t('common:sidebar.renameTempChat')}
        defaultValue={renameState?.label ?? ''}
        onConfirm={submitRename}
        onCancel={() => setRenameState(null)}
      />
      <ConfirmDialog
        open={!!deleteState}
        title={t('common:sidebar.delete')}
        message={t('common:sidebar.deleteConfirm', { name: deleteState?.label ?? '' })}
        destructive
        onConfirm={() => {
          const target = deleteState
          setDeleteState(null)
          if (target) void runDelete(target.path)
        }}
        onCancel={() => setDeleteState(null)}
      />
    </>
  )
}