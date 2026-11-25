import { describe, expect, it } from 'vitest'
import { containsLeakedToolCall, sanitizeLeakedToolCallText } from './leaked-tool-call'

describe('leaked-tool-call', () => {
  it('passes through normal prose', () => {
    expect(containsLeakedToolCall('开干，先修 4 个小 bug')).toBe(false)
    expect(sanitizeLeakedToolCallText('hello').leaked).toBe(false)
  })

  it('detects full leaked block', () => {
    const raw =
      '<atem:function_calls>\n<atem:invoke name="default.bash">\n<atem:parameter name="command">grep -rn x</atem:parameter>\n</atem:invoke>\n</atem:function_calls>'
    expect(containsLeakedToolCall(raw)).toBe(true)
    const out = sanitizeLeakedToolCallText(raw)
    expect(out.leaked).toBe(true)
    expect(out.text).not.toContain('<atem:')
    expect(out.text).toContain('未执行')
    expect(out.text).toContain('default.bash')
  })

  it('keeps head prose, hides tail leak', () => {
    const raw = '开干，先从4个小bug下手。\n<atem:function_calls>\n<atem:invoke name="default.bash">'
    const out = sanitizeLeakedToolCallText(raw)
    expect(out.leaked).toBe(true)
    expect(out.text).toContain('开干')
    expect(out.text).not.toContain('<atem:')
  })

  it('handles unterminated stream chunk', () => {
    expect(containsLeakedToolCall('<atem:invoke name="default.bash">')).toBe(true)
  })
})
