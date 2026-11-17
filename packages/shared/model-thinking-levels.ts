export const MODEL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ModelThinkingLevel = typeof MODEL_THINKING_LEVELS[number]

/**
 * Available thinking levels for a model, or `undefined` when unknown.
 *
 * Must agree with the pi SDK (`@earendil-works/pi-ai` → `getSupportedThinkingLevels`):
 * the SDK reads `definition.reasoning ?? false`, so a model without an explicit
 * `reasoning: true` only supports `off`. Returning `undefined` here would make the
 * UI offer levels the runtime then silently clamps away — the slider would move and
 * the model would not actually think.
 */
export function modelThinkingLevels(model: { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }): ModelThinkingLevel[] | undefined {
  if (model.reasoning !== true) return ['off']
  return MODEL_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    return level !== 'xhigh' && level !== 'max' || mapped !== undefined
  })
}
