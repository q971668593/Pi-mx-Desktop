import { describe, expect, it } from 'vitest'
import { layoutCommitGraph } from './git-graph'

describe('commit graph lanes', () => {
  it('keeps a merge parent on its own lane', () => {
    const rows = layoutCommitGraph([
      { hash: 'm', parents: ['b', 'a'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ])
    expect(rows.map((row) => [row.commit.hash, row.lane, row.links])).toEqual([
      ['m', 0, [0, 1]],
      ['b', 0, [1]],
      ['a', 1, []],
    ])
    expect(rows[1].passes).toEqual([1])
    expect(rows[2].fromAbove).toBe(true)
  })
})
