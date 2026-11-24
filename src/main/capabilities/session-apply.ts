// Which capabilities a conversation runs with, and how they reach its worker.
//
// Two callers share this: every prompt (composer and remote send their switches along) and the
// composer's Tools menu, which pushes the new set the moment a switch is clicked so that turning
// something off takes effect immediately instead of on the next message.

import { projectBrowserSessionKey } from '@shared/browser-types'
import { DEFAULT_CAPABILITIES, normalizeCapabilities, type CapabilityId } from '@shared/capabilities'
import { normalizeSessionFileKey } from '@shared/session-file-key'
import { configStore } from '../config-store'
import { workerManager } from '../worker-manager'
import { peekBrowserHost } from '../browser/browser-host'
import { noteBrowserTarget } from '../browser/targets'
import { readSessionMetaFromFile } from '../session-file-meta'
import { capabilitySectionMap, capabilityToolFamilies } from './catalog'

/** Same defaults as the composer. */
export { DEFAULT_CAPABILITIES }

/** Stored switches for a session (an empty list is a remembered "all off"), or null if never touched. */
function storedEntry(sessionFile?: string | null): CapabilityId[] | null {
  const key = normalizeSessionFileKey(sessionFile)
  if (!key) return null
  const stored = configStore.get('sessionCapabilities') ?? {}
  const entry = stored[key]
  return entry ? normalizeCapabilities(entry) : null
}

/** Capabilities for a session when the caller did not say: the stored switches or the default. */
export function storedCapabilities(sessionFile?: string | null): CapabilityId[] {
  return storedEntry(sessionFile) ?? [...DEFAULT_CAPABILITIES]
}

/** Browser tabs are owned per project, so resolve this session's workspace key for auto-mount. */
async function sessionBrowserKey(sessionFile?: string): Promise<string | null> {
  if (!sessionFile) return null
  const st = await workerManager.getState(sessionFile).catch(() => null)
  const cwd = String((st as { currentCwd?: string } | null)?.currentCwd || '')
  const key = projectBrowserSessionKey(cwd)
  if (key) return key
  const meta = await readSessionMetaFromFile(sessionFile).catch(() => null)
  return projectBrowserSessionKey(meta?.cwd) || null
}

/**
 * The switches a turn actually runs with. `requested` (composer / phone) wins and is trusted as
 * given — it already resolved the user's "off" choices. Without it the stored list is used, and a
 * session that was never touched picks up the built-in browser when its project already has tabs.
 */
export async function resolveSessionCapabilities(
  sessionFile: string | undefined,
  requested?: readonly string[] | null,
): Promise<CapabilityId[]> {
  if (requested) return normalizeCapabilities(requested)
  const stored = storedEntry(sessionFile)
  const caps = stored ?? [...DEFAULT_CAPABILITIES]
  if (stored !== null) return caps // the user's own choice, an empty list included
  if (!configStore.get('rightPanelPrefs')?.browser) return caps
  const browserKey = await sessionBrowserKey(sessionFile)
  const host = peekBrowserHost()
  const hasTabs = browserKey ? host?.hasSessionTabs(browserKey) : host?.hasSessionTabs(sessionFile)
  return hasTabs && !caps.includes('browser') ? [...caps, 'browser'] : caps
}

export interface ApplyCapabilitiesResult {
  /** False when `liveOnly` was asked for and this session has no live worker. */
  applied: boolean
  capabilities: CapabilityId[]
}

/**
 * Push the session's switches into its worker. `liveOnly` never spawns or loads a worker (used by
 * the Tools menu: flipping a switch must not start a process).
 */
export async function applySessionCapabilities(
  sessionFile: string | undefined,
  requested?: readonly string[] | null,
  opts?: { liveOnly?: boolean },
): Promise<ApplyCapabilitiesResult> {
  const capabilities = await resolveSessionCapabilities(sessionFile, requested)
  noteBrowserTarget(sessionFile, capabilities)
  const sections = capabilitySectionMap(capabilities)
  const tools = capabilityToolFamilies(capabilities)
  if (opts?.liveOnly) {
    const applied = await workerManager.setCapabilitiesLive(sections, tools, sessionFile)
    return { applied, capabilities }
  }
  await workerManager.setCapabilities(sections, tools, sessionFile)
  return { applied: true, capabilities }
}
