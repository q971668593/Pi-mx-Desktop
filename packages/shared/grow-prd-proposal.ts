import { z } from 'zod'
import { GROW_MAX_OPTIONS, GROW_MAX_OPTION_LENGTH } from './grow-question.js'

// These limits bound an untrusted proposal before it is shown or stored by a caller.
export const GROW_PROPOSAL_MAX_PRD_BYTES = 2 * 1024 * 1024
export const GROW_PROPOSAL_MAX_CHANGES = 100
export const GROW_PROPOSAL_MAX_QUESTIONS = 100

const encoder = new TextEncoder()
const text = (maxBytes: number, nonempty = true) => z.string().refine(
  (value) => (!nonempty || !!value.trim()) && !value.includes('\0') &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value) &&
    encoder.encode(value).length <= maxBytes,
  { message: `Must be valid text of at most ${maxBytes} UTF-8 bytes${nonempty ? ' and not blank' : ''}` },
)
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid ID')
const option = text(GROW_MAX_OPTION_LENGTH).refine((value) => value === value.trim(), 'Option must be trimmed')
const question = z.object({
  id,
  question: text(500),
  rationale: text(500, false).optional(),
  chapter_id: id.optional(),
  depends_on: z.array(id).max(8).optional(),
  kind: z.enum(['single', 'multiple', 'text']),
  options: z.array(option).max(GROW_MAX_OPTIONS).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'text' && value.options !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Text questions must not have options' })
  }
  if (value.kind !== 'text' && (!value.options || value.options.length < 2)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Choice questions require at least two options' })
  }
  if (value.options && new Set(value.options).size !== value.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Duplicate options' })
  }
  if (value.depends_on && (new Set(value.depends_on).size !== value.depends_on.length || value.depends_on.includes(value.id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['depends_on'], message: 'Duplicate or self dependency' })
  }
})

export const growPrdProposalSchema = z.object({
  basePrdHash: z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 hash'),
  treeSessionId: id,
  baseTreeRevision: z.number().int().nonnegative().safe(),
  reason: text(8192),
  proposedPrd: text(GROW_PROPOSAL_MAX_PRD_BYTES),
  nodeChanges: z.array(z.object({
    nodeId: id,
    expectedOldAnswer: text(8192, false).nullable(),
    newAnswer: text(8192),
  }).strict()).max(GROW_PROPOSAL_MAX_CHANGES),
  newQuestions: z.array(question).max(GROW_PROPOSAL_MAX_QUESTIONS),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>()
  for (const [index, change] of value.nodeChanges.entries()) {
    if (ids.has(change.nodeId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodeChanges', index, 'nodeId'], message: 'Duplicate node ID' })
    ids.add(change.nodeId)
  }
  for (const [index, item] of value.newQuestions.entries()) {
    if (ids.has(item.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newQuestions', index, 'id'], message: 'Duplicate node ID' })
    ids.add(item.id)
  }
})

export type GrowPrdProposal = z.infer<typeof growPrdProposalSchema>
export type GrowPrdProposalResult =
  | { ok: true; value: GrowPrdProposal }
  | { ok: false; errors: Array<{ path: string; message: string }> }

/** Validation only. A successful result is neither confirmation nor a state comparison. */
export function validateGrowPrdProposal(input: unknown): GrowPrdProposalResult {
  const result = growPrdProposalSchema.safeParse(input)
  if (result.success) return { ok: true, value: result.data }
  return { ok: false, errors: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }
}
