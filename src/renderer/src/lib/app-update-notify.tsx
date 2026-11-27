import { useEffect, type ReactElement } from 'react'
import { create } from 'zustand'
import type { AppUpdateAvailableInfo } from '@shared/app-update'
import { ipcClient, onAppUpdateAvailable } from '@renderer/lib/ipc-client'
import { AppUpdateDialog } from '@renderer/features/shell/app-update-dialog'

type AppUpdateStoreState = {
  availableUpdate: AppUpdateAvailableInfo | null
  dialogOpen: boolean
  setAvailableUpdate: (info: AppUpdateAvailableInfo | null) => void
  openDialog: (info?: AppUpdateAvailableInfo) => void
  closeDialog: () => void
  clearAvailableUpdate: () => void
}

export const useAppUpdateStore = create<AppUpdateStoreState>((set) => ({
  availableUpdate: null,
  dialogOpen: false,
  setAvailableUpdate: (info) => set({ availableUpdate: info }),
  openDialog: (info) =>
    set((state) => ({
      availableUpdate: info ?? state.availableUpdate,
      dialogOpen: !!(info ?? state.availableUpdate),
    })),
  closeDialog: () => set({ dialogOpen: false }),
  clearAvailableUpdate: () => set({ availableUpdate: null, dialogOpen: false }),
}))

/** Boot hook (main.tsx): keeps legacy import; real UI is AppUpdateHost. */
export function ensureAppUpdateNotify(): void {
  /* no-op: subscription lives in AppUpdateHost under React tree */
}

/** Imperative open for Settings "Check for updates" and top-right update badge. */
export function showAppUpdateDialog(info?: AppUpdateAvailableInfo): void {
  useAppUpdateStore.getState().openDialog(info)
}

export function AppUpdateHost(): ReactElement | null {
  const availableUpdate = useAppUpdateStore((s) => s.availableUpdate)
  const dialogOpen = useAppUpdateStore((s) => s.dialogOpen)
  const setAvailableUpdate = useAppUpdateStore((s) => s.setAvailableUpdate)
  const closeDialog = useAppUpdateStore((s) => s.closeDialog)
  const clearAvailableUpdate = useAppUpdateStore((s) => s.clearAvailableUpdate)

  useEffect(() => {
    const unsubscribe = onAppUpdateAvailable((payload) => {
      // Background/periodic detection lights up the top-right badge instead of interrupting with a modal.
      setAvailableUpdate(payload)
    })

    // Pull buffered auto-check result if main finished before React subscribed
    void ipcClient
      .invoke('app.getPendingUpdate', {})
      .then((response: { update?: AppUpdateAvailableInfo | null } | null) => {
        if (response?.update) setAvailableUpdate(response.update)
      })
      .catch(() => {
        /* silent */
      })

    return () => {
      unsubscribe()
    }
  }, [setAvailableUpdate])

  if (!dialogOpen || !availableUpdate) return null

  return (
    <AppUpdateDialog
      info={availableUpdate}
      onDismiss={closeDialog}
      onIgnore={clearAvailableUpdate}
    />
  )
}
