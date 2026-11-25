import { createHash } from 'node:crypto'
import { validateGrowPrdProposal } from '../../packages/shared/grow-prd-proposal'

type Node = Record<string, unknown> & { id: string; depends_on?: string[] }
type Tree = Record<string, unknown> & { session_id: string; revision: number; nodes: Node[] }

export class GrowPrdPreviewError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'GrowPrdPreviewError'
  }
}

function fail(code: string, message: string): never { throw new GrowPrdPreviewError(code, message) }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const idPattern = /^[A-Za-z0-9_-]{1,64}$/

/** Builds a detached candidate only. Callers must recheck both baselines at commit time. */
export function buildGrowPrdPreview(input: {
  proposal: unknown
  sessionId: string
  basePrd: string
  treeJson: string
  planExists: boolean
}) {
  const validated = validateGrowPrdProposal(input?.proposal)
  if (!validated.ok) fail('INVALID_PROPOSAL', validated.errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; '))
  const proposal = validated.value
  if (typeof input.sessionId !== 'string' || !idPattern.test(input.sessionId) || typeof input.basePrd !== 'string' || typeof input.treeJson !== 'string' || typeof input.planExists !== 'boolean') {
    fail('INVALID_INPUT', 'Expected sessionId, baseline PRD, tree JSON and planExists')
  }
  if (proposal.treeSessionId !== input.sessionId) fail('SESSION_MISMATCH', 'Proposal session does not match the bound session')
  if (createHash('sha256').update(input.basePrd, 'utf8').digest('hex') !== proposal.basePrdHash) fail('PRD_CONFLICT', 'Baseline PRD SHA-256 does not match')
  let raw: unknown
  try { raw = JSON.parse(input.treeJson.replace(/^\uFEFF/, '')) } catch { fail('INVALID_TREE', 'Tree is not valid JSON') }
  if (!object(raw) || !Array.isArray(raw.nodes) || typeof raw.session_id !== 'string' || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0) fail('INVALID_TREE', 'Tree requires session_id, nonnegative safe revision and nodes')
  const tree = raw as Tree
  if (tree.session_id !== input.sessionId) fail('SESSION_MISMATCH', 'Tree session does not match the bound session')
  if (tree.revision !== proposal.baseTreeRevision) fail('REVISION_CONFLICT', 'Tree revision does not match proposal')
  if (tree.revision === Number.MAX_SAFE_INTEGER) fail('INVALID_TREE', 'Tree revision cannot be incremented safely')
  const byId = new Map<string, Node>()
  for (const node of tree.nodes) {
    if (!object(node) || typeof node.id !== 'string' || !idPattern.test(node.id)) fail('INVALID_TREE', 'Invalid node ID')
    if (byId.has(node.id)) fail('DUPLICATE_NODE', `Duplicate node ID: ${node.id}`)
    if (node.answer !== undefined && node.answer !== null && typeof node.answer !== 'string') fail('INVALID_TREE', `Invalid answer for node: ${node.id}`)
    if (node.depends_on !== undefined && (!Array.isArray(node.depends_on) || node.depends_on.some((id: unknown) => typeof id !== 'string' || !idPattern.test(id)) || new Set(node.depends_on).size !== node.depends_on.length)) fail('INVALID_DEPENDENCY', `Invalid dependencies for node: ${node.id}`)
    byId.set(node.id, node as Node)
  }
  for (const change of proposal.nodeChanges) {
    const node = byId.get(change.nodeId)
    if (!node) fail('NODE_NOT_FOUND', `Node not found: ${change.nodeId}`)
    if ((node.answer ?? null) !== change.expectedOldAnswer) fail('ANSWER_CONFLICT', `Old answer does not match node: ${change.nodeId}`)
  }
  for (const question of proposal.newQuestions) {
    if (byId.has(question.id)) fail('DUPLICATE_NODE', `Duplicate node ID: ${question.id}`)
    const node: Node = { ...question, status: 'pending', ...(typeof tree.current_round === 'number' ? { round: tree.current_round } : {}) }
    tree.nodes.push(node)
    byId.set(node.id, node)
  }
  // Kahn's algorithm checks every reference and detects cycles without recursive stack limits.
  const children = new Map<string, string[]>()
  const degree = new Map<string, number>()
  for (const node of tree.nodes) {
    const dependencies = node.depends_on ?? []
    degree.set(node.id, dependencies.length)
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) fail('INVALID_DEPENDENCY', `Node ${node.id} references missing node ${dependency}`)
      const list = children.get(dependency) ?? []
      list.push(node.id)
      children.set(dependency, list)
    }
  }
  const queue = [...degree].filter(([, count]) => count === 0).map(([id]) => id)
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]!) ?? []) {
    const count = degree.get(child)! - 1
    degree.set(child, count)
    if (count === 0) queue.push(child)
  }
  if (queue.length !== byId.size) fail('DEPENDENCY_CYCLE', 'Tree dependencies contain a cycle')

  const beforeNodes = new Map<string, Node>()
  for (const node of tree.nodes) if (!proposal.newQuestions.some((q) => q.id === node.id)) beforeNodes.set(node.id, { ...node })
  const roots: string[] = []
  for (const change of proposal.nodeChanges) {
    const node = byId.get(change.nodeId)!
    const changed = node.answer !== change.newAnswer || node.status !== 'answered'
    if (node.answer !== change.newAnswer) delete node.selectedOptions
    node.answer = change.newAnswer
    node.status = 'answered'
    if (changed) roots.push(node.id)
  }
  const affected = new Set<string>()
  const pending = [...roots]
  const visited = new Set(roots)
  for (let i = 0; i < pending.length; i++) for (const child of children.get(pending[i]!) ?? []) {
    affected.add(child)
    if (!visited.has(child)) { visited.add(child); pending.push(child) }
  }
  const explicitlyChanged = new Set(proposal.nodeChanges.map((change) => change.nodeId))
  for (const id of affected) {
    const node = byId.get(id)!
    if (!explicitlyChanged.has(id) && (node.status === 'answered' || node.status === 'deferred')) node.status = 'needs_review'
  }
  if (input.planExists) tree.plan_stale = true
  tree.revision++
  const newTreeJson = JSON.stringify(tree, null, 2)
  if (Buffer.byteLength(newTreeJson, 'utf8') > 2 * 1024 * 1024) fail('TREE_TOO_LARGE', 'Resulting tree exceeds 2 MiB')
  const changes = tree.nodes.flatMap((node) => {
    const before = beforeNodes.get(node.id) ?? null
    return before === null || JSON.stringify(before) !== JSON.stringify(node) ? [{ nodeId: node.id, before, after: node }] : []
  })
  return {
    sessionId: input.sessionId,
    reason: proposal.reason,
    newTreeJson,
    changes,
    affectedNodeIds: tree.nodes.filter((node) => affected.has(node.id)).map((node) => node.id),
    comparison: { prd: { before: input.basePrd, after: proposal.proposedPrd }, tree: { before: input.treeJson, after: newTreeJson } },
  }
}
