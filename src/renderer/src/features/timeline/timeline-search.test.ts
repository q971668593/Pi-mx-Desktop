import { describe, expect, it } from 'vitest'
import type { TimelineRawItem } from './timeline-display-items'
import {
  computeVisibleTurnsForItemIndex,
  extractTimelineItemSearchText,
  findTimelineSearchMatchIds,
} from './timeline-search'

describe('timeline-search', () => {
  const items: TimelineRawItem[] = [
    { id: 'u1', type: 'user-message', text: 'Why does WebglAddon crash on sleep?' },
    {
      id: 't1',
      type: 'tool-call',
      toolName: 'bash',
      input: { command: 'rg WebglAddon src/' },
      output: 'terminal-pane.tsx:58: const gl = new WebglAddon()',
    },
    {
      id: 'a1',
      type: 'assistant-message',
      thinkingText: 'Checking GPU context loss handlers',
      text: 'You need an `onContextLoss` handler.',
    },
    { id: 'u2', type: 'user-message', text: 'Sounds good, apply the fix' },
  ]

  it('finds case-insensitive matches across user, assistant, thinking, and tool rows', () => {
    expect(findTimelineSearchMatchIds(items, 'webgladdon')).toEqual(['u1', 't1'])
    expect(findTimelineSearchMatchIds(items, 'oncontextloss')).toEqual(['a1'])
    expect(findTimelineSearchMatchIds(items, 'context loss')).toEqual(['a1'])
    expect(findTimelineSearchMatchIds(items, '   ')).toEqual([])
  })

  it('extracts segment attachment names when text is empty', () => {
    const segItem: TimelineRawItem = {
      id: 'u-seg',
      type: 'user-message',
      text: '',
      segments: [{ type: 'clipboard-image', name: 'error-screenshot.png' }],
    }
    expect(extractTimelineItemSearchText(segItem)).toContain('error-screenshot.png')
  })

  it('computes visible turn window covering earlier matched rows', () => {
    expect(computeVisibleTurnsForItemIndex(items, 0, 2)).toBe(3)
    expect(computeVisibleTurnsForItemIndex(items, 3, 2)).toBe(2)
  })
})
