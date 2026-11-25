import { describe, expect, it } from 'vitest'
import type { GrowNode } from './grow-types'
import { layoutGrowTree } from './grow-mini-tree'

const node = (id: string, depends_on?: string[]): GrowNode => ({ id, question: id, status: 'pending', depends_on })

describe('需求树分支布局', () => {
  it('uses actual dependencies and leaves unrelated legacy questions as roots', () => {
    const rows = layoutGrowTree([node('a'), node('b', ['a']), node('c', ['b']), node('old')])
    expect(rows.map(({ node, depth, parentIndex }) => [node.id, depth, parentIndex])).toEqual([
      ['a', 0, null], ['b', 1, 0], ['c', 2, 1], ['old', 0, null],
    ])
  })
  it('keeps all questions visible when old data contains a cycle', () => {
    const rows = layoutGrowTree([node('a', ['b']), node('b', ['a'])])
    expect(rows.map(({ node }) => node.id).sort()).toEqual(['a', 'b'])
  })
})
