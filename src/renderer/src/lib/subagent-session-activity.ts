import { resolveToolCardTemplate } from '@renderer/features/timeline/tool-card-registry'
import {
  normalizeTreeToolItem,
  type TreeToolItem,
} from '@renderer/features/timeline/tree-tool-model'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import type {
  SubagentSessionChild,
  SubagentSessionGroup,
} from '@renderer/lib/subagent-session-types'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import type { ToolEvent } from '@shared/app-events'

function isActiveChild(child: SubagentSessionChild): boolean {
  return child.state === 'pending' || child.state === 'running'
}

function childIdentity(child: SubagentSessionChild): string {
  return child.sessionFile
    ? normalizeSessionFileKey(child.sessionFile) || child.sessionFile
    : child.key
}

function activeChildrenFromTreeItem(item: TreeToolItem): SubagentSessionChild[] {
  if (item.toolPhase !== 'start' && item.toolPhase !== 'update') return []
  return normalizeTreeToolItem(item).children
    .filter(isActiveChild)
    .map((child) => ({
      key: child.key,
      agent: child.agent,
      task: child.task,
      state: child.state,
      sessionFile: child.sessionFile,
    }))
}

export function collectActiveSubagentSessionChildren(items: TimelineItem[]): SubagentSessionChild[] {
  const children: SubagentSessionChild[] = []
  const seenIdentities = new Set<string>()

  for (const item of items) {
    if (item.type !== 'tool-call' || resolveToolCardTemplate(item.toolName) !== 'tree') continue
    for (const child of activeChildrenFromTreeItem(item)) {
      const identity = childIdentity(child)
      if (seenIdentities.has(identity)) continue
      seenIdentities.add(identity)
      children.push(child)
    }
  }

  return children
}

const EMPTY_CHILDREN: SubagentSessionChild[] = []
const MAX_SIGNATURE_CACHE = 32
const memoByItems = new WeakMap<TimelineItem[], Map<number, SubagentSessionChild[]>>()
const memoBySignature = new Map<string, SubagentSessionChild[]>()

/**
 * Store selector for the sidebar: the same array instance comes back until the active children
 * actually change, so a streaming token (new `timelineItems` every frame) does not re-render
 * every project's session tree. `version` busts the memo when tool-card templates load.
 */
export function selectActiveSubagentSessionChildren(
  items: TimelineItem[],
  version = 0,
): SubagentSessionChild[] {
  if (items.length === 0) return EMPTY_CHILDREN
  let byVersion = memoByItems.get(items)
  const cached = byVersion?.get(version)
  if (cached) return cached

  const setCached = (value: SubagentSessionChild[]) => {
    if (!byVersion) {
      byVersion = new Map()
      memoByItems.set(items, byVersion)
    }
    byVersion.set(version, value)
  }

  const next = collectActiveSubagentSessionChildren(items)
  if (next.length === 0) {
    setCached(EMPTY_CHILDREN)
    return EMPTY_CHILDREN
  }

  const signature = `${version}\u0003${next
    .map((child) => `${child.key}\u0001${child.state}\u0001${child.sessionFile ?? ''}\u0001${child.agent}\u0001${child.task ?? ''}`)
    .join('\u0002')}`
  const existing = memoBySignature.get(signature)
  if (existing) {
    memoBySignature.delete(signature)
    memoBySignature.set(signature, existing)
    setCached(existing)
    return existing
  }

  memoBySignature.set(signature, next)
  if (memoBySignature.size > MAX_SIGNATURE_CACHE) {
    const oldest = memoBySignature.keys().next().value
    if (oldest !== undefined) memoBySignature.delete(oldest)
  }
  setCached(next)
  return next
}

export function reduceSubagentSessionGroupToolEvent(
  group: SubagentSessionGroup,
  event: ToolEvent,
): SubagentSessionGroup {
  if (!event.sessionFile || !sessionFilesEqual(event.sessionFile, group.parentSessionFile)) {
    return group
  }

  const childKeyPrefix = `${event.toolCallId}:`
  const belongsToKnownTreeRun = group.children.some((child) => child.key.startsWith(childKeyPrefix))
  if (resolveToolCardTemplate(event.toolName) !== 'tree' && !belongsToKnownTreeRun) return group
  if (event.phase === 'update' && event.details === undefined && belongsToKnownTreeRun) {
    return group
  }
  const activeChildren = activeChildrenFromTreeItem({
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    toolPhase: event.phase,
    toolArgs: event.input,
    toolDetails: event.details,
    toolOutput: typeof event.output === 'string' ? event.output : undefined,
    isError: event.isError,
  })
  if (
    event.phase !== 'end'
    && event.details === undefined
    && activeChildren.length === 0
  ) {
    return group
  }

  const otherChildren = group.children.filter((child) => !child.key.startsWith(childKeyPrefix))

  return {
    ...group,
    children: [...otherChildren, ...activeChildren],
  }
}
