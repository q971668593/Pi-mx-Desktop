import { describe, expect, it } from 'vitest'
import { notificationHostPageHtml } from './notification-host-page'

describe('notification host page', () => {
  it('exposes a focus request channel for the explicit keyboard entry', () => {
    const html = notificationHostPageHtml()

    expect(html).toContain('api.onFocus')
    expect(html).toContain("stack.querySelector('.card:last-child .open')?.focus()")
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
