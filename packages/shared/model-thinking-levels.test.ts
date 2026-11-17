import { describe, expect, it } from 'vitest'
import { modelThinkingLevels } from './model-thinking-levels'

describe('model thinking levels', () => {
  it('uses provider mappings and omits explicitly unsupported levels', () => {
    expect(modelThinkingLevels({ reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' } })).toEqual(['low', 'high', 'max'])
    expect(modelThinkingLevels({ reasoning: false })).toEqual(['off'])
  })

  it('treats a missing reasoning flag as non-reasoning, like the pi SDK', () => {
    // The SDK reads `definition.reasoning ?? false`, so a model without the flag only
    // supports `off`. Returning undefined here would make the UI offer levels the
    // runtime then silently clamps away.
    expect(modelThinkingLevels({})).toEqual(['off'])
    expect(modelThinkingLevels({ thinkingLevelMap: { high: 'high' } })).toEqual(['off'])
  })

  it('includes xhigh and max only when the provider maps them', () => {
    expect(modelThinkingLevels({ reasoning: true })).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(modelThinkingLevels({ reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' } })).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
  })
})
