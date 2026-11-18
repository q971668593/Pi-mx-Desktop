import { describe, expect, it } from 'vitest'
import { clearFileDraft, getFileDraft, putFileDraft } from './file-edit-guard'

describe('file edit guard', () => {
  it('keeps a draft only when the text really changed', () => {
    putFileDraft('/ws', 'a.md', 'one\ntwo', 'one\ntwo')
    expect(getFileDraft('/ws', 'a.md')).toBeUndefined()
    putFileDraft('/ws', 'a.md', 'one\ntwo', 'one\nthree')
    expect(getFileDraft('/ws', 'a.md')).toEqual({ original: 'one\ntwo', value: 'one\nthree' })
    clearFileDraft('/ws', 'a.md')
  })
  it('does not treat a CRLF -> LF conversion as a user edit', () => {
    putFileDraft('/ws', 'crlf.md', 'one\r\ntwo\r\n', 'one\ntwo\n')
    expect(getFileDraft('/ws', 'crlf.md')).toBeUndefined()
  })
  it('replaces a stale draft once the text returns to the original', () => {
    putFileDraft('/ws', 'b.md', 'one\r\n', 'two\n')
    expect(getFileDraft('/ws', 'b.md')).toBeDefined()
    putFileDraft('/ws', 'b.md', 'one\r\n', 'one\n')
    expect(getFileDraft('/ws', 'b.md')).toBeUndefined()
  })
})
