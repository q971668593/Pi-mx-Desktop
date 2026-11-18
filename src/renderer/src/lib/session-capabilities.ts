import { create } from 'zustand'
import { projectBrowserSessionKey, sessionHasBrowserTabs } from '@shared/browser-types'
import { DEFAULT_CAPABILITIES, normalizeCapabilities, type CapabilityId } from '@shared/capabilities'
import { browserActions, useBrowserStore } from '@renderer/features/browser/browser-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'

/** Unsaved composer (new chat / draft): its switches move to the session file once it exists. */
export const DRAFT_CAPABILITY_KEY = '\u0000draft'
const MAX_REMEMBERED = 300

/**
 * A conversation nobody switched anything in starts with the built-in browser on; every other
 * capability stays opt-in. Turning the browser off stores an empty list, which is an explicit
 * "off" (an absent entry means "never touched" = this default), so the choice is remembered.
 */
export { DEFAULT_CAPABILITIES }

interface SessionCapabilitiesState {
  byKey: Record<string, CapabilityId[]>
  loaded: boolean
}

export const useSessionCapabilitiesStore = create<SessionCapabilitiesState>(() => ({ byKey: {}, loaded: false }))

export function capabilityKey(sessionFile: string | null | undefined): string {
  return (sessionFile && (normalizeSessionFileKey(sessionFile) || sessionFile)) || DRAFT_CAPABILITY_KEY
}

/** Capabilities in effect for a key: what the user stored, or the default when never touched. */
export function capabilitiesFor(byKey: Record<string, CapabilityId[]>, key: string): CapabilityId[] {
  const stored = byKey[key]
  return stored ? [...stored] : [...DEFAULT_CAPABILITIES]
}

let loading: Promise<void> | null = null
export function loadSessionCapabilities(): Promise<void> {
  if (!loading) {
    loading = ipcClient
      .invoke('settings.get', { key: 'sessionCapabilities' })
      .then((res: { settings?: { sessionCapabilities?: Record<string, unknown> } } | undefined) => {
        const raw = res?.settings?.sessionCapabilities ?? {}
        const byKey: Record<string, CapabilityId[]> = {}
        for (const [k, v] of Object.entries(raw)) {
          // An empty list is a remembered "off", so keep it.
          byKey[k] = normalizeCapabilities(v)
        }
        useSessionCapabilitiesStore.setState((s) => ({ byKey: { ...byKey, ...s.byKey }, loaded: true }))
      })
      .catch(() => useSessionCapabilitiesStore.setState({ loaded: true }))
  }
  return loading
}

/** Settings changed outside this window (a paired phone): take the stored map, keep the draft. */
export async function reloadSessionCapabilities(): Promise<void> {
  try {
    const res = (await ipcClient.invoke('settings.get', { key: 'sessionCapabilities' })) as
      | { settings?: { sessionCapabilities?: Record<string, unknown> } }
      | undefined
    const raw = res?.settings?.sessionCapabilities ?? {}
    const byKey: Record<string, CapabilityId[]> = {}
    for (const [k, v] of Object.entries(raw)) {
      byKey[k] = normalizeCapabilities(v)
    }
    const draft = useSessionCapabilitiesStore.getState().byKey[DRAFT_CAPABILITY_KEY]
    if (draft !== undefined) byKey[DRAFT_CAPABILITY_KEY] = draft
    useSessionCapabilitiesStore.setState({ byKey, loaded: true })
  } catch {
    /* keep the current map */
  }
}

function persist(byKey: Record<string, CapabilityId[]>): void {
  // Only saved sessions are remembered across restarts; drafts live in memory. Empty lists are
  // kept on purpose: they mean "the user turned everything off here".
  const entries = Object.entries(byKey).filter(([k]) => k !== DRAFT_CAPABILITY_KEY)
  const value = Object.fromEntries(entries.slice(-MAX_REMEMBERED))
  void ipcClient.invoke('settings.set', { key: 'sessionCapabilities', value }).catch(() => {})
}

/** Pure: new map with `id` switched on/off for `key` (a resulting empty list is a remembered off). */
export function toggleCapabilityIn(
  byKey: Record<string, CapabilityId[]>,
  key: string,
  id: CapabilityId,
  on: boolean,
): Record<string, CapabilityId[]> {
  const current = byKey[key] ?? [...DEFAULT_CAPABILITIES]
  const next = on ? (current.includes(id) ? current : [...current, id]) : current.filter((c) => c !== id)
  return { ...byKey, [key]: next }
}

/** Pure: carry a draft's switches over to the session file it just became (if that has none). */
export function adoptDraftCapabilities(byKey: Record<string, CapabilityId[]>, sessionKey: string): Record<string, CapabilityId[]> | null {
  const draft = byKey[DRAFT_CAPABILITY_KEY]
  if (draft === undefined || sessionKey === DRAFT_CAPABILITY_KEY || byKey[sessionKey] !== undefined) return null
  const out = { ...byKey, [sessionKey]: draft }
  delete out[DRAFT_CAPABILITY_KEY]
  return out
}

