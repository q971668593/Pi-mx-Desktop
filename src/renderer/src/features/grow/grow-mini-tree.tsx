import { useEffect, useMemo, useRef } from 'react'
import type { GrowChapterView } from '@shared/ipc-contract'
import type { GrowNode } from './grow-types'
import { createDecisionTree } from './vendor/tree.mjs'

interface Row { node: GrowNode; depth: number; parentIndex: number | null }

/** Only explicit dependencies become branches. Older questions remain separate roots. */
export function layoutGrowTree(nodes: GrowNode[]): Row[] {
  const ids = new Set(nodes.map((node) => node.id))
  const parent = new Map<string, string>()
  for (const node of nodes) {
    const candidate = node.depends_on?.find((id) => id !== node.id && ids.has(id))
    if (candidate) parent.set(node.id, candidate)
  }
  for (const node of nodes) {
    const seen = new Set<string>([node.id])
    let next = parent.get(node.id)
    while (next) {
      if (seen.has(next)) { parent.delete(node.id); break }
      seen.add(next)
      next = parent.get(next)
    }
  }
  const rows: Row[] = []
  const visit = (node: GrowNode, depth: number, parentIndex: number | null) => {
    const index = rows.length
    rows.push({ node, depth, parentIndex })
    for (const child of nodes) if (parent.get(child.id) === node.id) visit(child, depth + 1, index)
  }
  for (const node of nodes) if (!parent.has(node.id)) visit(node, 0, null)
  return rows
}


/** Project saved questions into the upstream graph without inventing dependencies. */
function upstreamTree(nodes: GrowNode[]) {
  const rows = layoutGrowTree(nodes)
  const projected = rows.map(({ node, parentIndex }, index) => {
    const round = Number.isSafeInteger(node.round) && (node.round ?? 0) > 0 ? node.round! : 1
    const parent = parentIndex === null ? null : rows[parentIndex].node.id
    return {
      id: node.id, question: node.question, status: node.status,
      round: parentIndex === null ? round : Math.max(round, 1),
      depends_on: parent ? [parent] : [],
      options: (node.options ?? []).map((label) => ({ id: label, label })),
      answer: node.answer || node.selectedOptions?.length || node.status === 'deferred'
        ? { option_ids: node.selectedOptions ?? [], text: node.selectedOptions?.join('、') === node.answer ? '' : node.answer ?? '', deferred: node.status === 'deferred' }
        : null,
      index,
    }
  })
  // Upstream lays out earlier rounds first, so parents must be laid out before children.
  for (const [index, row] of rows.entries()) {
    if (row.parentIndex !== null) projected[index].round = Math.max(projected[index].round, projected[row.parentIndex].round)
  }
  return { session_id: 'pi-grow', schema_version: 1, status: 'growing', current_round: Math.max(1, ...projected.map((node) => node.round)), nodes: projected }
}

export function GrowMiniTree({ nodes, requirement, chapters = [], onChapter }: {
  nodes: GrowNode[]; onSelect?: (id: string) => void; requirement?: string
  chapters?: GrowChapterView[]; onChapter?: (id: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const chapterAction = useRef(onChapter)
  chapterAction.current = onChapter
  const fruitMap = useMemo(() => {
    const result = new Map<string, string>()
    for (const row of layoutGrowTree(nodes)) {
      if (row.parentIndex !== null || !row.node.chapter_id) continue
      const chapter = chapters.find((item) => item.id === row.node.chapter_id && item.ready)
      if (chapter) result.set(row.node.id, chapter.id)
    }
    return result
  }, [nodes, chapters])
  const tree = useMemo(() => {
    const result = upstreamTree(nodes)
    const roots = result.nodes.filter((node) => node.depends_on.length === 0)
    if (onChapter && roots.length && roots.every((root) => fruitMap.has(root.id))) result.status = 'complete'
    return result
  }, [nodes, fruitMap, onChapter])
  const legacy = nodes.some((node) => node.depends_on === undefined)

  useEffect(() => {
    if (!container.current || !tree.nodes.length) return
    const renderer = createDecisionTree(container.current, {
      onFruit: (fruit) => { const chapter = fruitMap.get(fruit.id); if (chapter) chapterAction.current?.(chapter) },
    })
    renderer.update(tree)
    return () => renderer.destroy()
  }, [tree, fruitMap])

  if (!nodes.length) return <div className="rounded-lg border border-dashed p-4 text-center text-[12px] text-muted-foreground">还没有问题。开始澄清后，需求树会从这里生长。</div>
  return <div className="relative flex h-full min-h-[280px] min-w-0 flex-col" ref={container}>
    {legacy && <p className="mb-2 text-[11px] leading-4 text-muted-foreground">历史问题未记录分支关系，先按独立分支展示。</p>}
    <div className="flex justify-end gap-1" aria-label="树视图缩放">
      <button type="button" data-tree-zoom="out" aria-label="缩小" className="rounded px-2 hover:bg-muted">−</button>
      <button type="button" data-tree-zoom="fit" className="rounded px-2 text-xs hover:bg-muted">适应</button>
      <button type="button" data-tree-zoom="in" aria-label="放大" className="rounded px-2 hover:bg-muted">+</button>
    </div>
    <style>{'.tree-node { cursor: pointer; } .tree-node:focus-visible .tree-hit { stroke: #ad9261; stroke-width: 2; }'}</style>
    <svg id="tree-canvas" className="min-h-0 w-full flex-1 touch-none cursor-grab active:cursor-grabbing" viewBox="0 0 1000 900" preserveAspectRatio="xMidYMid meet" role="group" aria-label="需求树，可滚轮缩放、拖动，选择问题查看详情" />
    <div data-tree-tip hidden role="region" aria-label="问题详情" tabIndex={0} className="absolute z-50 max-h-[min(60vh,32rem)] w-[min(320px,calc(100%-16px))] overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-3 text-xs leading-relaxed shadow-lg" />
    <div title={requirement} className="truncate text-center text-xs font-medium">{requirement || '本次需求'}</div>
  </div>
}
