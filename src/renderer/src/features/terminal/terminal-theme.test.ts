import { describe, expect, it } from 'vitest'
import { terminalTheme } from './terminal-theme'

describe('terminal appearance', () => {
  it('keeps a dark background and colored ANSI output in both app themes', () => {
    document.documentElement.classList.remove('dark')
    const lightApp = terminalTheme()
    document.documentElement.classList.add('dark')
    const darkApp = terminalTheme()
    document.documentElement.classList.remove('dark')
    expect(lightApp.background).toBe('#161616')
    expect(darkApp.background).toBe(lightApp.background)
    expect(lightApp.red).not.toBe(lightApp.green)
    expect(lightApp.blue).not.toBe(lightApp.foreground)
  })
})
