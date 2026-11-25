import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildGrowPrdPreview } from './grow-prd-preview'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function fixture() {
  const tree = { session_id: 's1', revision: 3, current_round: 2, extra: { keep: true }, nodes: [
    { id: 'a', question: 'A', status: 'answered', answer: 'old', selectedOptions: ['old'], custom: 42 },
    { id: 'b', status: 'deferred', answer: 'B', depends_on: ['a'] },
    { id: 'c', status: 'answered', answer: 'C', depends_on: ['b'] },
    { id: 'd', status: 'answered', answer: 'D' },
  ] }
  const proposal = { basePrdHash: hash('原文\r\n'), treeSessionId: 's1', baseTreeRevision: 3, reason: '需求变更', proposedPrd: '新文\n',
    nodeChanges: [{ nodeId: 'a', expectedOldAnswer: 'old', newAnswer: 'new' }],
    newQuestions: [{ id: 'e', question: '新问题', kind: 'text', depends_on: ['c'] }],
  }
  return { proposal, sessionId: 's1', basePrd: '原文\r\n', treeJson: JSON.stringify(tree), planExists: true }
}
const error = (input: Parameters<typeof buildGrowPrdPreview>[0], code: string) => {
  expect(() => buildGrowPrdPreview(input)).toThrow(expect.objectContaining({ code }))
}

describe('buildGrowPrdPreview', () => {
  it('builds a complete detached comparison and propagates review only along dependencies', () => {
    const input = fixture()
    const snapshot = JSON.stringify(input)
    const result = buildGrowPrdPreview(input)
    const tree = JSON.parse(result.newTreeJson)
    expect(tree).toMatchObject({ session_id: 's1', revision: 4, plan_stale: true, extra: { keep: true }, nodes: [
      { id: 'a', answer: 'new', status: 'answered', custom: 42 },
      { id: 'b', answer: 'B', status: 'needs_review' },
      { id: 'c', answer: 'C', status: 'needs_review' },
      { id: 'd', answer: 'D', status: 'answered' },
      { id: 'e', status: 'pending', round: 2, depends_on: ['c'] },
    ] })
    expect(tree.nodes[0]).not.toHaveProperty('selectedOptions')
    expect(result.affectedNodeIds).toEqual(['b', 'c', 'e'])
    expect(result.changes.map((c) => c.nodeId)).toEqual(['a', 'b', 'c', 'e'])
    expect(result.comparison).toEqual({ prd: { before: input.basePrd, after: '新文\n' }, tree: { before: input.treeJson, after: result.newTreeJson } })
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(buildGrowPrdPreview(input)).toEqual(result)
  })
  it('preserves existing stale state and does not invent it without a plan', () => {
    const input = fixture()
    input.planExists = false
    expect(JSON.parse(buildGrowPrdPreview(input).newTreeJson)).not.toHaveProperty('plan_stale')
    input.treeJson = JSON.stringify({ ...JSON.parse(input.treeJson), plan_stale: true })
    expect(JSON.parse(buildGrowPrdPreview(input).newTreeJson).plan_stale).toBe(true)
  })
  it('rejects invalid proposals and all baseline conflicts', () => {
    const input = fixture()
    error({ ...input, proposal: { ...input.proposal, reason: '' } }, 'INVALID_PROPOSAL')
    error({ ...input, sessionId: 'other' }, 'SESSION_MISMATCH')
    error({ ...input, treeJson: JSON.stringify({ ...JSON.parse(input.treeJson), session_id: 'other' }) }, 'SESSION_MISMATCH')
    error({ ...input, basePrd: '原文\n' }, 'PRD_CONFLICT')
    error({ ...input, proposal: { ...input.proposal, baseTreeRevision: 2 } }, 'REVISION_CONFLICT')
    error({ ...input, proposal: { ...input.proposal, nodeChanges: [{ nodeId: 'a', expectedOldAnswer: null, newAnswer: 'x' }] } }, 'ANSWER_CONFLICT')
    error({ ...input, proposal: { ...input.proposal, nodeChanges: [{ nodeId: 'missing', expectedOldAnswer: null, newAnswer: 'x' }] } }, 'NODE_NOT_FOUND')
  })
  it('rejects malformed trees, duplicate IDs, dangling edges and cycles across old and new nodes', () => {
    const input = fixture()
    error({ ...input, treeJson: '{' }, 'INVALID_TREE')
    const tree = JSON.parse(input.treeJson)
    error({ ...input, treeJson: JSON.stringify({ ...tree, nodes: [...tree.nodes, tree.nodes[0]] }) }, 'DUPLICATE_NODE')
    error({ ...input, proposal: { ...input.proposal, newQuestions: [{ id: 'd', question: 'X', kind: 'text' }] } }, 'DUPLICATE_NODE')
    error({ ...input, proposal: { ...input.proposal, newQuestions: [{ id: 'e', question: 'X', kind: 'text', depends_on: ['missing'] }] } }, 'INVALID_DEPENDENCY')
    tree.nodes[0].depends_on = ['e']
    error({ ...input, treeJson: JSON.stringify(tree) }, 'DEPENDENCY_CYCLE')
    tree.nodes[0].depends_on = ['a']
    error({ ...input, treeJson: JSON.stringify(tree) }, 'DEPENDENCY_CYCLE')
  })
  it('keeps unchanged choices and treats explicitly revised dependent answers as confirmed', () => {
    const input = fixture()
    input.proposal.nodeChanges[0]!.newAnswer = 'old'
    let result = JSON.parse(buildGrowPrdPreview(input).newTreeJson)
    expect(result.nodes[0].selectedOptions).toEqual(['old'])
    expect(result.nodes[1].status).toBe('deferred')
    input.proposal.nodeChanges = [
      { nodeId: 'a', expectedOldAnswer: 'old', newAnswer: 'new' },
      { nodeId: 'b', expectedOldAnswer: 'B', newAnswer: 'new B' },
    ]
    result = JSON.parse(buildGrowPrdPreview(input).newTreeJson)
    expect(result.nodes[1]).toMatchObject({ answer: 'new B', status: 'answered' })
    expect(result.nodes[2].status).toBe('needs_review')
  })
  it('rejects a candidate exceeding the transaction size limit', () => {
    const input = fixture()
    input.treeJson = JSON.stringify({ ...JSON.parse(input.treeJson), extra: 'x'.repeat(2 * 1024 * 1024) })
    error(input, 'TREE_TOO_LARGE')
  })
  it('does not propagate an unchanged answer and accepts a BOM tree', () => {
    const input = fixture()
    const tree = JSON.parse(input.treeJson)
    delete tree.nodes[0].selectedOptions
    input.treeJson = '\uFEFF' + JSON.stringify(tree)
    input.planExists = false
    input.proposal.nodeChanges[0]!.newAnswer = 'old'
    const result = buildGrowPrdPreview(input)
    expect(result.affectedNodeIds).toEqual([])
    expect(JSON.parse(result.newTreeJson).nodes[1].status).toBe('deferred')
  })
})
