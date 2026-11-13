import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, FolderOpen, Search, X } from '@renderer/components/icons'

export function HiddenProjectsDialog({ paths, name, onRestore, onClose }: {
  paths: string[]
  name: (path: string) => string
  onRestore: (path: string) => Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const filter = query.trim().toLowerCase()
  const matches = paths.filter((path) => [name(path), path].some((value) => value.toLowerCase().includes(filter)))
  return createPortal(
    <dialog ref={dialog} className="hidden-projects-dialog" aria-labelledby="hidden-projects-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="hidden-projects-content">
        <header>
          <span className="project-folder-tile"><EyeOff size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="hidden-projects-title">隐藏的项目 <span>{paths.length}</span></h2>
            <p>恢复后，项目及其会话会重新显示在侧栏。</p>
          </div>
          <button type="button" className="sidebar-section-action" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <label className="workbench-search"><Search size={15} /><input autoFocus type="search" aria-label="搜索隐藏项目" placeholder="搜索项目名称或路径" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="hidden-projects-results" aria-live="polite">
          {matches.map((path) => <div className="hidden-project-card" key={path}>
            <span className="project-folder-tile"><FolderOpen size={15} /></span>
            <div className="min-w-0 flex-1"><strong className="block truncate">{name(path)}</strong><p className="truncate" title={path}>{path}</p></div>
            <button type="button" className="workbench-button inline-flex items-center gap-1.5" disabled={restoring !== null}
              onClick={async () => { setRestoring(path); try { await onRestore(path) } finally { setRestoring(null) } }}><Eye size={14} />{restoring === path ? '恢复中…' : '恢复'}</button>
          </div>)}
          {!matches.length && <div className="hidden-projects-empty"><EyeOff size={21} /><strong>{paths.length ? '没有匹配的项目' : '没有隐藏的项目'}</strong><p>{paths.length ? '试试其他名称或路径。' : '在项目卡片上点击右键，即可隐藏项目。'}</p></div>}
        </div>
      </div>
    </dialog>, document.body,
  )
}
