import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Bot, FileEdit, GitBranch, GitFork, Loader2, Minus, Plus, RotateCcw, X } from '@renderer/components/icons'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { getSessionMessagesFromDiskViaIpc } from '@renderer/lib/session-history'
import { sessionTreeLineTitle, type SessionTreeNode } from './session-tree-list'
import { cn } from '@renderer/lib/utils'

const CARD_W = 232
const CARD_H = 140
const STEP_X = 306
const STEP_Y = 166
const PAD = 56
type Point = { x: number; y: number }
type Transform = { x: number; y: number; scale: number }

function layoutMindMap(nodes: SessionTreeNode[], sourceNodes: SessionTreeNode[]) {
  const byId = new Map(sourceNodes.map((node) => [node.id, node] as const))
  const visible = new Set(nodes.map((node) => node.id))
  const children = new Map<string, SessionTreeNode[]>()
  const parents = new Map<string, string>()
  const roots: SessionTreeNode[] = []
  for (const node of nodes) {
    let parent = node.parentId ? byId.get(node.parentId) : undefined
    while (parent && !visible.has(parent.id)) parent = parent.parentId ? byId.get(parent.parentId) : undefined
    if (!parent) roots.push(node)
    else {
      parents.set(node.id, parent.id)
      children.set(parent.id, [...(children.get(parent.id) ?? []), node])
    }
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
  }

  const positions = new Map<string, Point>()
  let leafX = 0
  const visit = (node: SessionTreeNode, yDepth: number): number => {
    const kids = children.get(node.id) ?? []
    let x: number
    if (!kids.length) {
      x = PAD + leafX
      leafX += STEP_X
    } else {
      const childXs = kids.map((child) => visit(child, yDepth + 1))
      x = (childXs[0] + childXs[childXs.length - 1]) / 2
    }
    positions.set(node.id, { x, y: PAD + yDepth * STEP_Y })
    return x
  }
  roots.forEach((root) => visit(root, 0))
  const maxX = Math.max(0, ...[...positions.values()].map((point) => point.x)) + CARD_W + PAD
  const maxY = Math.max(0, ...[...positions.values()].map((point) => point.y)) + CARD_H + PAD
  return { positions, children, parents, width: maxX, height: maxY }
}

function nodeTone(node: SessionTreeNode) {
  if (node.entryType === 'message' && node.role === 'user') return 'border-sky-500/40 bg-sky-500/[0.055]'
  if (node.entryType === 'message' && node.role === 'assistant') return 'border-[var(--brand)]/35 bg-[var(--brand)]/[0.055]'
  if (node.entryType.includes('tool')) return 'border-amber-500/35 bg-amber-500/[0.045]'
  return 'border-border bg-card'
}

function readableTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function currentPathAnchor(nodes: SessionTreeNode[], sourceNodes: SessionTreeNode[]) {
  const byId = new Map(sourceNodes.map((node) => [node.id, node] as const))
  const visible = new Set(nodes.map((node) => node.id))
  let current = sourceNodes.find((node) => node.isLeaf)
  while (current) {
    if (visible.has(current.id)) return nodes.find((node) => node.id === current!.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return nodes.at(-1)
}

function buildTurnSummaries(nodes: SessionTreeNode[], sourceNodes: SessionTreeNode[]) {
  const children = new Map<string, SessionTreeNode[]>()
  for (const item of sourceNodes) {
    if (!item.parentId) continue
    children.set(item.parentId, [...(children.get(item.parentId) ?? []), item])
  }
  const activeLeaf = sourceNodes.find((node) => node.isLeaf)
  const summaries = new Map<string, { answer?: string; hiddenCount: number }>()
  for (const question of nodes) {
    if (question.role !== 'user' || question.entryType !== 'message') continue
    const entries: SessionTreeNode[] = []
    const stack = [...(children.get(question.id) ?? [])]
    const seen = new Set<string>([question.id])
    while (stack.length) {
      const entry = stack.pop()!
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      if (entry.entryType === 'message' && entry.role === 'user') continue
      entries.push(entry)
      stack.push(...(children.get(entry.id) ?? []))
    }
    const activeAnswer = activeLeaf && entries.some((entry) => entry.id === activeLeaf.id) && activeLeaf.role === 'assistant'
      ? activeLeaf
      : undefined
    const answer = activeAnswer ?? [...entries]
      .filter((entry) => entry.entryType === 'message' && entry.role === 'assistant')
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0]
    summaries.set(question.id, { answer: answer?.preview, hiddenCount: entries.length })
  }
  return summaries
}

function fileChangeFromTool(item: Record<string, unknown>) {
  const toolName = String(item.toolName ?? '').toLowerCase()
  if (!['edit', 'write', 'insert'].includes(toolName)) return null
  const args = item.toolArgs && typeof item.toolArgs === 'object' ? item.toolArgs as Record<string, unknown> : {}
  const detail = item.toolDetail && typeof item.toolDetail === 'object' ? item.toolDetail as Record<string, unknown> : {}
  const details = item.toolDetails && typeof item.toolDetails === 'object' ? item.toolDetails as Record<string, unknown> : {}
  const path = String(detail.path ?? args.path ?? args.file_path ?? '').trim()
  if (!path) return null
  const editList = Array.isArray(args.edits) ? args.edits as Array<Record<string, unknown>> : []
  const editPairs = editList.length
    ? editList
    : [{ oldText: args.oldText, newText: args.newText }]
  const directDiff = typeof detail.diff === 'string' ? detail.diff : typeof details.diff === 'string' ? details.diff : ''
  const diff = directDiff || editPairs.flatMap((edit) => {
    const oldText = typeof edit.oldText === 'string' ? edit.oldText : ''
    const newText = typeof edit.newText === 'string' ? edit.newText : ''
    return [
      ...(oldText ? oldText.split('\n').map((line) => `-${line}`) : []),
      ...(newText ? newText.split('\n').map((line) => `+${line}`) : []),
    ]
  }).join('\n')
  const additions = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
  const deletions = diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length
  const preview = toolName === 'write' ? String(detail.preview ?? args.content ?? '') : ''
  return { path, toolName, diff, additions, deletions, preview }
}

function NodeDetailDialog({
  node,
  sourceNodes,
  sessionFile,
  onClose,
  onFork,
  onContinue,
}: {
  node: SessionTreeNode
  sourceNodes: SessionTreeNode[]
  sessionFile: string | null
  onClose: () => void
  onFork: (id: string) => void
  onContinue: (id: string) => void
}) {
  const { t } = useTranslation()
  const descendants = useMemo(() => {
    const children = new Map<string, SessionTreeNode[]>()
    for (const item of sourceNodes) {
      if (!item.parentId) continue
      children.set(item.parentId, [...(children.get(item.parentId) ?? []), item])
    }
    const ids = new Set<string>([node.id])
    const stack = [node]
    while (stack.length) {
      const current = stack.pop()!
      for (const child of children.get(current.id) ?? []) {
        // A following user message starts another turn; its edits do not belong to this node.
        if (child.id !== node.id && child.entryType === 'message' && child.role === 'user') continue
        ids.add(child.id)
        stack.push(child)
      }
    }
    return ids
  }, [node, sourceNodes])
  const historyLeaf = useMemo(() => {
    const relevant = sourceNodes.filter((item) => descendants.has(item.id))
    const currentLeaf = relevant.find((item) => item.isLeaf)
    if (currentLeaf) return currentLeaf.id
    const assistants = relevant.filter((item) => item.entryType === 'message' && item.role === 'assistant')
    return assistants.at(-1)?.id ?? node.id
  }, [descendants, node.id, sourceNodes])
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let live = true
    const load = async () => {
      if (!sessionFile) {
        setHistory([])
        setLoading(false)
        return
      }
      setHistory([])
      setLoading(true)
      setLoadError('')
      try {
        const response = await getSessionMessagesFromDiskViaIpc(sessionFile, historyLeaf, 500)
        if (!live) return
        if (response.error) setLoadError(response.error)
        setHistory(response.items as Record<string, unknown>[])
      } catch (error) {
        if (live) setLoadError(error instanceof Error ? error.message : String(error))
      } finally {
        if (live) setLoading(false)
      }
    }
    void load()
    return () => { live = false }
  }, [historyLeaf, sessionFile])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const selectedText = history.find((item) => item.sessionEntryId === node.id)
  const body = selectedText && typeof selectedText.text === 'string' ? selectedText.text : node.preview || ''
  const toolItems = history.filter((item) => descendants.has(String(item.sessionEntryId ?? '')) && item.type === 'tool-call')
  const changes = toolItems.map(fileChangeFromTool).filter((change): change is NonNullable<typeof change> => !!change)
  const groupedChanges = new Map<string, NonNullable<ReturnType<typeof fileChangeFromTool>>>()
  for (const change of changes) {
    const previous = groupedChanges.get(change.path)
    groupedChanges.set(change.path, previous ? {
      ...change,
      diff: [previous.diff, change.diff].filter(Boolean).join('\n'),
      additions: previous.additions + change.additions,
      deletions: previous.deletions + change.deletions,
      preview: change.preview || previous.preview,
    } : change)
  }
  const uniqueChanges = [...groupedChanges.values()]
  const changeSummary = uniqueChanges.reduce((sum, change) => ({
    additions: sum.additions + change.additions,
    deletions: sum.deletions + change.deletions,
  }), { additions: 0, deletions: 0 })
  const replies = history.filter((item) =>
    item.type === 'assistant-message' &&
    item.sessionEntryId !== node.id &&
    descendants.has(String(item.sessionEntryId ?? '')) &&
    typeof item.text === 'string' &&
    item.text.trim(),
  ).slice(-3)
  const lastReply = [...history].reverse().find((item) =>
    item.type === 'assistant-message' &&
    typeof item.text === 'string' &&
    item.text.trim() &&
    descendants.has(String(item.sessionEntryId ?? '')),
  )
  const lastReplyId = String(lastReply?.sessionEntryId ?? '')
  const safeReply = lastReply && !toolItems.some((tool) => tool.sessionEntryId === lastReplyId) ? lastReply : undefined
  const safeReplyNode = safeReply
    ? sourceNodes.find((item) => item.id === String(safeReply.sessionEntryId))
    : undefined
  const selectedIsSafeReply = node.role === 'assistant' && !!safeReply && safeReply.sessionEntryId === node.id
  const parentNode = node.parentId ? sourceNodes.find((item) => item.id === node.parentId) : undefined
  const siblingCount = node.parentId ? sourceNodes.filter((item) => item.parentId === node.parentId).length : 1

  return (
    <div data-session-node-detail className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="flex max-h-[min(82vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="session-node-detail-title">
        <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              <span>{node.role === 'user' ? t('timeline:treeRoleUser') : node.role === 'assistant' ? t('timeline:treeRoleAssistant') : node.entryType}</span>
              {node.timestamp && <span>· {readableTime(node.timestamp)}</span>}
            </div>
            <h2 id="session-node-detail-title" className="truncate text-[15px] font-semibold">{sessionTreeLineTitle(node, t)}</h2>
            <div className="mt-1 text-[11px] text-muted-foreground">{t('timeline:mindMapNodeInfo', { id: node.id })}</div>
            {parentNode && <div className="mt-1 truncate text-[11px] text-muted-foreground">{t('timeline:mindMapParent', { label: sessionTreeLineTitle(parentNode, t) })}{siblingCount > 1 ? ` · ${t('timeline:mindMapSiblingCount', { count: siblingCount })}` : ''}</div>}
          </div>
          <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('common:close')} onClick={onClose}><X className="h-4 w-4" /></button>
        </header>
        <div className="scrollbar-overlay min-h-0 flex-1 space-y-4 overflow-auto p-5">
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('timeline:mindMapMessage')}</h3>
            <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-muted/30 p-3 text-[12px] leading-5">{body || t('timeline:mindMapNoMessage')}</div>
          </section>
          {replies.length > 0 && <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('timeline:mindMapReplies')}</h3>
            <div className="space-y-2">
              {replies.map((reply) => <div key={String(reply.id)} className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-muted/20 p-3 text-[12px] leading-5">{String(reply.text).slice(0, 6000)}</div>)}
            </div>
          </section>}
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('timeline:mindMapChanges')}</h3>
              {uniqueChanges.length > 0 && <span className="text-[11px] font-medium text-muted-foreground">+{changeSummary.additions} · −{changeSummary.deletions}</span>}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/70 p-3 text-[12px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('timeline:mindMapLoadingChanges')}</div>
            ) : loadError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">{t('timeline:mindMapLoadError', { error: loadError })}</div>
            ) : uniqueChanges.length === 0 ? (
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-[12px] text-muted-foreground">{t('timeline:mindMapNoChanges')}</div>
            ) : (
              <div className="space-y-2">
                {uniqueChanges.map((change) => (
                  <article key={change.path} className="overflow-hidden rounded-lg border border-border/70">
                    <div className="flex items-center gap-2 px-3 py-2 text-[12px]"><FileEdit className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate font-mono">{change.path}</span><span className="shrink-0 text-[10px] text-muted-foreground">{change.toolName}</span></div>
                    {(change.diff || change.preview) && <pre className="scrollbar-overlay max-h-36 overflow-auto border-t border-border/60 bg-muted/25 p-3 font-mono text-[10px] leading-4 text-foreground-secondary">{change.diff || change.preview.slice(0, 2400)}</pre>}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-border/70 px-5 py-3">
          <span className="text-[10px] text-muted-foreground">{t('timeline:mindMapChangeSource')}</span>
          <div className="flex items-center gap-2">
            {node.entryType === 'message' && node.role === 'user' && <button type="button" className="rounded-md border border-border px-3 py-1.5 text-[11px] hover:bg-muted" onClick={() => onFork(node.id)}><GitFork className="mr-1.5 inline h-3.5 w-3.5" />{t('timeline:treeForkNode')}</button>}
            {node.entryType === 'message' && node.role === 'user' && !node.isLeaf && <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90" onClick={() => onContinue(node.id)}>{t('timeline:treeBranchFromHere')}</button>}
            {node.entryType === 'message' && node.role === 'user' && safeReplyNode && !safeReplyNode.isLeaf && <button type="button" className="rounded-md border border-border px-3 py-1.5 text-[11px] hover:bg-muted" onClick={() => onContinue(safeReplyNode.id)}>{t('timeline:mindMapContinueFromReply')}</button>}
            {selectedIsSafeReply && !node.isLeaf && <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90" onClick={() => onContinue(node.id)}>{t('timeline:mindMapContinueFromReply')}</button>}
          </div>
        </footer>
      </section>
    </div>
  )
}

export function SessionTreeMindMap({
  nodes,
  sourceNodes,
  sessionFile,
  onContinue,
  onFork,
}: {
  nodes: SessionTreeNode[]
  sourceNodes: SessionTreeNode[]
  sessionFile: string | null
  onContinue: (id: string) => void
  onFork: (id: string) => void
}) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)
  const { positions, children, parents, width, height } = useMemo(() => layoutMindMap(nodes, sourceNodes), [nodes, sourceNodes])
  const turnSummaries = useMemo(() => buildTurnSummaries(nodes, sourceNodes), [nodes, sourceNodes])
  const activePath = useMemo(() => {
    const path = new Set<string>()
    const byId = new Map(sourceNodes.map((node) => [node.id, node] as const))
    let current = sourceNodes.find((node) => node.isLeaf)
    while (current && !path.has(current.id)) {
      path.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return path
  }, [sourceNodes])
  const [transform, setTransform] = useState<Transform>({ x: PAD, y: 24, scale: 0.78 })
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<SessionTreeNode | null>(null)

  useEffect(() => setSelected(null), [sessionFile])

  useEffect(() => {
    const anchor = currentPathAnchor(nodes, sourceNodes)
    const position = anchor ? positions.get(anchor.id) : undefined
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!position || !rect) return
    setTransform({
      x: rect.width / 2 - (position.x + CARD_W / 2) * 0.78,
      y: rect.height / 2 - (position.y + CARD_H / 2) * 0.78,
      scale: 0.78,
    })
  }, [nodes, positions, sourceNodes])

  const zoom = useCallback((factor: number) => {
    setTransform((current) => ({ ...current, scale: Math.max(0.35, Math.min(1.5, current.scale * factor)) }))
  }, [])
  const reset = useCallback(() => {
    const anchor = currentPathAnchor(nodes, sourceNodes)
    const position = anchor ? positions.get(anchor.id) : undefined
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!position || !rect) {
      setTransform({ x: PAD, y: 24, scale: 0.78 })
      return
    }
    setTransform({ x: rect.width / 2 - (position.x + CARD_W / 2) * 0.78, y: rect.height / 2 - (position.y + CARD_H / 2) * 0.78, scale: 0.78 })
  }, [nodes, positions, sourceNodes])
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-map-node],button')) return
    dragRef.current = { x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setTransform((current) => ({ ...current, x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }))
  }
  const onPointerUp = () => { dragRef.current = null; setDragging(false) }
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    zoom(event.deltaY < 0 ? 1.08 : 0.92)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border)_/_0.35)_1px,transparent_0)] [background-size:22px_22px]">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border/70 bg-background/90 p-1 shadow-sm backdrop-blur">
        <button type="button" className="rounded p-1.5 hover:bg-muted" title={t('timeline:mindMapZoomOut')} onClick={() => zoom(0.88)}><Minus className="h-3.5 w-3.5" /></button>
        <span className="w-10 text-center text-[10px] tabular-nums text-muted-foreground">{Math.round(transform.scale * 100)}%</span>
        <button type="button" className="rounded p-1.5 hover:bg-muted" title={t('timeline:mindMapZoomIn')} onClick={() => zoom(1.12)}><Plus className="h-3.5 w-3.5" /></button>
        <button type="button" className="rounded p-1.5 hover:bg-muted" title={t('timeline:mindMapCenter')} onClick={reset}><RotateCcw className="h-3.5 w-3.5" /></button>
      </div>
      <div className="absolute bottom-2 left-2 z-10 rounded-md border border-border/60 bg-background/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">{t('timeline:mindMapDragHint')}</div>
      <div
        ref={viewportRef}
        className={cn('min-h-0 flex-1 overflow-hidden touch-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {!nodes.length ? <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">{t('timeline:treeNoMatch')}</div> : (
          <div className="relative origin-top-left" style={{ width, height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
            <svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
              {nodes.map((node) => {
                const parentId = parents.get(node.id)
                const parent = parentId ? positions.get(parentId) : undefined
                const point = positions.get(node.id)
                if (!parent || !point) return null
                const x1 = parent.x + CARD_W / 2
                const y1 = parent.y + CARD_H
                const x2 = point.x + CARD_W / 2
                const y2 = point.y
                const middle = (y1 + y2) / 2
                const active = activePath.has(node.id)
                return (
                  <g key={node.id} fill="none" stroke={active ? 'hsl(var(--primary))' : 'hsl(var(--foreground) / 0.36)'} strokeWidth={active ? 2 : 1.8} opacity={active ? 0.9 : 0.92}>
                    <path d={`M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2 - 4}`} />
                    <path d={`M ${x2 - 4} ${y2 - 9} L ${x2} ${y2 - 4} L ${x2 + 4} ${y2 - 9}`} />
                  </g>
                )
              })}
            </svg>
            {nodes.map((node) => {
              const point = positions.get(node.id)
              if (!point) return null
              const childCount = children.get(node.id)?.length ?? 0
              const turnSummary = turnSummaries.get(node.id)
              const onActivePath = activePath.has(node.id)
              // Branching is the point of this panel: a user turn that already has a reply can
              // sprout a sibling branch, so the card carries that action directly instead of
              // hiding it behind the detail dialog (or behind "fork into a new session").
              const canBranch = node.entryType === 'message' && node.role === 'user' && !node.isLeaf
              return (
                <div
                  key={node.id}
                  className={cn('group/map-card absolute', !onActivePath && 'opacity-[0.66]')}
                  style={{ left: point.x, top: point.y, width: CARD_W, height: CARD_H }}
                >
                  <button
                    type="button"
                    data-map-node
                    onClick={() => setSelected(node)}
                    className={cn('flex h-full w-full flex-col overflow-hidden rounded-xl border p-3 text-left shadow-sm transition-[box-shadow,border-color,transform] hover:z-10 hover:-translate-y-0.5 hover:shadow-lg focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', nodeTone(node), onActivePath && 'border-primary/55', node.isLeaf && 'ring-1 ring-primary/45')}
                    title={sessionTreeLineTitle(node, t)}
                  >
                    <span className="flex w-full items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      {node.role === 'assistant' ? <Bot className="h-3.5 w-3.5 text-[var(--brand)]" /> : node.role === 'user' ? <span className="h-2 w-2 rounded-full bg-sky-500" /> : <GitBranch className="h-3.5 w-3.5" />}
                      <span className="truncate">{node.role === 'user' ? t('timeline:mindMapQuestion') : node.role === 'assistant' ? t('timeline:treeRoleAssistant') : node.entryType}</span>
                      {node.isLeaf && <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-primary">{t('timeline:treeCurrentTag')}</span>}
                      {childCount > 1 && <span className="ml-auto inline-flex items-center gap-0.5 text-primary"><GitBranch className="h-3 w-3" />{childCount}</span>}
                    </span>
                    <span className="mt-1 line-clamp-2 w-full text-[11px] leading-4 text-foreground">{sessionTreeLineTitle(node, t)}</span>
                    {turnSummary?.answer && <span className="mt-1 line-clamp-2 w-full text-[10px] leading-4 text-foreground-secondary"><span className="font-medium text-[var(--brand)]">{t('timeline:mindMapAnswer')}: </span>{turnSummary.answer}</span>}
                    <span className="mt-auto flex w-full items-center justify-between gap-2 text-[9px] text-muted-foreground">
                      <span className="truncate">{node.timestamp ? readableTime(node.timestamp) : ''}</span>
                      {turnSummary && turnSummary.hiddenCount > 0 && <span className="shrink-0">{t('timeline:mindMapCollapsedEntries', { count: turnSummary.hiddenCount })}</span>}
                    </span>
                  </button>
                  {canBranch && (
                    <div className="pointer-events-none absolute -top-3 right-1 z-20 opacity-0 transition-opacity group-hover/map-card:opacity-100 group-focus-within/map-card:opacity-100">
                      <button
                        type="button"
                        className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-primary/45 bg-background px-2 py-0.5 text-[10px] font-medium text-primary shadow-sm hover:bg-primary hover:text-primary-foreground"
                        title={t('timeline:treeBranchFromHereHint')}
                        onClick={() => onContinue(node.id)}
                      >
                        <GitBranch className="h-3 w-3" />
                        {t('timeline:treeBranchFromHere')}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {selected && <NodeDetailDialog node={selected} sourceNodes={sourceNodes} sessionFile={sessionFile} onClose={() => setSelected(null)} onFork={(id) => { setSelected(null); onFork(id) }} onContinue={(id) => { setSelected(null); onContinue(id) }} />}
    </div>
  )
}
