import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Settings,
  Square,
  ThemedIcon,
  applyIconTheme,
  isIconThemeLoaded,
  preloadIconTheme,
} from '@renderer/components/icons'

describe('lazy icon theme loading', () => {
  afterEach(cleanup)

  it('starts with phosphor loaded and lazily loads non-default themes', async () => {
    expect(isIconThemeLoaded('phosphor')).toBe(true)
    const { container } = render(<ThemedIcon theme="iconoir" name="settings" />)
    expect(container.firstElementChild).toHaveAttribute('data-icon-theme', 'iconoir')
    await waitFor(() => {
      expect(isIconThemeLoaded('iconoir')).toBe(true)
    })
  })
})

for (const theme of ['phosphor', 'lucide', 'fluent', 'hugeicons', 'iconoir'] as const) {
  describe(`${theme} icon theme`, () => {
    afterEach(cleanup)

    it('renders the selected vendor glyph without a wrapper and forwards SVG props', async () => {
      await applyIconTheme(theme)
      const { container } = render(
        <Settings
          className="h-4 w-4 animate-spin"
          aria-hidden="true"
          data-open="true"
          style={{ color: 'rgb(1, 2, 3)' }}
        />,
      )
      const svg = container.firstElementChild
      expect(svg?.tagName.toLowerCase()).toBe('svg')
      expect(svg).toHaveAttribute('data-icon-theme', theme)
      expect(svg).toHaveClass('h-4', 'w-4', 'animate-spin')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('data-open', 'true')
      expect(svg).toHaveStyle({ color: 'rgb(1, 2, 3)' })
    })

    it('renders explicit previews independently from the global theme', async () => {
      await preloadIconTheme(theme)
      await applyIconTheme('lucide')
      const { container } = render(<ThemedIcon theme={theme} name="settings" />)
      expect(container.firstElementChild).toHaveAttribute('data-icon-theme', theme)
    })

    it('preserves the filled stop-square semantic', async () => {
      await applyIconTheme(theme)
      const { container } = render(<Square className="h-3 w-3 fill-current" strokeWidth={0} />)
      expect(container.firstElementChild).toHaveAttribute('data-icon-filled', 'true')
    })
  })
}
