export interface DecisionTreeNode {
  id: string
  question: string
  status: 'pending' | 'answered' | 'deferred' | 'needs_review'
  round: number
  depends_on: string[]
  options: Array<{ id: string; label: string }>
  answer: { option_ids: string[]; text: string; deferred?: boolean } | null
}
export interface DecisionTreeData {
  session_id: string
  schema_version: number
  status: string
  current_round: number
  nodes: DecisionTreeNode[]
}
export function createDecisionTree(container: HTMLElement, callbacks?: {
  onNode?: (id: string, element: SVGElement) => void
  onFruit?: (fruit: { id: string }) => void
}): {
  update(tree: DecisionTreeData): void
  destroy(): void
}
