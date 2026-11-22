/** Opt-in session capabilities (composer Tools menu). A new chat starts with the built-in browser on. */
export const CAPABILITY_IDS = ['pi-ui', 'browser', 'chrome', 'web-search', 'computer', 'work-team'] as const
export type CapabilityId = (typeof CAPABILITY_IDS)[number]

/** A conversation nobody switched anything in drives the built-in browser; the rest stay opt-in. */
export const DEFAULT_CAPABILITIES: readonly CapabilityId[] = ['browser']

export interface CapabilityInfo {
  id: CapabilityId
  /** False when it cannot be used right now (shown disabled in the menu). */
  available: boolean
  /** Why it is unavailable, e.g. 'browser-panel-off'. */
  reason?: string
  /** Rough size of the text added to the system prompt while on (chars / 4). */
  /** Estimated tokens added to every request while on: prompt text plus tool definitions. */
  promptTokens: number
  /** Extra tools the model gets while on. */
  tools: number
  /** Of those, how many are declared on every request; the rest load through tool_search. */
  coreTools?: number
}

export function normalizeCapabilities(raw: unknown): CapabilityId[] {
  if (!Array.isArray(raw)) return []
  const out: CapabilityId[] = []
  for (const id of raw) {
    if ((CAPABILITY_IDS as readonly unknown[]).includes(id) && !out.includes(id as CapabilityId)) out.push(id as CapabilityId)
  }
  return out
}

/**
 * Computer-use tools: the namespace tool `computer` itself and every `computer_*` / `computer-*`
 * action (`computer_click`, …). The bare namespace name must match too: pi-agent-computer-use can
 * operate the desktop through it, so treating it as "not a computer tool" left a way around the
 * switch.
 */
export function isComputerCapabilityTool(name: string): boolean {
  return /^computer(?:[_-]|$)/i.test(name)
}

/** Web-search package tools (pi-search: search, search_*, web_fetch, web_map, docs_search, plan_*). */
export function isWebSearchCapabilityTool(name: string): boolean {
  return /^(?:search(?:[_-]|$)|docs_search|web_fetch|web_map|context7_|plan_)/i.test(name)
}
