import { describe, expect, it } from 'vitest'
import { placeContextMenu } from './context-menu-shared'

const VIEWPORT = { width: 1200, height: 800 }
const MENU = { width: 200, height: 260 }

describe('placeContextMenu', () => {
  it('keeps a menu that fits below the pointer in place', () => {
    expect(placeContextMenu({ x: 120, y: 100 }, MENU, VIEWPORT)).toEqual({ left: 120, top: 100 })
  })

  it('flips above the pointer when the row sits near the bottom', () => {
    // 对话在最后一行：向下弹会被窗口底边切掉，所以菜单底边贴住鼠标向上弹。
    expect(placeContextMenu({ x: 120, y: 700 }, MENU, VIEWPORT).top).toBe(700 - MENU.height)
  })

  it('never leaves the window on the right or at the top', () => {
    expect(placeContextMenu({ x: 1150, y: 100 }, MENU, VIEWPORT).left).toBe(VIEWPORT.width - MENU.width - 8)
    expect(placeContextMenu({ x: 20, y: 10 }, { width: 200, height: 800 }, VIEWPORT).top).toBe(8)
  })

  it('honours a custom margin', () => {
    expect(placeContextMenu({ x: -50, y: -50 }, MENU, VIEWPORT, 16)).toEqual({ left: 16, top: 16 })
  })
})