export function setSessionCapability(sessionFile: string | null | undefined, id: CapabilityId, on: boolean): void {
  const key = capabilityKey(sessionFile)
  const byKey = toggleCapabilityIn(useSessionCapabilitiesStore.getState().byKey, key, id, on)
  useSessionCapabilitiesStore.setState({ byKey })
  persist(byKey)
  // Switching off must take effect now, not on the next message: the live worker drops the tools
  // of a capability the moment its switch goes off (a draft has no worker yet — its switches ride
  // along with the first prompt).
  if (sessionFile) {
    const caps = withAutoBrowserCapability(capabilitiesFor(byKey, key), key)
    void ipcClient.invoke('capabilities.apply', { sessionFile, capabilities: caps }).catch(() => {})
  }
}

/** Auto-mount built-in browser tools when the project already has browser tabs open. */
export function withAutoBrowserCapability(base: readonly CapabilityId[], sessionKey: string): CapabilityId[] {
  if (base.includes('browser') || base.includes('chrome')) return [...base]
  // A stored list (even an empty one) is the user's own choice; only an untouched session follows tabs.
  if (useSessionCapabilitiesStore.getState().byKey[sessionKey] !== undefined) return [...base]
  const tabs = Object.values(useBrowserStore.getState().tabs)
  const projectKey = projectBrowserSessionKey(useUIStore.getState().currentWorkspace)
  if (tabs.length > 0 && projectKey && sessionHasBrowserTabs(tabs, projectKey)) {
    return [...base, 'browser']
  }
  return [...base]
}

let lastDraftSendAt = 0
/** A draft that sent within this window and then got a session file is that session. */
const DRAFT_ADOPT_WINDOW_MS = 15_000

/** Capabilities to send with the next message of the session currently in the composer. */
export function currentSessionCapabilities(): CapabilityId[] {
  const key = capabilityKey(useUIStore.getState().historySessionFile)
  if (key === DRAFT_CAPABILITY_KEY) {
    lastDraftSendAt = Date.now()
    return withAutoBrowserCapability(capabilitiesFor(useSessionCapabilitiesStore.getState().byKey, key), key)
  }
  // Sending a new chat creates its session file before the prompt goes out: the draft's switches
  // and any draft browser tabs belong to it.
  if (Date.now() - lastDraftSendAt < DRAFT_ADOPT_WINDOW_MS) {
    const draftTabs = Object.values(useBrowserStore.getState().tabs)
    if (sessionHasBrowserTabs(draftTabs, DRAFT_CAPABILITY_KEY)) {
      void browserActions.adoptSession(DRAFT_CAPABILITY_KEY, key).catch(() => {})
    }
  }
  const { byKey } = useSessionCapabilitiesStore.getState()
  const adopted = adoptDraftCapabilities(byKey, key)
  if (adopted) {
    useSessionCapabilitiesStore.setState({ byKey: adopted })
    persist(adopted)
    return withAutoBrowserCapability(capabilitiesFor(adopted, key), key)
  }
  return withAutoBrowserCapability(capabilitiesFor(byKey, key), key)
}

/**
 * Composer switched from `prevKey` to `nextKey`. A fresh draft has its own switches (none stored
 * yet = the default); a draft that was just sent keeps its switches under the session file it became;
 * otherwise draft switches are dropped (switching to an unrelated session must not inherit them).
 */
export function onCapabilityKeyChange(prevKey: string, nextKey: string, now = Date.now()): void {
  if (prevKey === nextKey) return
  if (prevKey === DRAFT_CAPABILITY_KEY && now - lastDraftSendAt < DRAFT_ADOPT_WINDOW_MS) {
    const draftTabs = Object.values(useBrowserStore.getState().tabs)
    if (sessionHasBrowserTabs(draftTabs, DRAFT_CAPABILITY_KEY)) {
      void browserActions.adoptSession(DRAFT_CAPABILITY_KEY, nextKey).catch(() => {})
    }
  }
  const { byKey } = useSessionCapabilitiesStore.getState()
  if (!byKey[DRAFT_CAPABILITY_KEY]) return
  if (prevKey === DRAFT_CAPABILITY_KEY && now - lastDraftSendAt < DRAFT_ADOPT_WINDOW_MS) {
    const adopted = adoptDraftCapabilities(byKey, nextKey)
    if (adopted) {
      useSessionCapabilitiesStore.setState({ byKey: adopted })
      persist(adopted)
      return
    }
  }
  const out = { ...byKey }
  delete out[DRAFT_CAPABILITY_KEY]
  useSessionCapabilitiesStore.setState({ byKey: out })
}
