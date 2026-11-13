import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKSPACE_TEXT_MAX_BYTES } from '@shared/workspace-preview'
import MarkdownView from '@renderer/features/timeline/markdown-view'
import { guessLangFromPath } from '@renderer/lib/shiki-highlighter'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { OverlayScrollHost2D } from '@renderer/components/ui/overlay-scrollbar'
import { joinWorkspacePath } from './path-utils'
import { resolveFilePreviewMode } from './file-preview-mode'
import { PREVIEW_MD_MAX_CHARS, PREVIEW_MD_MAX_LINES, PREVIEW_READ_MAX_BYTES } from './file-preview-limits'
import { FileSourcePreview } from './file-source-preview'
import { FileTextEditor } from './file-text-editor'
import { FileImagePreview } from './file-image-preview'
import { FilePreviewFind } from './file-preview-find'
import { useUIStore } from '@renderer/stores/ui-store'
import { clearFileDraft, getFileDraft, putFileDraft } from './file-edit-guard'
import { toast } from 'sonner'

type ReadTextFn = (
  p: string,
  opts?: { maxBytes?: number },
) => Promise<{ ok: boolean; content?: string; error?: string; size?: number; truncated?: boolean }>

function FilePreviewScroll({ children, scrollClassName }: { children: ReactNode; scrollClassName?: string }) {
  return (
    <OverlayScrollHost2D
      className="files-preview-scroll-host min-h-0 min-w-0 flex-1"
      scrollClassName={cn('min-h-full', scrollClassName)}
      showRailOnHostHover
    >
      {children}
    </OverlayScrollHost2D>
  )
}

function PlainTextFill({ content }: { content: string }) {
  return (
    <FilePreviewScroll scrollClassName="px-4 py-3">
      <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {content}
      </pre>
    </FilePreviewScroll>
  )
}

// Opaque-origin sandbox: scripts cannot access host APIs; HTTPS preview assets remain available.
const htmlPolicy = "default-src 'none'; script-src 'unsafe-inline' https: data: blob:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
const escapeScript = "window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();parent.postMessage('pi-desktop:exit-file-preview','*')}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();parent.postMessage('pi-desktop:find-file-preview','*')}},true);window.addEventListener('message',e=>{if(e.data?.type==='pi-desktop:find-in-preview'&&e.data.query)window.find(e.data.query,false,!!e.data.backwards,true)})"

