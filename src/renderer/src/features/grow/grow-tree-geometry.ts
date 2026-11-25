import type { GrowNode } from './grow-types'

interface Row { node: GrowNode; depth: number; parentIndex: number | null }
export interface TreePoint { x: number; y: number }

/** Assign leaves their own space, then place each parent over its descendants. */
export function growTreeGeometry(rows: Row[]) {
  const children = rows.map(() => [] as number[])
  const roots: number[] = []
  rows.forEach((row, i) => row.parentIndex === null ? roots.push(i) : children[row.parentIndex].push(i))
  const x = new Array<number>(rows.length)
  let leaf = 0
  const place = (i: number): number => {
    if (!children[i].length) return x[i] = 100 + leaf++ * 180
    const positions = children[i].map(place)
    return x[i] = (positions[0] + positions[positions.length - 1]) / 2
  }
  roots.forEach(place)
  const width = Math.max(300, 200 + Math.max(0, leaf - 1) * 180)
  const maxDepth = Math.max(0, ...rows.map((row) => row.depth))
  const height = 205 + maxDepth * 105
  const points: TreePoint[] = rows.map((row, i) => ({ x: Math.max(85, Math.min(width - 85, x[i] + (row.depth % 2 ? 24 : -12))), y: 72 + (maxDepth - row.depth) * 105 }))
  return { width, height, points, roots }
}

export function branchPath(from: TreePoint, to: TreePoint) {
  const bend = (from.y + to.y) / 2
  return `M ${from.x} ${from.y} C ${from.x} ${bend}, ${to.x} ${bend}, ${to.x} ${to.y}`
}
