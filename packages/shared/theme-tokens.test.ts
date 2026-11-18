import { describe, expect, it } from 'vitest'
import {
  DARK_ONLY_ALLOWED,
  THEME_TOKEN_CONTRACT,
  auditThemeCss,
  collectTokens,
  contractTokens,
  findBlock,
} from './theme-tokens'

const OK_CSS = `
:root {
  --bg-base: #ffffff;
  --bg-1: #fafafa;
  --bg-2: #f5f5f5;
  --bg-3: #eeeeee;
  --surface-sidebar: #f7f7f7;
  --text-primary: #111111;
  --text-secondary: #666666;
  --text-disabled: #999999;
  --border-base: #dddddd;
  --border-light: #ececec;
  --brand: #f59e0b;
  --focus-border: #f59e0b;
  --background: 0 0% 100%;
  --foreground: 0 0% 7%;
  --card: 0 0% 100%;
  --popover: 0 0% 100%;
  --primary: 0 0% 9%;
  --secondary: 0 0% 96%;
  --muted: 0 0% 96%;
  --accent: 0 0% 96%;
  --destructive: 0 84% 60%;
  --input: 0 0% 90%;
  --ring: 38 92% 50%;
  --composer-shell-border: #d4d4d4;
  --radius: 8px;
}

.dark {
  --bg-base: #1a1920;
  --bg-1: #212028;
  --bg-2: #282730;
  --bg-3: #302e38;
  --surface-sidebar: #141319;
  --text-primary: #e8e4dc;
  --text-secondary: #9c98a6;
  --text-disabled: #6e7681;
  --border-base: #2d2b36;
  --border-light: #24222c;
  --brand: #f59e0b;
  --focus-border: #f59e0b;
  --background: 250 12% 11%;
  --foreground: 40 20% 89%;
  --card: 250 11% 14%;
  --popover: 250 12% 12%;
  --primary: 40 20% 89%;
  --secondary: 250 10% 17%;
  --muted: 250 10% 15%;
  --accent: 250 10% 18%;
  --destructive: 3 78% 63%;
  --input: 250 10% 20%;
  --ring: 38 92% 50%;
  --composer-shell-border: #3a3a3a;
  --scrollbar-thumb: rgba(121, 121, 121, 0.4);
}
`

describe('theme token contract', () => {
  it('registry has no duplicate token names and every name is kebab-cased', () => {
    const tokens = contractTokens()
    expect(new Set(tokens).size).toBe(tokens.length)
    for (const token of tokens) {
      expect(token).toMatch(/^--[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('every group documents itself', () => {
    for (const group of THEME_TOKEN_CONTRACT) {
      expect(group.group.length).toBeGreaterThan(2)
      expect(group.description.length).toBeGreaterThan(6)
      expect(group.tokens.length).toBeGreaterThan(0)
    }
  })

  it('dark-only allowlist entries explain why', () => {
    for (const [token, reason] of Object.entries(DARK_ONLY_ALLOWED)) {
      expect(token.startsWith('--')).toBe(true)
      expect(reason.length).toBeGreaterThan(6)
    }
  })

  it('accepts a css file where light and dark both define the contract', () => {
    const audit = auditThemeCss(OK_CSS)
    expect(audit.violations).toEqual([])
    expect(audit.light).toContain('--radius')
    expect(audit.dark).toContain('--scrollbar-thumb')
  })

  it('reports tokens missing from dark', () => {
    const broken = OK_CSS.replace('  --composer-shell-border: #3a3a3a;\n', '')
    const audit = auditThemeCss(broken)
    expect(audit.violations).toContainEqual(
      expect.objectContaining({ kind: 'missing-in-dark', token: '--composer-shell-border' }),
    )
  })

  it('reports tokens missing from light', () => {
    const broken = OK_CSS.replace('  --brand: #f59e0b;\n', '')
    const audit = auditThemeCss(broken)
    const kinds = audit.violations.map((v) => `${v.kind}:${v.token}`)
    expect(kinds).toContain('missing-in-light:--brand')
  })

  it('flags unregistered dark-only tokens but tolerates allowlisted + mode-independent ones', () => {
    const withDarkOnly = OK_CSS.replace('  --scrollbar-thumb:', '  --brand-hover: #fbbf24;\n  --scrollbar-thumb:')
    const audit = auditThemeCss(withDarkOnly)
    expect(audit.violations).toContainEqual(
      expect.objectContaining({ kind: 'dark-only', token: '--brand-hover' }),
    )
    // 允许清单内的 token 不应产生违规
    expect(audit.violations.some((v) => v.token === '--scrollbar-thumb')).toBe(false)
  })

  it('reports a missing block instead of throwing', () => {
    const audit = auditThemeCss(':root { --brand: #000; }')
    expect(audit.violations).toContainEqual(expect.objectContaining({ kind: 'missing-in-dark', token: '.dark' }))
  })

  it('parsers return deterministic, de-duplicated token lists', () => {
    expect(collectTokens('--a: 1; --b: 2; --a: 3;')).toEqual(['--a', '--b'])
    expect(findBlock('/* x */\n.dark {\n  --a: 1;\n}\n', '.dark')).toBe('\n  --a: 1;\n')
    expect(findBlock('.dark { --a: 1 }', ':root')).toBeNull()
  })
})
