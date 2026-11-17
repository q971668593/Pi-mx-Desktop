import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, RefreshCw, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { forkSessionFromEntry } from '@renderer/lib/session-fork'
import { capSessionTreeForDisplay } from '@renderer/features/rewind/session-tree-display-cap'
import {
  TREE_FILTER_OPTS,
  filterSessionTreeNodes,
  type SessionTreeNode,
  type TreeFilterMode,
} from '@renderer/features/rewind/session-tree-list'
import { SessionTreeMindMap } from './session-tree-mind-map'

export function SessionTreeOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const rawTree = useUIStore((s) => s.rewindTreeNodes) as SessionTreeNode[]
  const loading = useUIStore((s) => s.rewindLoadingTree)
  const treeError = useUIStore((s) => s.rewindTreeError)
  const [filter, setFilter] = useState<TreeFilterMode>('user-only')

  const refresh = useCallback(() => {
    if (sessionFile) void refreshSessionTree(sessionFile)
  }, [sessionFile])

  useEffect(() => {
    if (!open) return
    const tid = window.setTimeout(() => {
      if (sessionFile) void refreshSessionTree(sessionFile)
    }, 0)
    return () => clearTimeout(tid)
  }, [open, sessionFile])

  const filtered = useMemo(() => filterSessionTreeNodes(rawTree, filter), [rawTree, filter])
  const { nodes: visible, truncated, hiddenCount } = useMemo(
    () => capSessionTreeForDisplay(filtered),
    [filtered],
  )
  const rewind = useCallback(
    async (id: string) => {
      const node = rawTree.find((n) => n.id === id)
      if (!node) return
      if (node.isLeaf) {
        toast.info(t('timeline:treeAlreadyCurrent'))
        return
      }
      onClose()
      // 延迟一帧再跳转，确保浮层卸载不中断异步链
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await navigateSessionToEntry(id)
    },
    [rawTree, onClose, t],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.querySelector('[data-session-node-detail]')) return
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      data-tree-overlay
      className="overlay-backdrop fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal
      aria-label={t('timeline:treeTitle')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="overlay-panel flex max-h-[min(90vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold">{t('timeline:treeTitle')}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t('timeline:treeOverlayHint')}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="rounded-lg p-2 hover:bg-muted" title={t('common:refresh')} onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-lg p-2 hover:bg-muted" title={t('common:close')} onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border/40 px-4 py-2">
          {TREE_FILTER_OPTS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setFilter(o.key)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                filter === o.key ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>

        <div className="scrollbar-overlay flex min-h-0 flex-1 overflow-hidden px-2 py-2">
          {!sessionFile ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t('timeline:treeNoSession')}</p>
          ) : loading && rawTree.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('timeline:treeLoading')}
            </div>
          ) : treeError ? (
            <p className="px-3 py-8 text-center text-[12px] text-destructive">{t('timeline:treeLoadFailed', { error: treeError })}</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t('timeline:treeNoMatch')}</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-1">
              {truncated && <p className="shrink-0 px-2 text-center text-[11px] text-muted-foreground">{t('timeline:treeTruncated', { shown: visible.length, hidden: hiddenCount })}</p>}
              <SessionTreeMindMap
                nodes={visible}
                sourceNodes={rawTree}
                sessionFile={sessionFile}
                onContinue={(id) => void rewind(id)}
                onFork={(id) => void forkSessionFromEntry(id)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
