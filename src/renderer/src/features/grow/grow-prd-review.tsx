import { useEffect, useId, useRef, useState } from 'react'

export type GrowPrdReviewChange = { nodeId: string; before: unknown; after: unknown }

export type GrowPrdReviewProps = {
  original: string
  updated: string
  reason: string
  changes?: ReadonlyArray<GrowPrdReviewChange>
  busy: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function GrowPrdReview({ original, updated, reason, changes, busy, onConfirm, onCancel }: GrowPrdReviewProps) {
  const titleId = useId()
  const descriptionId = useId()
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const blocked = busy || pending

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !blocked && !event.defaultPrevented) {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blocked, onCancel])

  const confirm = () => {
    if (busy || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    const release = () => { pendingRef.current = false; setPending(false) }
    try {
      const result = onConfirm()
      void Promise.resolve(result).then(release, release)
    } catch (error) {
      release()
      throw error
    }
  }

  return (
    <section aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={blocked} className="electron-no-drag rounded-xl border bg-background p-4 shadow-sm">
      <h2 id={titleId} className="text-sm font-semibold">审阅 PRD 变更</h2>
      <p id={descriptionId} className="mt-1 text-[12px] text-muted-foreground">仅在确认后写入，取消将放弃本次变更。</p>
      <div className="mt-3 rounded-md border bg-muted/30 p-3">
        <h3 className="text-[12px] font-semibold">修改原因</h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px]">{reason === '' ? '（空内容）' : reason}</p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {([['修改前', original], ['修改后', updated]] as const).map(([label, content]) => (
          <section key={label} aria-label={label} className="min-w-0 rounded-md border p-3">
            <h3 className="text-[12px] font-semibold">{label}</h3>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-[12px]">{content === '' ? '（空内容）' : content}</pre>
          </section>
        ))}
      </div>
      {changes && changes.length > 0 && (
        <div className="mt-3 rounded-md border bg-muted/30 p-3">
          <h3 className="text-[12px] font-semibold">需求树节点变化（{changes.length}）</h3>
          <ul className="mt-1 max-h-40 space-y-1 overflow-auto text-[12px]">
            {changes.map((change) => (
              <li key={change.nodeId} className="break-words">
                <span className="font-mono">{change.nodeId}</span>
                <span className="text-muted-foreground">{change.before == null ? ' · 新增问题' : ' · 答案或状态已更新'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        {blocked && <span role="status" className="text-[12px] text-muted-foreground">正在处理…</span>}
        <button type="button" disabled={blocked} onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50">取消</button>
        <button type="button" disabled={blocked} onClick={confirm} className="rounded-md bg-green-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50">确认写入</button>
      </div>
    </section>
  )
}
