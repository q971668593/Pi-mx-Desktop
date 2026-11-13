import { describe, expect, it } from 'vitest'
import { modelThinkingLevels } from './model-thinking-levels'

describe('model thinking levels', () => {
  it('uses provider mappings and omits explicitly unsupported levels', () => {
    expect(modelThinkingLevels({ reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' } })).toEqual(['low', 'high', 'max'])
    expect(modelThinkingLevels({ reasoning: false })).toEqual(['off'])
    expect(modelThinkingLevels({})).toBeUndefined()
  })
})
