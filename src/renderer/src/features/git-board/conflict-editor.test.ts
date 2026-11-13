import { describe, expect, it } from 'vitest'
import { applyConflictChoices, parseConflicts } from './conflict-editor'

describe('conflict editor', () => {
  it('keeps unresolved blocks and applies mixed choices', () => {
    const content = 'before\n<<<<<<< ours\nleft\n=======\nright\n>>>>>>> theirs\nafter\n<<<<<<< ours\nkeep\n=======\ndrop\n>>>>>>> theirs\n'
    const nodes = parseConflicts(content)
    const choices = new Map([[0, 'both' as const]])
    const result = applyConflictChoices(nodes, choices)
    expect(result.unresolved).toBe(1)
    expect(result.lines).toEqual([
      'before',
      'left',
      'right',
      'after',
      '<<<<<<< ours',
      'keep',
      '=======',
      'drop',
      '>>>>>>> theirs',
      '',
    ])
  })
})
