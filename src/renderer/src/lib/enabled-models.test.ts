import { describe, expect, it } from 'vitest'
import { filterEnabledModels } from './enabled-models'

const catalog = [
  { provider: 'openai-codex', id: 'gpt-5' },
  { provider: 'openai-codex', id: 'gpt-6' },
  { provider: 'custom', id: 'gpt-5' },
  { provider: 'custom', id: 'vendor/model' },
]

describe('enabled model scope', () => {
  it('defaults to all models and keeps provider-qualified selections separate', () => {
    expect(filterEnabledModels(catalog)).toEqual(catalog)
    expect(filterEnabledModels(catalog, [])).toEqual(catalog)
    expect(filterEnabledModels(catalog, ['openai-codex/gpt-5'])).toEqual([catalog[0]])
  })
  it('supports SDK glob syntax, nested ids and thinking suffixes', () => {
    expect(filterEnabledModels(catalog, ['openai-codex/gpt-?'])).toEqual(catalog.slice(0, 2))
    expect(filterEnabledModels(catalog, ['custom/vendor/*:high'])).toEqual([catalog[3]])
    expect(filterEnabledModels(catalog, ['*/gpt-[56]'])).toEqual(catalog.slice(0, 3))
    expect(filterEnabledModels(catalog, ['missing/*'])).toEqual([])
  })
})
