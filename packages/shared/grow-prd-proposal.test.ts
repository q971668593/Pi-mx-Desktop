import { describe, expect, it } from 'vitest'
import { GROW_PROPOSAL_MAX_CHANGES, GROW_PROPOSAL_MAX_PRD_BYTES, validateGrowPrdProposal } from './grow-prd-proposal.js'

const proposal = () => ({
  basePrdHash: 'a'.repeat(64), treeSessionId: 'session-1', baseTreeRevision: 0,
  reason: '同步需求', proposedPrd: '# PRD\n完整内容',
  nodeChanges: [{ nodeId: 'old', expectedOldAnswer: null, newAnswer: '新答案' }],
  newQuestions: [{ id: 'new', question: '选择？', kind: 'single', options: ['甲', '乙'], depends_on: ['old'], chapter_id: 'chapter', rationale: '原因' }],
})

function invalid(value: unknown, path?: string) {
  const result = validateGrowPrdProposal(value)
  expect(result.ok).toBe(false)
  if (!result.ok && path) expect(result.errors.some((error) => error.path === path || error.path.startsWith(`${path}.`))).toBe(true)
  expect(() => JSON.stringify(result)).not.toThrow()
}

describe('validateGrowPrdProposal', () => {
  it('returns a serializable detached proposal, preserving baseline and content', () => {
    const input = proposal()
    const result = validateGrowPrdProposal(input)
    expect(result).toEqual({ ok: true, value: input })
    input.nodeChanges[0]!.newAnswer = 'changed'
    if (result.ok) expect(result.value.nodeChanges[0]!.newAnswer).toBe('新答案')
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('rejects unknown values and unknown fields at every object level', () => {
    invalid(null)
    invalid({ ...proposal(), confirmed: true })
    invalid({ ...proposal(), nodeChanges: [{ ...proposal().nodeChanges[0], apply: true }] }, 'nodeChanges.0')
    invalid({ ...proposal(), newQuestions: [{ ...proposal().newQuestions[0], status: 'answered' }] }, 'newQuestions.0')
  })

  it('checks baseline identifiers, safe revisions and answer types', () => {
    invalid({ ...proposal(), basePrdHash: 'A'.repeat(64) }, 'basePrdHash')
    invalid({ ...proposal(), treeSessionId: '../session' }, 'treeSessionId')
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) invalid({ ...proposal(), baseTreeRevision: revision }, 'baseTreeRevision')
    invalid({ ...proposal(), nodeChanges: [{ nodeId: 'x/y', expectedOldAnswer: null, newAnswer: 'a' }] }, 'nodeChanges.0.nodeId')
    invalid({ ...proposal(), nodeChanges: [{ nodeId: 'x', newAnswer: 'a' }] }, 'nodeChanges.0.expectedOldAnswer')
    invalid({ ...proposal(), nodeChanges: [{ nodeId: 'x', expectedOldAnswer: '', newAnswer: ' ' }] }, 'nodeChanges.0.newAnswer')
  })

  it('rejects duplicate IDs and malformed dependencies', () => {
    invalid({ ...proposal(), nodeChanges: [...proposal().nodeChanges, ...proposal().nodeChanges] }, 'nodeChanges.1.nodeId')
    invalid({ ...proposal(), newQuestions: [{ ...proposal().newQuestions[0], id: 'old' }] }, 'newQuestions.0.id')
    invalid({ ...proposal(), newQuestions: [proposal().newQuestions[0], proposal().newQuestions[0]] }, 'newQuestions.1.id')
    for (const depends_on of [['new'], ['old', 'old'], ['../x']]) invalid({ ...proposal(), newQuestions: [{ ...proposal().newQuestions[0], depends_on }] })
  })

  it('enforces choice formats and valid unique options', () => {
    for (const options of [undefined, [], ['甲'], ['甲', '甲'], [' 甲', '乙'], ['甲', ''], Array(9).fill('甲')]) {
      invalid({ ...proposal(), newQuestions: [{ ...proposal().newQuestions[0], options }] }, 'newQuestions.0.options')
    }
    invalid({ ...proposal(), newQuestions: [{ ...proposal().newQuestions[0], kind: 'text' }] }, 'newQuestions.0.options')
    expect(validateGrowPrdProposal({ ...proposal(), newQuestions: [{ id: 'text', question: '为何？', kind: 'text' }] }).ok).toBe(true)
  })

  it('enforces byte and collection limits and valid Unicode', () => {
    expect(validateGrowPrdProposal({ ...proposal(), proposedPrd: 'a'.repeat(GROW_PROPOSAL_MAX_PRD_BYTES) }).ok).toBe(true)
    invalid({ ...proposal(), proposedPrd: 'a'.repeat(GROW_PROPOSAL_MAX_PRD_BYTES + 1) }, 'proposedPrd')
    invalid({ ...proposal(), reason: '中'.repeat(2731) }, 'reason')
    invalid({ ...proposal(), proposedPrd: '\ud800' }, 'proposedPrd')
    invalid({ ...proposal(), reason: 'x\0y' }, 'reason')
    invalid({ ...proposal(), nodeChanges: Array.from({ length: GROW_PROPOSAL_MAX_CHANGES + 1 }, (_, i) => ({ nodeId: `n${i}`, expectedOldAnswer: '', newAnswer: 'a' })) }, 'nodeChanges')
  })
})
