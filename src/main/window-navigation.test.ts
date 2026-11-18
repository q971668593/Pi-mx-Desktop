import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decideWindowNavigation, decideWindowOpen, isPathInside, isSafeExternalUrl } from './window-navigation'

const rendererRoot = resolve('C:/Program Files/Pi mx/resources/app.asar/out/renderer')
const appIndex = pathToFileURL(join(rendererRoot, 'index.html')).href
const devServer = 'http://localhost:5173'

describe('isSafeExternalUrl', () => {
  it.each([
    'https://pi.dev/docs',
    'http://example.com/a?b=1#c',
    'HTTPS://EXAMPLE.COM/',
  ])('accepts web urls: %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'smb://server/share',
    'https://user:pass@example.com/',
    'not a url',
  ])('rejects unsafe urls: %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false)
  })
})

describe('decideWindowOpen', () => {
  it('hands web links to the system browser', () => {
    expect(decideWindowOpen('https://example.com/issue/1')).toEqual({ openExternal: 'https://example.com/issue/1' })
  })

  it('drops executable and script urls', () => {
    expect(decideWindowOpen('file:///C:/Windows/System32/calc.exe')).toEqual({})
    expect(decideWindowOpen('javascript:alert(1)')).toEqual({})
  })
})

describe('isPathInside', () => {
  it('accepts the root and its children', () => {
    expect(isPathInside(rendererRoot, rendererRoot)).toBe(true)
    expect(isPathInside(rendererRoot, join(rendererRoot, 'assets/app.js'))).toBe(true)
  })

  it('rejects parent and sibling-prefix paths', () => {
    expect(isPathInside(rendererRoot, join(rendererRoot, '..'))).toBe(false)
    expect(isPathInside(rendererRoot, `${rendererRoot}-evil/index.html`)).toBe(false)
    expect(isPathInside(rendererRoot, 'C:/Windows/System32/calc.exe')).toBe(false)
  })
})

describe('decideWindowNavigation', () => {
  it('allows the initial document and reloads', () => {
    expect(decideWindowNavigation({ target: appIndex, current: appIndex, rendererRoot })).toEqual({ prevent: false })
  })

  it('allows bundled renderer files, including encoded paths', () => {
    const target = pathToFileURL(join(rendererRoot, 'assets', '中文 页面.html')).href
    expect(decideWindowNavigation({ target, current: appIndex, rendererRoot })).toEqual({ prevent: false })
  })

  it('blocks file urls outside the bundle without opening them', () => {
    expect(decideWindowNavigation({
      target: 'file:///C:/Windows/System32/calc.exe', current: appIndex, rendererRoot,
    })).toEqual({ prevent: true })
  })

  it('opens external web links in the browser instead of navigating', () => {
    expect(decideWindowNavigation({
      target: 'https://example.com/phish', current: appIndex, rendererRoot,
    })).toEqual({ prevent: true, openExternal: 'https://example.com/phish' })
  })

  it('allows the dev server origin for HMR navigation', () => {
    expect(decideWindowNavigation({
      target: `${devServer}/src/renderer/src/app/app.tsx`, current: `${devServer}/`, rendererRoot, devServerUrl: devServer,
    })).toEqual({ prevent: false })
  })

  it('blocks javascript, data and malformed targets', () => {
    expect(decideWindowNavigation({ target: 'javascript:alert(1)', current: appIndex, rendererRoot })).toEqual({ prevent: true })
    expect(decideWindowNavigation({ target: 'data:text/html,hi', current: appIndex, rendererRoot })).toEqual({ prevent: true })
    expect(decideWindowNavigation({ target: 'not a url', current: appIndex, rendererRoot })).toEqual({ prevent: true })
  })
})
