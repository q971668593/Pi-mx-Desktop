import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

export function FilePreviewFind({ container, frame, revision, onClose }: {
  container: RefObject<HTMLDivElement>
  frame: RefObject<HTMLIFrameElement>
  revision: string
  onClose: () => void
}) {
  const { t } = useTranslation('files')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)
  const [domVersion, setDomVersion] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    const root = container.current
    if (!root) return
    let frameId = 0
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-file-find]'))) return
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => setDomVersion((current) => current + 1))
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    return () => { observer.disconnect(); cancelAnimationFrame(frameId) }
  }, [container])

  useEffect(() => {
    if (!query || !container.current || frame.current) { setCount(0); return }
    const walker = document.createTreeWalker(container.current, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('[data-file-find]')) continue
      nodes.push(node as Text)
    }
    const text = nodes.map((item) => item.data).join('')
    const lower = text.toLocaleLowerCase()
    const needle = query.toLocaleLowerCase()
    const matches: number[] = []
    for (let position = lower.indexOf(needle); position >= 0; position = lower.indexOf(needle, position + needle.length)) matches.push(position)
    setCount(matches.length)
    if (!matches.length) return
    const start = matches[((index % matches.length) + matches.length) % matches.length]
    const end = start + needle.length
    let offset = 0
    let startNode: Text | undefined
    let endNode: Text | undefined
    let startOffset = 0
    let endOffset = 0
    for (const item of nodes) {
      const next = offset + item.length
      if (!startNode && start < next) { startNode = item; startOffset = start - offset }
      if (end <= next) { endNode = item; endOffset = end - offset; break }
      offset = next
    }
    if (startNode && endNode) {
      const range = document.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      startNode.parentElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [query, index, container, frame, revision, domVersion])

  const move = (direction: number) => {
    if (frame.current) frame.current.contentWindow?.postMessage({ type: 'pi-desktop:find-in-preview', query, backwards: direction < 0 }, '*')
    else setIndex((current) => current + direction)
  }

  return <div data-file-find className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1 text-[12px]">
    <input ref={input} value={query} placeholder={t('preview.find')} className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 outline-none" onChange={(event) => { setQuery(event.target.value); setIndex(0) }} onKeyDown={(event) => { if (event.key === 'Enter') move(event.shiftKey ? -1 : 1); if (event.key === 'Escape') onClose() }} />
    {!frame.current ? <span className="text-foreground-secondary">{count ? ((index % count + count) % count) + 1 : 0}/{count}</span> : null}
    <button type="button" title={t('preview.previous')} onClick={() => move(-1)}>↑</button><button type="button" title={t('preview.next')} onClick={() => move(1)}>↓</button><button type="button" aria-label={t('preview.closeFind')} onClick={onClose}>×</button>
  </div>
}
