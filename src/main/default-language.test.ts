import { describe, expect, it } from 'vitest'
import { defaultAppLanguage } from './default-language'

describe('defaultAppLanguage', () => {
  it('defaults to Simplified Chinese regardless of system locale', () => {
    expect(defaultAppLanguage()).toBe('zh')
  })
})
