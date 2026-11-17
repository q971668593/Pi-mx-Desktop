import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { PythonRuntimeStatusResponse } from '@shared/ipc-contract'

export function PythonRuntimeSetupHost() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    void ipcClient.invoke('python.status', {}).then((status: PythonRuntimeStatusResponse) => {
      if (active && status.prompt) setOpen(true)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const dismiss = () => {
    setOpen(false)
    void ipcClient.invoke('python.dismissSetupPrompt', {}).catch(() => {})
  }

  const install = () => {
    setOpen(false)
    toast.info(t('settings:python.installing'))
    void ipcClient.invoke('python.installLatest', {}).then((status: PythonRuntimeStatusResponse) => {
      if (status.installed) toast.success(t('settings:python.installSuccess', { version: status.version }))
      else toast.error(t('settings:python.installFailed'))
    }).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('WINGET_NOT_FOUND')) {
        toast.error(t('settings:python.wingetMissing'))
        await ipcClient.invoke('python.openDownloads', {}).catch(() => {})
      } else {
        toast.error(t('settings:python.installFailed'))
      }
    })
  }

  return (
    <ConfirmDialog
      open={open}
      title={t('settings:python.firstRunTitle')}
      message={t('settings:python.firstRunMessage')}
      confirmLabel={t('settings:python.installButton')}
      onConfirm={install}
      onCancel={dismiss}
    />
  )
}
