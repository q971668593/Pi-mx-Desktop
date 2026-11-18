import { describe, expect, it } from 'vitest'
import {
  FLAG_REGISTRY,
  OPT_IN_ONLY,
  assertKnownFlag,
  canonicalFlag,
  describeFlags,
  isFlagEnabled,
  parseFlags,
  resolveFlags,
  type FeatureFlag,
} from './feature-flags'

const ALL = Object.keys(FLAG_REGISTRY) as FeatureFlag[]

describe('feature flags registry', () => {
  it('every registered flag has a human readable description', () => {
    for (const flag of ALL) {
      expect(FLAG_REGISTRY[flag].length).toBeGreaterThan(6)
    }
  })

  it('opt-in-only flags are registered flags', () => {
    for (const flag of OPT_IN_ONLY) expect(ALL).toContain(flag)
  })
})

describe('parseFlags', () => {
  it('returns empty sets for undefined / blank input', () => {
    expect(parseFlags(undefined)).toEqual({ enabled: [], disabled: [], unknown: [] })
    expect(parseFlags('   ')).toEqual({ enabled: [], disabled: [], unknown: [] })
  })

  it('enables named flags', () => {
    const parsed = parseFlags('plugin_manager, session_tree_diff')
    expect(parsed.enabled).toEqual(['plugin_manager', 'session_tree_diff'])
    expect(parsed.disabled).toEqual([])
  })

  it('treats `all` as every flag except opt-in-only ones', () => {
    const parsed = parseFlags('all')
    expect(parsed.enabled).toEqual(ALL.filter((flag) => !OPT_IN_ONLY.has(flag)))
  })

  it('lets `-name` win over `all` and reports unknown tokens', () => {
    const parsed = parseFlags('all,-plugin_manager,not_a_flag')
    expect(parsed.enabled).not.toContain('plugin_manager')
    expect(parsed.disabled).toEqual(['plugin_manager'])
    expect(parsed.unknown).toEqual(['not_a_flag'])
  })

  it('resolves aliases to the canonical flag', () => {
    expect(canonicalFlag('plugin_manager')).toBe('plugin_manager')
    expect(canonicalFlag('nope')).toBeNull()
  })
})

describe('resolveFlags', () => {
  it('defaults to off in release builds', () => {
    const { flags } = resolveFlags({ env: {}, isDev: false })
    for (const flag of ALL) expect(flags.get(flag)).toBe(false)
  })

  it('defaults to on in dev builds, except opt-in-only flags', () => {
    const { flags } = resolveFlags({ env: {}, isDev: true })
    for (const flag of ALL) expect(flags.get(flag)).toBe(!OPT_IN_ONLY.has(flag))
  })

  it('lets env turn a flag on in release and off in dev', () => {
    expect(isFlagEnabled('plugin_manager', { env: { PI_FLAGS: 'plugin_manager' }, isDev: false })).toBe(true)
    expect(isFlagEnabled('plugin_manager', { env: { PI_FLAGS: '-plugin_manager' }, isDev: true })).toBe(false)
  })

  it('surfaces unknown env tokens instead of throwing', () => {
    const resolved = resolveFlags({ env: { PI_FLAGS: 'plugin_manager,plugin_manger' }, isDev: false })
    expect(resolved.unknown).toEqual(['plugin_manger'])
    expect(resolved.flags.get('plugin_manager')).toBe(true)
  })
})

describe('helpers', () => {
  it('assertKnownFlag throws with a helpful message for typos', () => {
    expect(() => assertKnownFlag('plugin_manger')).toThrowError(/未知特性开关/)
    expect(assertKnownFlag('plugin_manager')).toBe('plugin_manager')
  })

  it('describeFlags lists every flag with its resolved state', () => {
    const rows = describeFlags({ env: {}, isDev: true })
    expect(rows).toHaveLength(ALL.length)
    expect(rows.every((row) => typeof row.description === 'string' && row.description.length > 0)).toBe(true)
    const pluginManager = rows.find((row) => row.flag === 'plugin_manager')
    expect(pluginManager?.enabled).toBe(true)
    expect(pluginManager?.optInOnly).toBe(false)
  })
})
