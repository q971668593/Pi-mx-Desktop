import { describe, expect, it } from 'vitest'
import { formatQuotaSummary, hasQuotaData } from './status-quota'

const EMPTY = { provider: 'codex', windows: [] }
const DASHES = {
  provider: 'codex',
  balance: '--',
  windows: [{ name: '5 hours', usedPercent: NaN, remainingPercent: NaN }],
}
const CODEX = {
  provider: 'codex',
  balance: 100,
  windows: [
    { name: '5 hours', usedPercent: 38, remainingPercent: 62, resetsAt: '2026-11-28T13:59:11' },
    { name: '7 days', usedPercent: 10, remainingPercent: 90 },
  ],
}

describe('hasQuotaData', () => {
  it('hides entries without usable numbers', () => {
    expect(hasQuotaData(undefined)).toBe(false)
    expect(hasQuotaData(EMPTY)).toBe(false)
    expect(hasQuotaData(DASHES)).toBe(false)
  })

  it('keeps entries with balance or window numbers', () => {
    expect(hasQuotaData(CODEX)).toBe(true)
    expect(hasQuotaData({ provider: 'opencode-go', windows: [{ name: 'Month', usedPercent: 0, remainingPercent: 100 }] })).toBe(true)
  })
})

describe('formatQuotaSummary', () => {
  it('returns null when neither side has data (status bar hides the button)', () => {
    expect(formatQuotaSummary(DASHES, EMPTY)).toBeNull()
    expect(formatQuotaSummary(undefined, undefined)).toBeNull()
  })

  it('only mentions the side that has data', () => {
    expect(formatQuotaSummary(CODEX, DASHES)).toBe('Codex 5 hours剩62%')
  })
})
