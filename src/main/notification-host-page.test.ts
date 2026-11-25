import { describe, expect, it } from 'vitest'
import { notificationHostPageHtml } from './notification-host-page'

describe('notification host page', () => {
  it('exposes a focus request channel for the explicit keyboard entry', () => {
    const html = notificationHostPageHtml()

    expect(html).toContain('api.onFocus')
    expect(html).toContain("stack.querySelector('.card:last-child .open')?.focus()")
  })

  it('shows the whole body by default and only clamps it when the user folds it', () => {
    const html = notificationHostPageHtml()

    // 默认不裁切：除了「用户收起」那条规则，正文本身不带任何行数限制
    const withoutFoldRule = html.replace(/\.card\.collapsed \.body \{[^}]*\}/s, '')
    expect(withoutFoldRule).not.toContain('-webkit-line-clamp')
    expect(html).toContain('.card.collapsed .body')
    expect(html).toContain('-webkit-line-clamp: 2')
    // 折叠态是用户点出来的，且只存在内存里（新卡片一定展开）
    expect(html).toContain('const collapsed = new Set()')
    expect(html).toContain("fold.textContent = isCollapsed ? '展开' : '收起'")
  })

  it('reports its measured height so the host window can grow instead of clipping', () => {
    const html = notificationHostPageHtml()

    expect(html).toContain('function reportSize()')
    expect(html).toContain('api.resize(height)')
    // 双帧后再量：字体/换行稳定前量到的高度会偏小
    expect(html).toContain('requestAnimationFrame(() => requestAnimationFrame(reportSize))')
  })

  it('plays the preset alert sound on its own channel, so sound-only mode has no card', () => {
    const html = notificationHostPageHtml()

    // The host applies the user's volume (percent, 0–200) on top of the shared tone table.
    expect(html).toContain('api.onSound((preset, volume) => play(preset, volume))')
    expect(html).toContain('function play(preset, volume)')
    expect(html).toContain('const factor = (level / 100) * 2')
    // The main process decides when to sound (card or sound-only), so a render must stay silent.
    expect(html).not.toContain('playedSoundIds')
  })
})
