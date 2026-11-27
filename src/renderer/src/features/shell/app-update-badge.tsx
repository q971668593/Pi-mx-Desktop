import { useTranslation } from 'react-i18next'
import { CloudDownload } from '@renderer/components/icons'
import { useAppUpdateStore } from '@renderer/lib/app-update-notify'

/**
 * 顶栏右上角更新标志：定期检测到新版本时出现，点击打开更新详情与一键更新进度弹窗。
 */
export function AppUpdateBadge() {
  const { t } = useTranslation()
  const availableUpdate = useAppUpdateStore((s) => s.availableUpdate)
  const openDialog = useAppUpdateStore((s) => s.openDialog)

  if (!availableUpdate) return null

  const tooltip = t('update:badgeTooltip', { version: availableUpdate.latestVersion })

  return (
    <button
      type="button"
      data-testid="app-update-badge"
      onClick={() => openDialog()}
      title={tooltip}
      aria-label={tooltip}
      className="electron-no-drag inline-flex h-6 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 active:scale-[0.98]"
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <CloudDownload className="h-3.5 w-3.5 shrink-0" />
      <span>{t('update:badgeLabel')}</span>
    </button>
  )
}
