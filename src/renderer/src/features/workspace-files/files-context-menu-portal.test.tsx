import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilesContextMenuPortal } from './files-context-menu-portal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

afterEach(cleanup)

const menu = {
  x: 24,
  y: 24,
  abs: 'C:/proj/docs',
  name: 'docs',
  rel: 'docs',
  isDirectory: true,
}

function renderMenu(overrides: Partial<Parameters<typeof FilesContextMenuPortal>[0]> = {}) {
  const onAttach = vi.fn()
  const onClose = vi.fn()
  render(
    <FilesContextMenuPortal
      menu={menu}
      onClose={onClose}
      onPreview={vi.fn()}
      onAttach={onAttach}
      onCopyPath={vi.fn()}
      onRename={vi.fn()}
      onReveal={vi.fn()}
      {...overrides}
    />,
  )
  return { onAttach, onClose }
}

describe('files context menu', () => {
  it('puts "添加到对话" first, so a folder can be attached without dragging', () => {
    const { onAttach, onClose } = renderMenu()
    const buttons = screen.getAllByRole('button')
    // 文件夹菜单以前根本没有这一项；现在必须排第一
    expect(buttons[0].textContent).toBe('menu.addToChat')
    fireEvent.click(buttons[0])
    expect(onAttach).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps it first for files too, ahead of preview', () => {
    renderMenu({ menu: { ...menu, abs: 'C:/proj/a.ts', name: 'a.ts', rel: 'a.ts', isDirectory: false } })
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].textContent).toBe('menu.addToChat')
    expect(buttons[1].textContent).toBe('menu.preview')
  })
})
