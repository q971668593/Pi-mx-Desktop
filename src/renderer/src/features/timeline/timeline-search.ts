import type { TimelineRawItem } from './timeline-display-items'

function stringifyCompact(value: unknown, limit = 12_000): string {
  if (typeof value === 'string') return value.slice(0, limit)
  if (value == null) return ''
  try {
    return JSON.stringify(value).slice(0, limit)
  } catch {
    return ''
  }
}

/** Extracts searchable plaintext for in-session timeline search (`Ctrl/Cmd+F`). */
export function extractTimelineItemSearchText(item: TimelineRawItem): string {
  const parts: string[] = []
  if (item.type === 'user-message') {
    if (typeof item.text === 'string' && item.text) parts.push(item.text)
    if (Array.isArray(item.segments)) {
      for (const seg of item.segments) {
        if (!seg || typeof seg !== 'object') continue
        const s = seg as { type?: string; text?: string; name?: string; attachment?: { name?: string; path?: string } }
        if (s.type === 'text' && s.text) parts.push(s.text)
        else if (s.type === 'clipboard-image' && s.name) parts.push(s.name)
        else if (s.attachment?.name || s.attachment?.path) {
          if (s.attachment.name) parts.push(s.attachment.name)
          if (s.attachment.path) parts.push(s.attachment.path)
        }
      }
    }
    return parts.join('\n')
  }

  if (item.type === 'assistant-message') {
    if (typeof item.text === 'string' && item.text) parts.push(item.text)
    if (typeof item.thinkingText === 'string' && item.thinkingText) parts.push(item.thinkingText)
    if (typeof item.errorMessage === 'string' && item.errorMessage) parts.push(item.errorMessage)
    return parts.join('\n')
  }

  if (item.type === 'tool-call') {
    if (typeof item.toolName === 'string' && item.toolName) parts.push(item.toolName)
    if (typeof item.title === 'string' && item.title) parts.push(item.title)
    const args = stringifyCompact(item.input ?? item.args)
    if (args) parts.push(args)
    const out = stringifyCompact(item.output ?? item.result)
    if (out) parts.push(out)
    return parts.join('\n')
  }

  if (item.type === 'slash') {
    if (typeof item.command === 'string' && item.command) parts.push(item.command)
    if (typeof item.text === 'string' && item.text) parts.push(item.text)
    return parts.join('\n')
  }

  for (const key of ['text', 'summary', 'title', 'errorMessage'] as const) {
    const val = item[key]
    if (typeof val === 'string' && val) parts.push(val)
  }
  return parts.join('\n')
}

/** Returns ordered item IDs whose extracted text matches `query` case-insensitively. */
export function findTimelineSearchMatchIds(items: TimelineRawItem[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: string[] = []
  for (const item of items) {
    if (!item?.id) continue
    const hay = extractTimelineItemSearchText(item)
    if (hay && hay.toLowerCase().includes(needle)) {
      matches.push(String(item.id))
    }
  }
  return matches
}

/** Returns the minimum visible turn window needed so `itemIndex` is rendered. */
export function computeVisibleTurnsForItemIndex(
  items: TimelineRawItem[],
  itemIndex: number,
  minTurns: number,
): number {
  if (itemIndex < 0 || itemIndex >= items.length) return minTurns
  let turnsFromTail = 0
  for (let i = itemIndex; i < items.length; i++) {
    if (items[i]?.type === 'user-message') turnsFromTail += 1
  }
  return Math.max(minTurns, turnsFromTail + 1)
}
