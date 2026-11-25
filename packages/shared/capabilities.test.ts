import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPABILITIES,
  isComputerCapabilityTool,
  isWebSearchCapabilityTool,
  normalizeCapabilities,
} from './capabilities'

describe('session capability ids', () => {
  it('defaults a new conversation to the built-in browser and web search', () => {
    expect(DEFAULT_CAPABILITIES).toEqual(['browser', 'web-search'])
  })

  it('keeps known ids once and drops unknown ones', () => {
    expect(normalizeCapabilities(['browser', 'browser', 'bogus', 'computer'])).toEqual(['browser', 'computer'])
    expect(normalizeCapabilities('browser')).toEqual([])
  })

  it('recognises every computer-use tool name, including the bare namespace tool', () => {
    for (const name of ['computer', 'computer_click', 'computer-read', 'Computer_Read']) {
      expect(isComputerCapabilityTool(name)).toBe(true)
    }
    for (const name of ['computers', 'browser_click', 'bash', 'read']) expect(isComputerCapabilityTool(name)).toBe(false)
  })

  it('recognises web-search package tools', () => {
    for (const name of ['search', 'web_fetch', 'docs_search', 'context7_query']) expect(isWebSearchCapabilityTool(name)).toBe(true)
    for (const name of ['searcher', 'researcher', 'browser_click']) expect(isWebSearchCapabilityTool(name)).toBe(false)
  })
})
