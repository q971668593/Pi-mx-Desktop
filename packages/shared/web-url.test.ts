import { describe, expect, it } from 'vitest'
import { isWebUrl } from './web-url'

describe('isWebUrl', () => {
  it.each([
    'https://pi.dev/docs',
    'http://example.com/a?b=1#c',
    'HTTPS://EXAMPLE.COM/',
  ])('accepts web urls: %s', (url) => {
    expect(isWebUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'smb://server/share',
    'https://user:pass@example.com/',
    'not a url',
    '',
  ])('rejects unsafe urls: %s', (url) => {
    expect(isWebUrl(url)).toBe(false)
  })
})
