import { describe, expect, it } from 'vitest'
import { formatShortcut, matchShortcut, readShortcutBindings, type ShortcutBinding } from './shortcut-bindings'

function event(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'k',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  } as KeyboardEvent
}

describe('shortcut bindings', () => {
  const palette: ShortcutBinding = { key: 'k', ctrl: true, meta: true, shift: false, alt: false }

  it('matches ctrl or meta for palette', () => {
    expect(matchShortcut(event({ key: 'k', ctrlKey: true }), palette)).toBe(true)
    expect(matchShortcut(event({ key: 'k', metaKey: true }), palette)).toBe(true)
    expect(matchShortcut(event({ key: 'k' }), palette)).toBe(false)
  })

  it('formats with Ctrl on non-mac', () => {
    expect(formatShortcut(palette).toLowerCase()).toContain('k')
  })

  it('survives a broken binding instead of throwing in the global keydown handler', () => {
    expect(matchShortcut(event({ key: 'k' }), undefined)).toBe(false)
    expect(matchShortcut(event({ key: 'k' }), { key: undefined } as unknown as ShortcutBinding)).toBe(false)
    expect(formatShortcut(undefined)).toBe('')
  })

  it('repairs bindings stored by an older build', () => {
    localStorage.setItem('pi-desktop:shortcut-bindings', JSON.stringify({ shortcuts: { ctrl: true } }))
    const bindings = readShortcutBindings()
    expect(bindings.shortcuts.key).toBe('/')
    expect(bindings.shortcuts.ctrl).toBe(true)
    expect(bindings.commandPalette.key).toBe('k')
    localStorage.removeItem('pi-desktop:shortcut-bindings')
  })
})
