import { describe, expect, it } from 'vitest'
import { formatCommitDate, layoutCommitGraph } from './git-graph'

describe('commit date label', () => {
  it('uses MM-DD HH:mm:ss inside the current year', () => {
    const time = Math.floor(new Date(2026, 0, 5, 12, 34, 56).getTime() / 1000)
    expect(formatCommitDate(time, new Date(2026, 5, 1))).toBe('01-05 12:34:56')
  })

  it('adds the year for older commits', () => {
    const time = Math.floor(new Date(2025, 10, 9, 8, 5, 7).getTime() / 1000)
    expect(formatCommitDate(time, new Date(2026, 5, 1))).toBe('2025-11-09 08:05:07')
  })

  it('returns an empty label without a timestamp', () => {
    expect(formatCommitDate(0)).toBe('')
  })
})

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
