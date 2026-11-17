import { describe, expect, it } from 'vitest'
import { defaultModelEntry } from './models-settings-shared'

describe('defaultModelEntry', () => {
  it('marks common reasoning model families as reasoning models', () => {
    expect(defaultModelEntry('o3-mini').reasoning).toBe(true)
    expect(defaultModelEntry('gpt-5.2').reasoning).toBe(true)
    expect(defaultModelEntry('claude-opus-4').reasoning).toBe(true)
    expect(defaultModelEntry('deepseek-v4.1-flash').reasoning).toBe(true)
  })

  it('matches on the model name, so a vendor prefix does not hide a reasoning model', () => {
    // Provider-prefixed ids are the norm for aggregators; the SDK reads
    // `definition.reasoning ?? false`, so a false negative clamps every level to off.
    expect(defaultModelEntry('opendesign/deepseek-v4.1-flash').reasoning).toBe(true)
    expect(defaultModelEntry('codex/gpt-6-luna').reasoning).toBe(true)
    expect(defaultModelEntry('zcode/GLM-5.3-Flash').reasoning).toBe(true)
    expect(defaultModelEntry('workbuddy/minimax-m3.1-flash').reasoning).toBe(true)
  })

  it('leaves a plain model without reasoning rather than guessing wrong', () => {
    expect(defaultModelEntry('some-plain-model').reasoning).toBeUndefined()
    expect(defaultModelEntry('some-plain-model').thinkingLevelMap).toBeUndefined()
  })

  it('gives reasoning models the extended levels the SDK needs', () => {
    expect(defaultModelEntry('gpt-5').thinkingLevelMap).toEqual({ xhigh: 'xhigh', max: 'max' })
  })

  it('detects vision input from the model name', () => {
    expect(defaultModelEntry('gpt-5-vision').input).toEqual(['text', 'image'])
    expect(defaultModelEntry('plain-model').input).toEqual(['text'])
  })
})
