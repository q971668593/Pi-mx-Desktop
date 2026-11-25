import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WORKSPACE_TEXT_MAX_BYTES } from '@shared/workspace-preview'
import { ipcClient } from '@renderer/lib/ipc-client'

// Match the workspace HTML preview's opaque-origin sandbox and content policy.
const policy = "default-src 'none'; script-src 'unsafe-inline' https: data: blob:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
const navigationScript = `document.addEventListener('click', function(event) {
  var link = event.target instanceof Element && event.target.closest('a[href^="#"]');
  if (!link) return;
  event.preventDefault();
  var id = link.getAttribute('href').slice(1);
  try { id = decodeURIComponent(id); } catch (_) {}
  document.getElementById(id)?.scrollIntoView();
});
window.addEventListener('DOMContentLoaded', function() { parent.postMessage({ type: 'grow:ready' }, '*'); });
window.addEventListener('message', function(event) {
  if (event.source !== parent || event.data?.type !== 'grow:chapter' || typeof event.data.id !== 'string') return;
  document.getElementById(event.data.id)?.scrollIntoView();
});`

type ChapterRequest = { id: string; serial: number } | null

export function GrowPlanReader({ workspace, path, chapter, onClose, onOpenFile }: {
  workspace: string
  path: string
  chapter: ChapterRequest
  onClose: () => void
  onOpenFile?: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const [frameReady, setFrameReady] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setContent(null)
    setFrameReady(false)
    void ipcClient.invoke('workspace.fs.readText', { workspaceRoot: workspace, path, maxBytes: WORKSPACE_TEXT_MAX_BYTES })
      .then((result) => {
        if (cancelled) return
        if (!result?.ok || result.truncated || typeof result.content !== 'string') { setStatus('error'); return }
        setContent(result.content)
        setStatus('ready')
      }).catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [workspace, path, retry])

  const documentHtml = useMemo(() => content === null ? '' :
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><script>${navigationScript}</script>${content}`, [content])
  const missingChapter = useMemo(() => {
    if (content === null || !chapter) return false
    return !new DOMParser().parseFromString(content, 'text/html').getElementById(chapter.id)
  }, [content, chapter])

  useEffect(() => {
    const ready = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === 'grow:ready') setFrameReady(true)
    }
    window.addEventListener('message', ready)
    return () => window.removeEventListener('message', ready)
  }, [])

  useEffect(() => {
    if (frameReady && chapter && !missingChapter) {
      frame.current?.contentWindow?.postMessage({ type: 'grow:chapter', id: chapter.id }, '*')
    }
  }, [frameReady, chapter, missingChapter])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <section aria-label="方案阅读器" className="electron-no-drag fixed bottom-4 left-4 right-4 top-12 z-[100] mx-auto flex min-h-0 max-w-[1000px] flex-col rounded-xl border bg-background shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5 text-[12px] font-medium">
        <span>方案阅读器</span>
        <div className="flex items-center gap-3">
          {onOpenFile && <button type="button" onClick={onOpenFile} className="text-muted-foreground underline hover:text-foreground">打开文件</button>}
          <button type="button" onClick={onClose} className="text-muted-foreground underline hover:text-foreground">关闭阅读器</button>
        </div>
      </div>
      {status === 'loading' && <div role="status" className="p-3 text-[12px] text-muted-foreground">正在读取方案…</div>}
      {status === 'error' && <div role="alert" className="p-3 text-[12px] text-muted-foreground">方案读取失败或文件过大，请检查文件后重试。 <button type="button" onClick={() => setRetry((value) => value + 1)} className="underline">重试</button></div>}
      {status === 'ready' && <>
        {missingChapter && <div role="status" className="border-b px-2 py-1 text-[12px] text-muted-foreground">未找到对应章节，已打开完整方案。</div>}
        <iframe ref={frame} title="方案内容" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={documentHtml} className="min-h-0 w-full flex-1 border-0 bg-[var(--bg-base)]" />
      </>}
    </section>, document.body
  )
}
