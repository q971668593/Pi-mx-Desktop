/**
 * 主题 token 契约（T8 第一阶段）
 *
 * 背景（借鉴 opencode `packages/ui/src/theme/*` + `desktop-theme.schema.json`）：
 * 我们的配色散落在 `styles/globals.css` 的 `:root` 与 `.dark` 两个块里，靠人肉保持一致。
 * 这份契约把「**必须有**」和「**允许只有深色**」写成数据，配合
 * `scripts/tests/theme-token-contract.test.mjs` 成为可执行门禁。
 *
 * 为什么不是直接搬 JSON 主题预设：预设需要 UI 侧（主题编辑器）配合才能落地，
 * 而编辑器正在改动中。这里先把**校验器**做好——将来导入 JSON 主题时复用同一套规则，
 * 不必再写一遍。
 *
 * 纪律：
 *  - 新增语义 token → 同时在 `:root` 与 `.dark` 定义，并登记到 `THEME_TOKEN_CONTRACT`
 *  - 只对深色有意义的 token（如滚动条）→ 登记到 `DARK_ONLY_ALLOWED` 并写清原因
 *  - 几何/字体/动效类 token（`--radius`、`--font-*`、`--motion-*`）天然只在 `:root`
 */

export interface ThemeTokenGroup {
  readonly group: string
  readonly description: string
  readonly tokens: readonly string[]
}

/** 必须在浅色与深色都定义的语义 token（按用途分组，便于评审）。 */
export const THEME_TOKEN_CONTRACT: readonly ThemeTokenGroup[] = [
  {
    group: 'surface',
    description: '后台层级：主底 / 抬升面 / 输入框 / 悬浮',
    tokens: ['--bg-base', '--bg-1', '--bg-2', '--bg-3', '--surface-sidebar'],
  },
  {
    group: 'text',
    description: '正文 / 次要文字 / 禁用文字',
    tokens: ['--text-primary', '--text-secondary', '--text-disabled'],
  },
  {
    group: 'border',
    description: '常规边框与更弱的分隔线',
    tokens: ['--border-base', '--border-light'],
  },
  {
    group: 'brand',
    description: '品牌色与焦点环（0.7.8 起为暖琥珀）',
    tokens: ['--brand', '--focus-border'],
  },
  {
    group: 'tailwind',
    description: 'Tailwind 派生的 HSL 语义 token（shadcn 约定）',
    tokens: [
      '--background',
      '--foreground',
      '--card',
      '--popover',
      '--primary',
      '--secondary',
      '--muted',
      '--accent',
      '--destructive',
      '--input',
      '--ring',
    ],
  },
  {
    group: 'composer',
    description: '输入框外壳描边（深浅模式都要能看清边界）',
    tokens: ['--composer-shell-border'],
  },
]

/** 允许只出现在 `.dark` 的 token（含原因）。除此之外的「仅深色」都视为漏定义。 */
export const DARK_ONLY_ALLOWED: Readonly<Record<string, string>> = {
  '--scrollbar-thumb': '浅色模式使用系统默认滚动条，只有深色需要自定义半透明滑块',
  '--scrollbar-thumb-hover': '浅色模式使用系统默认滚动条，只有深色需要悬停态滑块',
  '--scrollbar-thumb-active': '浅色模式使用系统默认滚动条，只有深色需要拖拽态滑块',
}

/** 只在 `:root` 定义的几何 / 字体 / 动效 token（与配色无关，不参与深浅一致性校验）。 */
export const MODE_INDEPENDENT_PREFIXES: readonly string[] = [
  '--radius',
  '--font-',
  '--prose-font',
  '--motion-',
  '--chat-',
  '--code-bg',
  '--composer-content-',
  '--composer-shell-radius',
  '--timeline-content-max',
  '--main-chat-surface-radius',
]

export interface ThemeTokenViolation {
  readonly kind: 'missing-in-light' | 'missing-in-dark' | 'dark-only'
  readonly token: string
  readonly detail: string
}

export interface ThemeTokenAudit {
  readonly light: readonly string[]
  readonly dark: readonly string[]
  readonly violations: readonly ThemeTokenViolation[]
}

/** 从一段 CSS 里取出所有 `--token:` 名称（保序去重）。 */
export function collectTokens(cssBody: string): string[] {
  const seen = new Set<string>()
  for (const match of cssBody.matchAll(/(--[a-z0-9-]+)\s*:/gi)) seen.add(match[1])
  return [...seen]
}

/** 取某个选择器（如 `:root` / `.dark`）的块体；找不到返回 null。 */
export function findBlock(css: string, selector: string): string | null {
  const pattern = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'g')
  const match = pattern.exec(css)
  if (!match) return null
  const start = match.index + match[0].length
  let depth = 1
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, index)
    }
  }
  return null
}

export function contractTokens(): string[] {
  return THEME_TOKEN_CONTRACT.flatMap((group) => [...group.tokens])
}

/**
 * 审计一份主题 CSS：浅/深是否成套、有没有未登记的「仅深色」token。
 * 纯函数，便于用 fixture 单测；真实 CSS 的校验在契约测试里调用。
 */
export function auditThemeCss(css: string): ThemeTokenAudit {
  const lightBody = findBlock(css, ':root')
  const darkBody = findBlock(css, '.dark')
  const light = lightBody ? collectTokens(lightBody) : []
  const dark = darkBody ? collectTokens(darkBody) : []
  const lightSet = new Set(light)
  const darkSet = new Set(dark)
  const violations: ThemeTokenViolation[] = []

  if (!lightBody) violations.push({ kind: 'missing-in-light', token: ':root', detail: '找不到 :root 块' })
  if (!darkBody) violations.push({ kind: 'missing-in-dark', token: '.dark', detail: '找不到 .dark 块' })

  for (const token of contractTokens()) {
    if (!lightSet.has(token)) {
      violations.push({ kind: 'missing-in-light', token, detail: '契约要求浅色也有定义' })
    }
    if (!darkSet.has(token)) {
      violations.push({ kind: 'missing-in-dark', token, detail: '契约要求深色也有定义' })
    }
  }

  for (const token of dark) {
    if (lightSet.has(token)) continue
    if (token in DARK_ONLY_ALLOWED) continue
    if (MODE_INDEPENDENT_PREFIXES.some((prefix) => token.startsWith(prefix))) continue
    violations.push({
      kind: 'dark-only',
      token,
      detail: '只定义了深色，浅色会继承不到值；要么补 :root，要么登记到 DARK_ONLY_ALLOWED',
    })
  }

  return { light, dark, violations }
}
