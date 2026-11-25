export type GrowChoiceKind = 'single' | 'multiple'
export type GrowQuestionKind = GrowChoiceKind | 'text'

export interface GrowQuestionFormat {
  kind?: GrowQuestionKind
  options?: string[]
}

export const GROW_MAX_OPTIONS = 8
export const GROW_MAX_OPTION_LENGTH = 160

export function normalizeGrowQuestionFormat(kind: unknown, options: unknown): GrowQuestionFormat {
  if (kind === 'text') return { kind }
  if (!Array.isArray(options) || options.length > GROW_MAX_OPTIONS) return {}
  const labels: string[] = []
  for (const option of options) {
    if (typeof option !== 'string') return {}
    const label = option.trim()
    if (!label || label.length > GROW_MAX_OPTION_LENGTH || labels.includes(label)) return {}
    labels.push(label)
  }
  if (labels.length < 2) return {}
  if (kind === 'single' || kind === 'multiple') return { kind, options: labels }
  return { options: labels }
}

export function resolveGrowQuestionFormat(saved: GrowQuestionFormat | undefined, published: GrowQuestionFormat): GrowQuestionFormat {
  if (saved?.kind) return saved
  if (!saved?.options) return published
  const choicesMatch = published.options?.length === saved.options.length && saved.options.every((option) => published.options?.includes(option))
  return choicesMatch ? { kind: published.kind, options: saved.options } : { options: saved.options }
}
