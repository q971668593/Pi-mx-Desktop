export const MODEL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ModelThinkingLevel = typeof MODEL_THINKING_LEVELS[number]

export function modelThinkingLevels(model: { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }): ModelThinkingLevel[] | undefined {
  if (model.reasoning === false) return ['off']
  if (model.reasoning !== true) return undefined
  return MODEL_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    return level !== 'xhigh' && level !== 'max' || mapped !== undefined
  })
}
