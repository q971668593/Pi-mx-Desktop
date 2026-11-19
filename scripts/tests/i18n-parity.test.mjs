import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compareLocales } from '../check-i18n-parity.mjs'

/**
 * Locale keys must exist in both languages. A key that only exists in `en` silently shows the
 * raw `namespace:key` to Chinese users, and the reverse shows it to English users.
 */
describe('i18n locale parity', () => {
  it('keeps en and zh on the same key set in every namespace', () => {
    const gaps = compareLocales()
    assert.equal(
      gaps.length,
      0,
      gaps.map((gap) => `${gap.locale}/${gap.namespace}: ${gap.missing.join(', ')}`).join('\n') +
        '\nAdd the missing keys (or delete the stale ones) in src/renderer/src/locales/.',
    )
  })
})
