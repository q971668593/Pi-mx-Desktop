import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { formatTimelineAsMarkdown } from './session-markdown-export'

describe('session-markdown-export', () => {
  const items: TimelineItem[] = [
    { id: 'u1', type: 'user-message', text: 'How do I fix this leak?', timestamp: 1 },
    { id: 't1', type: 'tool-call', toolName: 'read_file', text: '', timestamp: 2 },
    { id: 'a1', type: 'assistant-message', thinkingText: 'internal reasoning', text: 'Call `dispose()` on unmount.', timestamp: 3 },
  ]

  it('formats user and assistant prose cleanly without leaking thinking text', () => {
    const md = formatTimelineAsMarkdown(items, { title: 'Fix WebGL leak' })
    expect(md).toContain('# Fix WebGL leak')
    expect(md).toContain('## User\n\nHow do I fix this leak?')
    expect(md).toContain('## Assistant\n\nCall `dispose()` on unmount.')
    expect(md).not.toContain('internal reasoning')
    expect(md).not.toContain('read_file')
  })

  it('optionally appends tool summaries when includeTools is true', () => {
    const md = formatTimelineAsMarkdown(items, { includeTools: true })
    expect(md).toContain('> Tool: `read_file`')
  })
})
