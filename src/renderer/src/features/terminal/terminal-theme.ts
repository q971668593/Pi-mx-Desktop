import type { ITheme } from '@xterm/xterm'

const DARK = {
  black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
}

export function terminalTheme(): ITheme {
  const bg = '#161616'
  const fg = '#e6e6e6'
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: 'rgba(77,170,252,0.32)',
    selectionInactiveBackground: 'rgba(255,255,255,0.12)',
    scrollbarSliderBackground: 'rgba(255,255,255,0.12)',
    scrollbarSliderHoverBackground: 'rgba(255,255,255,0.22)',
    scrollbarSliderActiveBackground: '#4daafc',
    ...DARK,
  }
}

export const TERMINAL_FONT = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
