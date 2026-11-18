import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const css = readFileSync(join(root, 'src/renderer/src/styles/globals.css'), 'utf8').replace(/\r\n/g, '\n')

function darkBlock(source) {
  const start = source.indexOf('.dark {')
  assert.ok(start >= 0, 'globals.css must define .dark tokens')
  const end = source.indexOf('\n  }\n', start)
  assert.ok(end > start, 'could not slice .dark block')
  return source.slice(start, end)
}

/** 读 `--name: <h> <s>% <l>%` 形式的 HSL token，返回数值（不含单位）。 */
function hslToken(block, name) {
  const match = block.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%`))
  assert.ok(match, `missing HSL token --${name}`)
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) }
}

function hexToken(block, name) {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  assert.ok(match, `missing hex token --${name}`)
  return match[1].toLowerCase()
}

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/**
 * 深色主题视觉契约（0.7.8 品牌改版后：暖白 + 琥珀色）。
 *
 * 这里断言的是**设计意图**，不是某一次调色的快照：
 *  - 深色底要足够深、层次靠细微 elevation 而不是亮边
 *  - 品牌色是琥珀（hue 30–45）
 *  - Tailwind 派生 token 与底/字同源（深底、亮字、低彩度）
 * 调色微调不应让测试变红；把主题改回冷灰或纯黑白时才应该红。
 */
describe('dark theme visual contract (warm amber)', () => {
  it('should_keep_dark_surfaces_dark_and_text_light', () => {
    const dark = darkBlock(css)
    const base = hexToken(dark, 'bg-base')
    const sidebar = hexToken(dark, 'surface-sidebar')
    const text = hexToken(dark, 'text-primary')

    assert.ok(luminance(base) < 0.03, `--bg-base 应该足够深（${base}）`)
    assert.ok(luminance(sidebar) < luminance(base), '--surface-sidebar 应比主底面更深')
    assert.ok(luminance(text) > 0.6, `--text-primary 应该是亮字（${text}）`)

    // 避免纯黑 / 纯白的廉价对比，也避免回退到旧的冷灰 #1f1f1f 体系
    assert.doesNotMatch(dark, /--bg-base:\s*#000000/i)
    assert.doesNotMatch(dark, /--text-primary:\s*#ffffff/i)
    assert.notEqual(text, '#ffffff')
    assert.match(dark, /color-scheme:\s*dark/)
  })

  it('should_use_amber_brand_and_warm_focus', () => {
    const dark = darkBlock(css)
    const brand = hexToken(dark, 'brand')
    const channels = [1, 3, 5].map((index) => parseInt(brand.slice(index, index + 2), 16))
    const max = Math.max(...channels)
    const min = Math.min(...channels)
    // 琥珀：#f59e0b 一类（R > G > B，且明显偏暖）
    assert.ok(channels[0] === max, `--brand 应偏暖（R 最大），实际 ${brand}`)
    assert.ok(channels[2] === min, `--brand 应是琥珀而非冷色，实际 ${brand}`)
    assert.match(dark, /--focus-border:\s*var\(--brand\)|--focus-border:\s*#f/i)
  })

  it('should_derive_dark_low_chroma_tailwind_tokens', () => {
    const dark = darkBlock(css)
    const background = hslToken(dark, 'background')
    const foreground = hslToken(dark, 'foreground')
    const mutedForeground = hslToken(dark, 'muted-foreground')

    assert.ok(background.l <= 20, `--background 亮度应偏暗，实际 ${background.l}%`)
    assert.ok(background.s <= 20, `--background 应是低彩度近中性，实际 ${background.s}%`)
    assert.ok(foreground.l >= 80, `--foreground 亮度应偏亮，实际 ${foreground.l}%`)
    assert.ok(mutedForeground.l > background.l && mutedForeground.l < foreground.l, 'muted-foreground 应落在底与主字之间')
  })

  it('should_keep_dark_shell_edges_flat_not_bright', () => {
    const dark = darkBlock(css)
    assert.match(css, /\.dark \.shell-track-center \.main-chat-column/)
    assert.match(dark, /--composer-shell-border:\s*#3a3a3a/i)
    assert.match(css, /\.composer-shell \{[^}]*border-color:\s*var\(--composer-shell-border\)/s)
    assert.doesNotMatch(
      css,
      /\.dark \.shell-track-center \.main-chat-column \{[^}]*#ffffff/,
      'no bright white hairline on chat column',
    )
  })
})
