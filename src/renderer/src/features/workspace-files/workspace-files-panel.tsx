import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Maximize2, Minus, RefreshCw, Search } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { getAttachmentKind } from '@renderer/features/composer/attachments'
import { ipcClient } from '@renderer/lib/ipc-client'
import { toast } from 'sonner'
import { useWorkspaceFs } from './use-workspace-fs'
import { FilePreviewRouter } from './file-preview-router'
import { clearFileDraft, getFileDraft, moveFileDrafts } from './file-edit-guard'
import { FileTree } from './file-tree'
import { FilesContextMenuPortal, type FilesCtxTarget } from './files-context-menu-portal'
import { openTerminalAt } from '@renderer/features/terminal/terminal-run-bar'
import { FilePreviewTabBar } from './file-preview-tab-bar'
import { useFilePreviewTabs } from './use-file-preview-tabs'
import { RenamePromptDialog } from '@renderer/features/workspace/rename-prompt-dialog'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import type { WorkspaceFsSearchEntry } from '@shared/ipc-contract'
import { workspacePathKey } from '@shared/workspace-path'

type RenameTarget = Pick<FilesCtxTarget, 'abs' | 'name' | 'rel'>

export function WorkspaceFilesPanel() {
  const { t } = useTranslation('files')
  const panelRef = useRef<HTMLDivElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const workspaceRoot = useUIStore((s) => s.currentWorkspace)
  const workspaceFileToOpen = useUIStore((s) => s.workspaceFileToOpen)
  const activePanel = useUIStore((s) => s.activePanel)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)
  const rightPanelCollapsed = useRightPanelHidden()
  const revealRightPanel = useUIStore((s) => s.revealRightPanel)
  const preferenceKey = `pi-desktop:file-panel:${workspacePathKey(workspaceRoot)}`
  const [initialPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(preferenceKey) || '{}') as { showDotfiles?: boolean; explorerCollapsed?: boolean; searchQuery?: string } }
    catch { return {} }
  })
  const [showDotfiles, setShowDotfiles] = useState(typeof initialPrefs.showDotfiles === 'boolean' ? initialPrefs.showDotfiles : true)
  const { listDir, readText } = useWorkspaceFs(workspaceRoot, showDotfiles)
  const {
    tabs,
    activeTab,
    openFile,
    closeTab,
    activateTab,
    reorderTabs,
    togglePin,
    renameTabRel,
  } = useFilePreviewTabs(workspaceRoot)
  const [explorerCollapsed, setExplorerCollapsed] = useState(typeof initialPrefs.explorerCollapsed === 'boolean' ? initialPrefs.explorerCollapsed : false)
  const [searchQuery, setSearchQuery] = useState(typeof initialPrefs.searchQuery === 'string' ? initialPrefs.searchQuery : '')
  const [searchResults, setSearchResults] = useState<WorkspaceFsSearchEntry[]>([])
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [treeEpoch, setTreeEpoch] = useState(0)
  const [collapseEpoch, setCollapseEpoch] = useState(0)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const [sourceLocation, setSourceLocation] = useState<{ rel: string; line: number } | null>(null)
  const [gitDiffPreview, setGitDiffPreview] = useState<{ rel: string; patch: string; staged: boolean; status: string } | null>(null)
  const [menu, setMenu] = useState<FilesCtxTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ abs: string; name: string; rel: string; isDirectory: boolean } | null>(null)
  const [createTarget, setCreateTarget] = useState<{ rel: string; isDirectory: boolean } | null>(null)
  const [treeSelection, setTreeSelection] = useState<{ rel: string; isDirectory: boolean } | null>(null)
  const [copiedTreeFile, setCopiedTreeFile] = useState<string | null>(null)

  const selectedPath = (treeSelection?.isDirectory ? treeSelection.rel : null) ?? activeTab?.rel ?? null
  const previewPath = activeTab?.rel ?? null
  const explorerHidden = explorerCollapsed && !!activeTab

  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify({ showDotfiles, explorerCollapsed, searchQuery })) } catch { void 0 }
  }, [preferenceKey, showDotfiles, explorerCollapsed, searchQuery])

  useEffect(() => {
    setTreeSelection(null)
    setCopiedTreeFile(null)
    setGitDiffPreview(null)
  }, [workspaceRoot])

  useEffect(() => {
    if (!workspaceRoot || !searchQuery.trim()) {
      setSearchResults([])
      setSearchState('idle')
      return
    }
    let cancelled = false
    setSearchState('loading')
    const timer = window.setTimeout(() => {
      void ipcClient.invoke('workspace.fs.search', { workspaceRoot, query: searchQuery.trim(), maxResults: 200, includeIgnored: true })
        .then((result) => {
          if (cancelled) return
          setSearchResults(result.ok ? result.entries : [])
          setSearchState(result.ok ? 'done' : 'error')
        }).catch(() => { if (!cancelled) setSearchState('error') })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [workspaceRoot, searchQuery])

  useEffect(() => {
    if (activePanel !== 'files' || !previewPath) {
      useUIStore.setState({ filesPreviewChatExpand: false })
    }
  }, [activePanel, previewPath])

  const exitExpandedPreview = useCallback(() => {
    useUIStore.setState({ filesPreviewChatExpand: false })
    expandButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!filesPreviewChatExpand || rightPanelCollapsed) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return
      event.preventDefault()
      event.stopPropagation()
      exitExpandedPreview()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [filesPreviewChatExpand, rightPanelCollapsed, exitExpandedPreview])

  useEffect(() => {
    return () => {
      useUIStore.setState({ filesPreviewChatExpand: false })
    }
  }, [])

  useEffect(() => {
    // Refresh preview only when the files panel is the active right-panel tab and visible.
    // Collapsed right panel unmounts this host entirely (see app.tsx); no idle 2s reread.
    if (!activeTab || activePanel !== 'files') return
    if (rightPanelCollapsed) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      setPreviewRefreshKey((previous) => previous + 1)
    }
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeTab?.rel, activePanel, rightPanelCollapsed])

  const toggleChatPreviewExpand = useCallback(() => {
    if (!previewPath) return
    if (!filesPreviewChatExpand) {
      if (rightPanelCollapsed) revealRightPanel()
      useUIStore.setState({ filesPreviewChatExpand: true })
      return
    }
    useUIStore.setState({ filesPreviewChatExpand: false })
  }, [previewPath, filesPreviewChatExpand, rightPanelCollapsed, revealRightPanel])

  const onSelectPath = useCallback(
    (rel: string, isDirectory: boolean, opts?: { openInNewTab?: boolean }) => {
      void ipcClient.invoke('workspace.fs.clipboardDebug', {
        stage: 'tree-select', target: rel, detail: isDirectory ? 'directory' : 'file',
      }).catch(() => undefined)
      setTreeSelection(isDirectory ? { rel, isDirectory: true } : null)
      if (isDirectory) return
      setGitDiffPreview(null)
      setSourceLocation(null)
      const name = rel.split('/').pop() || rel
      openFile(rel, name, opts?.openInNewTab ? 'new-tab' : 'replace')
      if (panelRef.current && panelRef.current.clientWidth <= 480 && !filesPreviewChatExpand) {
        setExplorerCollapsed(true)
      }
    },
    [openFile, filesPreviewChatExpand],
  )

  const recordClipboardDebug = useCallback((
    stage: string,
    details: { source?: string; target?: string; detail?: string } = {},
  ) => {
    const entry = { stage, ...details }
    console.info('[workspace-file-paste]', entry)
    void ipcClient.invoke('workspace.fs.clipboardDebug', entry).catch((error) => {
      console.warn('[workspace-file-paste] log IPC failed', error)
    })
  }, [])

  const pasteFilesIntoSelection = useCallback(async (sourcePaths: string[], sourceIsWorkspaceRelative: boolean) => {
    if (!workspaceRoot || sourcePaths.length === 0) {
      recordClipboardDebug('paste-files', { detail: `ignored: root=${!!workspaceRoot}, count=${sourcePaths.length}` })
      return
    }
    const selected = treeSelection
    const targetDirectory = selected?.isDirectory
      ? selected.rel
      : selected?.rel.includes('/')
        ? selected.rel.slice(0, selected.rel.lastIndexOf('/'))
        : '.'
    let copied = 0
    let collision = 0
    let failed = 0
    for (const sourcePath of sourcePaths) {
      const sourceLabel = sourceIsWorkspaceRelative
        ? sourcePath
        : sourcePath.split(/[\\/]/).pop() || 'unknown'
      recordClipboardDebug('copy-start', { source: sourceLabel, target: targetDirectory })
      const result = await ipcClient.invoke('workspace.fs.copyFile', {
        workspaceRoot,
        sourcePath,
        targetDirectory,
        sourceIsWorkspaceRelative,
      })
      if (result?.ok) {
        copied += 1
        recordClipboardDebug('copy-complete', { source: sourceLabel, target: targetDirectory })
      } else {
        if (result?.error === 'target_exists') collision += 1
        else failed += 1
        recordClipboardDebug('copy-failed', { source: sourceLabel, target: targetDirectory, detail: String(result?.error || 'no result') })
      }
    }
    if (copied) {
      setTreeEpoch((n) => n + 1)
      toast.success(t(copied === 1 ? 'toast.pastedOne' : 'toast.pastedMany', { count: copied }))
    }
    if (collision) toast.warning(t(collision === 1 ? 'toast.pasteConflictOne' : 'toast.pasteConflictMany', { count: collision }))
    if (failed) toast.error(t(failed === 1 ? 'toast.pasteFailedOne' : 'toast.pasteFailedMany', { count: failed }))
  }, [workspaceRoot, treeSelection, t, recordClipboardDebug])

  useEffect(() => {
    if (activePanel !== 'files') return
    const hasTreeFocus = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false
      return !!target.closest('[data-file-tree-row="true"]')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key !== 'c' && key !== 'v') return
      const treeFocus = hasTreeFocus(event.target)
      const targetElement = event.target instanceof Element ? event.target : null
      const row = targetElement?.closest<HTMLElement>('[data-file-tree-row="true"]')
      recordClipboardDebug('shortcut-keydown', {
        target: treeSelection?.rel || activeTab?.rel || '.',
        detail: `key=${key}, ctrl=${event.ctrlKey}, meta=${event.metaKey}, treeFocus=${treeFocus}, tag=${targetElement?.tagName || 'none'}, row=${row?.getAttribute('title') || ''}, copied=${copiedTreeFile || ''}`,
      })
      if (!treeFocus) return
      if (key === 'c') {
        const rel = row?.getAttribute('title')
        const directory = row?.getAttribute('aria-expanded') !== null
        if (!rel || directory) return
        event.preventDefault()
        event.stopPropagation()
        recordClipboardDebug('copy-keydown', { source: rel, detail: `target=${(event.target as Element).tagName}` })
        setCopiedTreeFile(rel)
        recordClipboardDebug('copy-captured', { source: rel })
        toast.message(t('toast.fileCopied'))
      } else if (key === 'v' && copiedTreeFile) {
        // Non-editable tree rows do not reliably receive Chromium's native paste event.
        event.preventDefault()
        event.stopPropagation()
        void pasteFilesIntoSelection([copiedTreeFile], true)
        setCopiedTreeFile(null)
      }
    }
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const activeElement = document.activeElement
      const treeHasFocus = !!target?.closest('[data-file-tree-row="true"]')
        || (activeElement instanceof Element && !!activeElement.closest('[data-file-tree-row="true"]'))
      recordClipboardDebug('paste-event', {
        target: treeSelection?.rel || activeTab?.rel || '.',
        detail: `treeFocus=${treeHasFocus}, targetTag=${target?.tagName || 'none'}, files=${event.clipboardData?.files.length || 0}`,
      })
      if (!treeHasFocus) return
      const files = [...(event.clipboardData?.files ?? [])]
      recordClipboardDebug('paste-files', {
        target: treeSelection?.rel || activeTab?.rel || '.',
        detail: `clipboard files=${files.map((file) => file.name).join(',') || '(none)'}`,
      })
      const externalPaths = files.flatMap((file) => {
        try {
          const path = window.piDesktop?.getPathForFile(file)
          return path ? [path] : []
        } catch { return [] }
      })
      if (externalPaths.length) {
        event.preventDefault()
        void pasteFilesIntoSelection(externalPaths, false)
        return
      }
      if (copiedTreeFile) {
        event.preventDefault()
        void pasteFilesIntoSelection([copiedTreeFile], true)
        setCopiedTreeFile(null)
      }
    }
    const clearInternalClipboardWhenLeavingApp = () => {
      recordClipboardDebug('app-blur', { source: copiedTreeFile || '' })
      setCopiedTreeFile(null)
    }
    const onTreeFocus = (event: FocusEvent) => {
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-file-tree-row="true"]') : null
      if (row) recordClipboardDebug('tree-focus', { target: row.getAttribute('title') || '.', detail: `tag=${(event.target as Element).tagName}` })
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('paste', onPaste, true)
    window.addEventListener('blur', clearInternalClipboardWhenLeavingApp)
    window.addEventListener('focusin', onTreeFocus, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('paste', onPaste, true)
      window.removeEventListener('blur', clearInternalClipboardWhenLeavingApp)
      window.removeEventListener('focusin', onTreeFocus, true)
    }
  }, [activePanel, activeTab?.rel, copiedTreeFile, pasteFilesIntoSelection, recordClipboardDebug, t, treeSelection?.rel])

  useEffect(() => {
    if (!workspaceFileToOpen) return
    useUIStore.setState({ workspaceFileToOpen: null })
    if (workspaceFileToOpen.workspaceRoot === workspaceRoot) {
      setShowDotfiles(true)
      setSearchQuery('')
      onSelectPath(workspaceFileToOpen.rel, false)
      setExplorerCollapsed(false)
      if (workspaceFileToOpen.line) setSourceLocation({ rel: workspaceFileToOpen.rel, line: workspaceFileToOpen.line })
      if (workspaceFileToOpen.gitDiff) setGitDiffPreview({ rel: workspaceFileToOpen.rel, ...workspaceFileToOpen.gitDiff })
    }
  }, [workspaceFileToOpen, workspaceRoot, onSelectPath])

  const refreshPreview = useCallback(() => {
    setTreeEpoch((n) => n + 1)
    setPreviewRefreshKey((n) => n + 1)
  }, [])

  const chromeTrailing = (
    <>
      <button
        type="button"
        className="chrome-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        title={t('chrome.refresh')}
        aria-label={t('chrome.refresh')}
        disabled={!previewPath}
        onClick={refreshPreview}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
      <button
        ref={expandButtonRef}
        type="button"
        className={cn(
          'chrome-icon-btn flex h-7 shrink-0 items-center justify-center gap-1 rounded-md',
          filesPreviewChatExpand ? 'bg-[var(--bg-active)] px-2 text-[11px] text-foreground' : 'w-7',
        )}
        title={filesPreviewChatExpand ? t('chrome.collapsePreview') : t('chrome.expandPreview')}
        aria-label={filesPreviewChatExpand ? t('chrome.collapsePreview') : t('chrome.expandPreview')}
        aria-expanded={filesPreviewChatExpand}
        disabled={!previewPath && !filesPreviewChatExpand}
        onClick={toggleChatPreviewExpand}
      >
        {filesPreviewChatExpand ? <><ChevronRight className="h-3.5 w-3.5" /><span>{t('chrome.collapsePreview')}</span></> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className="chrome-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        title={explorerHidden ? t('chrome.expandExplorer') : t('chrome.collapseExplorer')}
        aria-label={explorerHidden ? t('chrome.expandExplorer') : t('chrome.collapseExplorer')}
        disabled={!previewPath}
        onClick={() => setExplorerCollapsed(!explorerHidden)}
      >
        {explorerHidden ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
    </>
  )

  const attachToComposer = useCallback(
    (abs: string, name: string, isDirectory = false) => {
      // 文件夹按「@路径 引用」进输入框（和拖拽一致），agent 自己 ls/read 里面的内容
      const kind = isDirectory ? 'dir' : getAttachmentKind(name)
      window.dispatchEvent(
        new CustomEvent('pi-desktop:composer-attach-files', {
          detail: { files: [{ path: abs, name, kind }] },
        }),
      )
      toast.message(t('toast.attached'))
    },
    [t],
  )

  const onContextMenuEntry = useCallback(
    (e: React.MouseEvent, abs: string, name: string, rel: string, isDirectory: boolean) => {
      e.preventDefault()
      e.stopPropagation()
      setMenu({ x: e.clientX, y: e.clientY, abs, name, rel, isDirectory })
    },
    [],
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  const bumpTree = () => setTreeEpoch((n) => n + 1)

  const submitDelete = async () => {
    if (!workspaceRoot || !deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    const res = await ipcClient.invoke('workspace.fs.trash', {
      workspaceRoot,
      relativePath: target.rel,
    })
    if (!res?.ok) {
      toast.error(res?.error === 'not_found' ? t('toast.deleteMissing') : t('toast.deleteFailed'))
      return
    }
    // 关掉已经打开的预览页：删掉的正是它，或它在被删的文件夹里面
    for (const tab of tabs) {
      if (tab.rel === target.rel || tab.rel.startsWith(`${target.rel}/`)) {
        clearFileDraft(workspaceRoot, tab.rel)
        closeTab(tab.id)
      }
    }
    bumpTree()
    toast.message(t('toast.deleted'))
  }

  const submitRename = async () => {
    if (!workspaceRoot || !renameTarget) return
    const name = renameValue.trim()
    if (!name) return
    const res = await ipcClient.invoke('workspace.fs.rename', {
      workspaceRoot,
      relativePath: renameTarget.rel,
      newName: name,
    })
    setRenameOpen(false)
    setRenameTarget(null)
    if (!res?.ok) {
      toast.error(t('toast.renameFailed'))
      return
    }
    const newRel = res.newRelativePath as string
    moveFileDrafts(workspaceRoot, renameTarget.rel, newRel)
    renameTabRel(renameTarget.rel, newRel, name)
    bumpTree()
    toast.message(t('toast.renamed'))
  }

  if (!workspaceRoot) {
    return (
      <p className="px-4 py-8 text-center text-[12px] text-foreground-secondary/80">{t('empty.noWorkspace')}</p>
    )
  }

  return (
    <div ref={panelRef} className="workspace-files-panel flex h-full min-h-0 flex-col">
      <FilePreviewTabBar
        workspaceRoot={workspaceRoot}
        tabs={tabs}
        activeId={activeTab?.id ?? null}
        onActivate={activateTab}
        onClose={(id) => {
          const target = tabs.find((tab) => tab.id === id)
          if (!target || (getFileDraft(workspaceRoot, target.rel) && !window.confirm(t('preview.discardEdits')))) return
          clearFileDraft(workspaceRoot, target.rel)
          closeTab(id)
        }}
        onReorder={reorderTabs}
        onTogglePin={togglePin}
        trailing={chromeTrailing}
      />

      <div
        className={cn('files-split-grid min-h-0 flex-1', explorerHidden && 'files-split-grid--collapsed')}
        data-has-file={!!activeTab || undefined}
        style={{
          gridTemplateColumns: explorerHidden
            ? 'minmax(0, 1fr) 0px'
            : !activeTab
              ? '0px minmax(0, 1fr)'
              : 'minmax(0, 1fr) minmax(150px, min(240px, 38%))',
        }}
      >
        <div className="files-preview-scroll flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-base)]">
          {activeTab ? (
            <FilePreviewRouter
              key={activeTab.id}
              workspaceRoot={workspaceRoot}
              relativePath={activeTab.rel}
              readText={readText}
              fill
              refreshKey={previewRefreshKey}
              sourceLocation={sourceLocation?.rel === activeTab.rel ? sourceLocation : null}
              gitDiff={gitDiffPreview?.rel === activeTab.rel ? gitDiffPreview : null}
              onExitExpandedPreview={exitExpandedPreview}
            />
          ) : (
            <p className="flex flex-1 items-center justify-center px-3 py-8 text-center text-[12px] text-foreground-secondary/80">
              {t('preview.pickFile')}
            </p>
          )}
        </div>

        <div className="files-explorer-rail flex min-h-0 min-w-0 flex-col overflow-hidden" onContextMenu={(event) => {
          if (event.target instanceof Element && event.target.closest('input, textarea, button, [contenteditable="true"]')) return
          onContextMenuEntry(event, workspaceRoot, workspaceRoot.split(/[\\/]/).pop() || workspaceRoot, '', true)
        }}>
          <div className="files-explorer-toolbar flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-2 py-2">
            <div className="workbench-search files-search min-w-0 flex-1">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                className="w-full"
              />
            </div>
            <button
              type="button"
              title={t('tree.dotfiles')}
              aria-label={t('tree.dotfiles')}
              aria-pressed={showDotfiles}
              className="workbench-icon"
              onClick={() => setShowDotfiles((v) => !v)}
            >
              {showDotfiles ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title={t('chrome.refresh')}
              aria-label={t('chrome.refresh')}
              className="workbench-icon"
              onClick={refreshPreview}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={t('tree.collapseAll')}
              aria-label={t('tree.collapseAll')}
              className="workbench-icon"
              onClick={() => setCollapseEpoch((n) => n + 1)}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
          <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="px-1.5 pb-2">
            {searchQuery.trim() ? (
              <div className="py-1 text-[12px]">
                {searchState === 'loading' ? <p className="px-2 py-2 text-foreground-secondary">{t('search.loading')}</p> : null}
                {searchState === 'error' ? <p className="px-2 py-2 text-destructive">{t('search.failed')}</p> : null}
                {searchState === 'done' && !searchResults.length ? <p className="px-2 py-2 text-foreground-secondary">{t('search.empty')}</p> : null}
                {searchResults.map((entry) => (
                  <button key={entry.path} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-muted" title={entry.path}
                    onClick={() => { if (entry.isDirectory) setSearchQuery(`${entry.path}/`); else onSelectPath(entry.path, false) }}
                    onContextMenu={(event) => onContextMenuEntry(event, `${workspaceRoot}/${entry.path}`, entry.name, entry.path, entry.isDirectory)}>
                    <span className="block truncate text-foreground">{entry.name}</span><span className="block truncate text-[10px] text-foreground-tertiary">{entry.path}</span>
                  </button>
                ))}
                {searchResults.length >= 200 ? <p className="px-2 py-2 text-foreground-tertiary">{t('search.limit')}</p> : null}
              </div>
            ) : <FileTree
              key={treeEpoch}
              workspaceRoot={workspaceRoot}
              listDir={listDir}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              searchQuery={searchQuery}
              collapseEpoch={collapseEpoch}
              onContextMenuEntry={onContextMenuEntry}
            />}
          </OverlayScrollHost>
        </div>
      </div>

      <FilesContextMenuPortal
        menu={menu}
        onClose={closeMenu}
        onPreview={() => {
          if (!menu || menu.isDirectory) return
          onSelectPath(menu.rel, false)
        }}
        onOpenInNewTab={() => {
          if (!menu || menu.isDirectory) return
          onSelectPath(menu.rel, false, { openInNewTab: true })
        }}
        onAttach={() => {
          if (!menu) return
          attachToComposer(menu.abs, menu.name, menu.isDirectory)
        }}
        onCopyPath={() => {
          if (!menu) return
          void navigator.clipboard.writeText(menu.abs)
          toast.message(t('toast.copied'))
        }}
        onCopyRel={() => {
          if (!menu) return
          void navigator.clipboard.writeText(menu.rel)
          toast.message(t('toast.copied'))
        }}
        onNewFile={() => {
          if (!menu) return
          setCreateTarget({ rel: menu.rel, isDirectory: false })
        }}
        onNewFolder={() => {
          if (!menu) return
          setCreateTarget({ rel: menu.rel, isDirectory: true })
        }}
        onSearchInFolder={() => {
          if (!menu) return
          setSearchQuery(`${menu.rel.replace(/\\/g, '/')}/`)
        }}
        onRename={() => {
          if (!menu) return
          setRenameTarget({ abs: menu.abs, name: menu.name, rel: menu.rel })
          setRenameValue(menu.name)
          setRenameOpen(true)
        }}
        onDelete={() => {
          if (!menu) return
          setDeleteTarget({ abs: menu.abs, name: menu.name, rel: menu.rel, isDirectory: menu.isDirectory })
        }}
        onReveal={() => {
          if (!menu) return
          void ipcClient.invoke('shell.showItemInFolder', { path: menu.abs })
        }}
        onNewTerminal={() => {
          if (!menu) return
          const cwd = menu.isDirectory ? menu.abs : menu.abs.slice(0, Math.max(menu.abs.lastIndexOf('/'), menu.abs.lastIndexOf('\\')))
          void openTerminalAt(cwd)
        }}
      />

      <RenamePromptDialog
        open={!!createTarget}
        title={createTarget?.isDirectory ? t('menu.newFolder') : t('menu.newFile')}
        defaultValue=""
        onConfirm={async (name) => {
          if (!createTarget || !workspaceRoot) return
          const relativePath = [createTarget.rel.replace(/\\/g, '/'), name].filter(Boolean).join('/')
          const result = await ipcClient.invoke('workspace.fs.create', {
            workspaceRoot,
            relativePath,
            isDirectory: createTarget.isDirectory,
          })
          if (!result.ok) {
            toast.error(result.error || '创建失败')
            return
          }
          setCreateTarget(null)
          bumpTree()
        }}
        onCancel={() => setCreateTarget(null)}
      />
      {renameOpen && renameTarget
        ? createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[510] bg-black/20"
                aria-label="close"
                onClick={() => {
                  setRenameOpen(false)
                  setRenameTarget(null)
                }}
              />
              <div className="fixed left-1/2 top-1/2 z-[520] w-[min(320px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-4 shadow-xl">
                <p className="mb-2 text-[13px] font-medium text-foreground">{t('rename.title')}</p>
                <input
                  className="mb-3 w-full rounded-lg border border-border/60 bg-[var(--bg-1)] px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--focus-border)]"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename()
                    if (e.key === 'Escape') {
                      setRenameOpen(false)
                      setRenameTarget(null)
                    }
                  }}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-[12px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
                    onClick={() => {
                      setRenameOpen(false)
                      setRenameTarget(null)
                    }}
                  >
                    {t('rename.cancel')}
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-[var(--bg-active)] px-3 py-1.5 text-[12px] font-medium text-foreground hover:opacity-90"
                    onClick={() => void submitRename()}
                  >
                    {t('rename.confirm')}
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('delete.title')}
        message={t('delete.message', { name: deleteTarget?.name ?? '' })}
        destructive
        confirmLabel={t('delete.confirm')}
        onConfirm={() => void submitDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
