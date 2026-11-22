import type { ThemeVariant, ThemeVariantKey } from '@shared/custom-theme'

export type ThemePreset = {
  id: string
  /** i18n key under settings:appearance.presets */
  labelKey: string
  light?: ThemeVariant
  dark?: ThemeVariant
}

const base = { fontUi: null, fontCode: null } as const

/**
 * Built-in themes. `default` has no variants: it means "no custom theme" (globals.css as shipped).
 * Each preset's `preset` id is kept on the saved variant until a field is edited.
 */
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'default', labelKey: 'default' },
  {
    id: 'claude',
    labelKey: 'claude',
    // Warm ivory paper, terracotta accent, serif headings and prose; soft borders, rounder corners.
    light: {
      ...base,
      preset: 'claude',
      accent: '#c96442',
      surface: '#faf9f5',
      ink: '#141413',
      contrast: 40,
      translucentSidebar: false,
      diffAdded: '#2f7d4f',
      diffRemoved: '#b5452e',
      colors: { sidebar: '#f3f1ea', userBubble: '#f0eee6', codeBg: '#f5f4ee', border: '#e3e0d5' },
      fontDisplay: 'serif',
      proseFont: 'display',
      chatFontSize: 16,
      chatLineHeight: 1.7,
      radius: 10,
      shadow: 30,
    },
    dark: {
      ...base,
      preset: 'claude',
      accent: '#d97757',
      surface: '#262624',
      ink: '#f5f4ef',
      contrast: 55,
      translucentSidebar: false,
      diffAdded: '#6fbf8a',
      diffRemoved: '#e0806a',
      colors: { sidebar: '#1f1e1d', userBubble: '#30302e', codeBg: '#1f1e1d', border: '#3b3a36' },
      fontDisplay: 'serif',
      proseFont: 'display',
      chatFontSize: 16,
      chatLineHeight: 1.7,
      radius: 10,
      shadow: 40,
    },
  },
  {
    id: 'vscode-plus',
    labelKey: 'vscodePlus',
    light: {
      ...base,
      preset: 'vscode-plus',
      accent: '#007acc',
      surface: '#ffffff',
      ink: '#000000',
      contrast: 45,
      translucentSidebar: true,
      diffAdded: '#008000',
      diffRemoved: '#ee0000',
    },
  },
  {
    id: 'codex-dark',
    labelKey: 'codexDark',
    dark: {
      ...base,
      preset: 'codex-dark',
      accent: '#339cff',
      surface: '#181818',
      ink: '#ffffff',
      contrast: 60,
      translucentSidebar: false,
    },
  },
  {
    id: 'nord',
    labelKey: 'nord',
    light: {
      ...base,
      preset: 'nord',
      accent: '#5e81ac',
      surface: '#eceff4',
      ink: '#2e3440',
      contrast: 45,
      translucentSidebar: false,
      diffAdded: '#3b7a57',
      diffRemoved: '#bf616a',
      colors: { sidebar: '#e5e9f0', userBubble: '#d8dee9', codeBg: '#e5e9f0', border: '#d0d7e3' },
      radius: 8,
    },
    dark: {
      ...base,
      preset: 'nord',
      accent: '#88c0d0',
      surface: '#2e3440',
      ink: '#eceff4',
      contrast: 55,
      translucentSidebar: false,
      diffAdded: '#a3be8c',
      diffRemoved: '#bf616a',
      colors: { sidebar: '#272c36', userBubble: '#3b4252', codeBg: '#272c36', border: '#3b4252' },
      radius: 8,
    },
  },
  {
    id: 'catppuccin',
    labelKey: 'catppuccin',
    light: {
      ...base,
      preset: 'catppuccin',
      accent: '#7287fd',
      surface: '#eff1f5',
      ink: '#31344d',
      contrast: 45,
      translucentSidebar: false,
      diffAdded: '#40a02b',
      diffRemoved: '#d20f39',
      colors: { sidebar: '#e6e9ef', userBubble: '#dce0e8', codeBg: '#e6e9ef', border: '#ccd0da' },
      radius: 10,
    },
    dark: {
      ...base,
      preset: 'catppuccin',
      accent: '#cba6f7',
      surface: '#1e1e2e',
      ink: '#cdd6f4',
      contrast: 55,
      translucentSidebar: false,
      diffAdded: '#a6e3a1',
      diffRemoved: '#f38ba8',
      colors: { sidebar: '#181825', userBubble: '#313244', codeBg: '#181825', border: '#313244' },
      radius: 10,
    },
  },
  {
    id: 'rose-pine',
    labelKey: 'rosePine',
    light: {
      ...base,
      preset: 'rose-pine',
      accent: '#907aa9',
      surface: '#faf4ed',
      ink: '#3a3556',
      contrast: 45,
      translucentSidebar: false,
      diffAdded: '#286983',
      diffRemoved: '#b4637a',
      colors: { sidebar: '#f2e9e1', userBubble: '#ebe1d7', codeBg: '#f2e9e1', border: '#dfdad9' },
      radius: 10,
    },
    dark: {
      ...base,
      preset: 'rose-pine',
      accent: '#ebbcba',
      surface: '#191724',
      ink: '#e0def4',
      contrast: 55,
      translucentSidebar: false,
      diffAdded: '#9ccfd8',
      diffRemoved: '#eb6f92',
      colors: { sidebar: '#1f1d2e', userBubble: '#26233a', codeBg: '#1f1d2e', border: '#312e47' },
      radius: 10,
    },
  },
  {
    id: 'github-clean',
    labelKey: 'githubClean',
    light: {
      ...base,
      preset: 'github-clean',
      accent: '#0969da',
      surface: '#ffffff',
      ink: '#1f2328',
      contrast: 45,
      translucentSidebar: false,
      diffAdded: '#1a7f37',
      diffRemoved: '#cf222e',
      colors: { sidebar: '#f6f8fa', userBubble: '#eef3f9', codeBg: '#f6f8fa', border: '#d0d7de' },
      radius: 6,
    },
    dark: {
      ...base,
      preset: 'github-clean',
      accent: '#58a6ff',
      surface: '#0d1117',
      ink: '#e6edf3',
      contrast: 60,
      translucentSidebar: false,
      diffAdded: '#3fb950',
      diffRemoved: '#f85149',
      colors: { sidebar: '#161b22', userBubble: '#1c2330', codeBg: '#161b22', border: '#30363d' },
      radius: 6,
    },
  },
]

export function presetVariant(id: string, variant: ThemeVariantKey): ThemeVariant | undefined {
  const v = THEME_PRESETS.find((p) => p.id === id)?.[variant]
  return v ? structuredClone(v) : undefined
}

export function presetsFor(variant: ThemeVariantKey): ThemePreset[] {
  return THEME_PRESETS.filter((p) => p.id === 'default' || p[variant])
}
