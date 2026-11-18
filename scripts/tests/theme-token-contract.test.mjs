import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const css = readFileSync(join(root, 'src/renderer/src/styles/globals.css'), 'utf8').replace(/\r\n/g, '\n')
const { auditThemeCss } = await import(pathToFileURL(join(root, 'packages/shared/theme-tokens.ts')).href)

/**
 * 主题 token 契约门禁（T8 第一阶段）。
 *
 * 事实源：`packages/shared/theme-tokens.ts` 的 THEME_TOKEN_CONTRACT / DARK_ONLY_ALLOWED。
 * 目的：配色散落在 globals.css 的 `:root` 与 `.dark` 里，靠人肉保持一致；
 * 这条门禁要求「契约里的 token 深浅都要有」，且「只有深色的 token 必须登记原因」。
 */
describe('theme token contract (globals.css)', () => {
  it('light and dark define every contracted token', () => {
    const audit = auditThemeCss(css)
    const messages = audit.violations.map((v) => `${v.kind} ${v.token} — ${v.detail}`)
    assert.deepEqual(messages, [], `主题 token 契约被破坏：\n  ${messages.join('\n  ')}`)
  })

  it('parsed both mode blocks with a plausible token count', () => {
    const audit = auditThemeCss(css)
    assert.ok(audit.light.length >= 80, `:root token 数异常：${audit.light.length}`)
    assert.ok(audit.dark.length >= 70, `.dark token 数异常：${audit.dark.length}`)
    assert.ok(audit.light.length > audit.dark.length, '几何/字体类 token 只应存在于 :root')
  })

  it('every dark override also has a light value (no silent inheritance)', () => {
    const audit = auditThemeCss(css)
    const darkOnly = audit.dark.filter((token) => !audit.light.includes(token))
    // 允许清单是唯一例外，且必须写在契约里
    assert.deepEqual(
      darkOnly.filter((token) => !token.startsWith('--scrollbar-thumb')),
      [],
      `这些 token 只在 .dark 定义，浅色会继承不到值：${darkOnly.join(', ')}`,
    )
  })
})