export function FilePreviewRouter({
  workspaceRoot,
  relativePath,
  readText,
  fill = false,
  refreshKey = 0,
  sourceLocation,
  onExitExpandedPreview,
}: {
  workspaceRoot: string
  relativePath: string | null
  readText: ReadTextFn
  fill?: boolean
  refreshKey?: number
  sourceLocation?: { line: number } | null
  onExitExpandedPreview?: () => void
}) {
  const { t } = useTranslation('files')
  const [content, setContent] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fullReadPath, setFullReadPath] = useState<string | null>(null)
  const [localRefresh, setLocalRefresh] = useState(0)
  const [editing, setEditing] = useState(false)
  const [wordWrap, setWordWrap] = useState(() => { try { return localStorage.getItem('pi-desktop:file-word-wrap') === 'true' } catch { return false } })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [finding, setFinding] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const loadedPath = useRef('')
  const dirtyRef = useRef(false)
  const editingRef = useRef(false)
  const mode = relativePath ? resolveFilePreviewMode(relativePath) : null
  const absPath = relativePath ? joinWorkspacePath(workspaceRoot, relativePath) : ''
  const maxBytes = mode === 'html' || sourceLocation || fullReadPath === absPath ? WORKSPACE_TEXT_MAX_BYTES : PREVIEW_READ_MAX_BYTES
  const htmlDocument = useMemo(() => content == null ? '' :
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${htmlPolicy}"><script>${escapeScript}</script>${content}`, [content])
  const dirty = editing && draft !== (content ?? '')
  dirtyRef.current = dirty
  editingRef.current = editing
  const editable = !!relativePath && content !== null && !truncated && (mode === 'code' || mode === 'markdown' || mode === 'html' || mode === 'text')

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frameRef.current && event.source === frameRef.current.contentWindow && event.data === 'pi-desktop:exit-file-preview') {
        onExitExpandedPreview?.()
      }
      if (frameRef.current && event.source === frameRef.current.contentWindow && event.data === 'pi-desktop:find-file-preview') setFinding(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onExitExpandedPreview])

  useEffect(() => {
    if (editing) return
    const onKey = (event: KeyboardEvent) => {
      if (useUIStore.getState().activePanel !== 'files' || !(event.ctrlKey || event.metaKey)) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]') && !previewRef.current?.contains(event.target)) return
      if (event.key.toLowerCase() === 'a') {
        const root = previewRef.current
        const selection = window.getSelection()
        const target = root?.querySelector('.files-preview-scroll-host')
        if (!root || !target || !selection || (!root.contains(event.target as Node) && !root.contains(selection.anchorNode))) return
        const range = document.createRange()
        range.selectNodeContents(target)
        selection.removeAllRanges()
        selection.addRange(range)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      event.stopPropagation()
      setFinding(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editing])

  useEffect(() => {
    let cancelled = false
    const pathChanged = loadedPath.current !== absPath
    if (!pathChanged && dirtyRef.current) return
    loadedPath.current = absPath
    setContent(null)
    if (pathChanged) setEditing(false)
    setLoadError(null)
    setTruncated(false)
    setImageUrl(null)
    if (!relativePath || !mode || mode === 'pdf' || mode === 'binary' || mode === 'sheet') {
      setLoading(false)
      return
    }
    setLoading(true)
    const load = async () => {
      try {
        if (mode === 'image') {
          const result = await ipcClient.invoke('shell.readImagePreview', { workspaceRoot, path: relativePath })
          if (cancelled) return
          if (result?.ok && result.dataUrl) setImageUrl(result.dataUrl)
          else setLoadError(result?.error || 'preview_failed')
        } else {
          const result = await readText(relativePath, { maxBytes })
          if (cancelled) return
          if (!result.ok) setLoadError(result.error || 'read_failed')
          else {
            const text = result.content ?? ''
            const isTruncated = result.truncated ?? (result.size != null && result.size > maxBytes)
            const cached = relativePath ? getFileDraft(workspaceRoot, relativePath) : undefined
            setContent(cached?.original ?? text)
            setTruncated(isTruncated)
            if (cached && !isTruncated) {
              setDraft(cached.value)
              setEditing(true)
            } else if (!pathChanged && editingRef.current) setDraft(text)
            else if (pathChanged && mode !== 'markdown' && !isTruncated && !sourceLocation) {
              setDraft(text)
              setEditing(true)
            }
          }
        }
      } catch {
        if (!cancelled) setLoadError('read_failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [absPath, workspaceRoot, relativePath, mode, readText, maxBytes, refreshKey, localRefresh])

  const save = async () => {
    if (!relativePath || saving || !dirty) return
    setSaving(true)
    try {
      const current = await readText(relativePath, { maxBytes: WORKSPACE_TEXT_MAX_BYTES })
      if (!current.ok || current.truncated) throw new Error('read_failed')
      if (current.content !== content && !window.confirm(t('preview.externalChange'))) return
      const result = await ipcClient.invoke('workspace.fs.writeText', { workspaceRoot, path: relativePath, content: draft })
      if (!result?.ok) throw new Error(result?.error || 'write_failed')
      setContent(draft)
      clearFileDraft(workspaceRoot, relativePath)
      if (relativePath.replace(/\\/g, '/').toLowerCase() === '.vscode/tasks.json') window.dispatchEvent(new CustomEvent('pi-desktop:workspace-tasks-changed', { detail: workspaceRoot }))
      toast.success(t('preview.saved'))
    } catch {
      toast.error(t('preview.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const openExternal = () => void ipcClient.invoke('shell.openPath', { path: absPath }).then((result) => {
    if (!result?.ok) toast.error(t('common:sidebar.revealFailed'))
  }).catch(() => toast.error(t('common:sidebar.revealFailed')))
  const wrap = (node: ReactNode) => (
    <div ref={previewRef} className={cn('flex min-h-0 min-w-0 flex-col', fill && 'flex-1')}>
      {finding && !editing ? <FilePreviewFind container={previewRef} frame={frameRef} revision={`${loading}:${content ?? ''}`} onClose={() => setFinding(false)} /> : null}
      {truncated && !loading && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2 text-[11px] text-foreground-secondary">
          <span>{t(maxBytes < WORKSPACE_TEXT_MAX_BYTES ? 'preview.truncated' : 'preview.previewLimit')}</span>
          {maxBytes < WORKSPACE_TEXT_MAX_BYTES && (
            <button type="button" className="text-accent hover:underline" onClick={() => setFullReadPath(absPath)}>{t('preview.tryExpandRead')}</button>
          )}
          <button type="button" className="text-accent hover:underline" onClick={openExternal}>{t('preview.openInSystem')}</button>
        </div>
      )}
      {node}
    </div>
  )
  const editorBar = editable || editing ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px]">
      <div className="flex gap-1">
        <button type="button" aria-pressed={editing} className={cn('rounded px-2 py-1 text-foreground', editing ? 'bg-muted font-semibold' : 'hover:bg-muted')} onClick={() => { if (!editing) { setDraft(content ?? ''); setEditing(true) } }}>{t('preview.edit')}</button>
        <button type="button" aria-pressed={!editing} className={cn('rounded px-2 py-1 text-foreground', !editing ? 'bg-muted font-semibold' : 'hover:bg-muted')} onClick={() => { if (editing && (!dirty || window.confirm(t('preview.discardEdits')))) { if (relativePath) clearFileDraft(workspaceRoot, relativePath); setEditing(false); if (dirty) setLocalRefresh((current) => current + 1) } }}>{t('preview.ready')}</button>
      </div>
      {dirty ? <span className="text-amber-600">{t('preview.unsaved')}</span> : null}
      {editing ? <label className="ml-auto flex shrink-0 items-center gap-1 text-foreground-secondary"><input type="checkbox" checked={wordWrap} onChange={(event) => { const enabled = event.target.checked; setWordWrap(enabled); try { localStorage.setItem('pi-desktop:file-word-wrap', String(enabled)) } catch { void 0 } }} />{t('preview.wordWrap')}</label> : null}
      {editing ? <button type="button" className="text-accent hover:underline disabled:opacity-50" disabled={!dirty || saving} onClick={() => void save()}>{saving ? t('preview.saving') : t('preview.save')}</button> : null}
    </div>
  ) : null

  if (!relativePath) return wrap(<p className="px-3 py-8 text-center text-[12px] text-foreground-secondary/80">{t('preview.pickFile')}</p>)
  if (loading) return wrap(<p className="px-3 py-6 text-[12px] text-foreground-secondary/80">{t('preview.loading')}</p>)
  if (loadError) {
    const key = loadError === 'too_large' ? 'tooLarge' : loadError === 'binary' ? 'binary' : loadError === 'not_found' ? 'deleted' : 'error'
    return wrap(<div className="space-y-2 px-3 py-6 text-[12px] text-foreground-secondary"><p>{t(`preview.${key}`)}</p><button type="button" className="text-accent hover:underline" onClick={openExternal}>{t('preview.openInSystem')}</button></div>)
  }
  if (mode === 'image') return wrap(imageUrl ? <FileImagePreview src={imageUrl} name={relativePath} /> : null)
  if (mode === 'pdf' || mode === 'binary' || mode === 'sheet') return wrap(<div className="space-y-2 px-3 py-6 text-[12px] text-foreground-secondary"><p>{t(mode === 'pdf' ? 'preview.pdf' : 'preview.binary')}</p><button type="button" className="text-accent hover:underline" onClick={openExternal}>{t('preview.openInSystem')}</button></div>)
  if (content == null) return wrap(null)
  if (editing) return wrap(<>{editorBar}<FileTextEditor path={relativePath} value={draft} saving={saving} wordWrap={wordWrap} onChange={(value) => { setDraft(value); putFileDraft(workspaceRoot, relativePath, content, value) }} onSave={() => void save()} /></>)
  if (sourceLocation) return wrap(<FileSourcePreview code={content} lang={guessLangFromPath(relativePath)} path={relativePath} fill={fill} sourceLocation={sourceLocation} />)
  if (mode === 'html' && !truncated) return wrap(<><div>{editorBar}</div><iframe ref={frameRef} title="html-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={htmlDocument} className="min-h-0 w-full flex-1 border-0 bg-[var(--bg-base)]" /></>)
  if (mode === 'markdown' && !truncated && content.length <= PREVIEW_MD_MAX_CHARS && content.split('\n').length <= PREVIEW_MD_MAX_LINES) return wrap(<><div>{editorBar}</div><FilePreviewScroll scrollClassName="px-4 py-3"><MarkdownView baseDirectory={joinWorkspacePath(workspaceRoot, relativePath.split('/').slice(0, -1).join('/'))}>{content}</MarkdownView></FilePreviewScroll></>)
  if (mode === 'code') return wrap(<><div>{editorBar}</div><FileSourcePreview code={content} lang={guessLangFromPath(relativePath)} path={relativePath} fill={fill} /></>)
  return wrap(<><div>{editorBar}</div><PlainTextFill content={content} /></>)
}
