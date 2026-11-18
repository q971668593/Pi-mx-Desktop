import { describe, expect, it } from 'vitest'
import { normalizeEol, withEolOf } from './file-text-eol'

describe('file text line endings', () => {
  it('normalizes CRLF and lone CR to LF', () => {
    expect(normalizeEol('a\r\nb\r\n')).toBe('a\nb\n')
    expect(normalizeEol('a\rb')).toBe('a\nb')
    expect(normalizeEol('a\nb')).toBe('a\nb')
  })
  it('keeps the LF fast path untouched', () => {
    const text = 'no carriage returns here'
    expect(normalizeEol(text)).toBe(text)
  })
  it('restores CRLF when the source used it', () => {
    expect(withEolOf('a\r\nb', 'a\nb\nc')).toBe('a\r\nb\r\nc')
  })
  it('never mixes separators into a text that already carries a CR', () => {
    expect(withEolOf('a\r\nb', 'a\nb\rc')).toBe('a\nb\rc')
  })
  it('leaves LF sources alone', () => {
    expect(withEolOf('a\nb', 'a\nb\nc')).toBe('a\nb\nc')
  })
})
