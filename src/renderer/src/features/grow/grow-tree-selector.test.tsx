import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GrowTreeSelector, type GrowTreeSelectorProps } from './grow-tree-selector'

const trees = [
  { sessionId: 'first', requirement: '第一个需求', pendingCount: 2, reviewCount: 1 },
  { sessionId: 'second', requirement: '第二个需求', pendingCount: 0, reviewCount: 3 },
]

function props(overrides: Partial<GrowTreeSelectorProps> = {}): GrowTreeSelectorProps {
  return { trees, selectedId: 'first', loading: false, disabled: false, onSelect: vi.fn(), onRefresh: vi.fn(), ...overrides }
}

describe('GrowTreeSelector', () => {
  it('显示名称与计数，选择有效值并忽略空值', async () => {
    const user = userEvent.setup()
    const input = props()
    render(<GrowTreeSelector {...input} />)
    const select = screen.getByRole('combobox', { name: '需求树' })
    expect(select).toHaveValue('first')
    expect(screen.getByRole('option', { name: '第一个需求（待答 2 / 待复核 1）' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '第二个需求（待答 0 / 待复核 3）' })).toBeInTheDocument()
    await user.selectOptions(select, 'second')
    expect(input.onSelect).toHaveBeenCalledWith('second')
    fireEvent.change(select, { target: { value: '' } })
    expect(input.onSelect).toHaveBeenCalledTimes(1)
  })

  it('空态可刷新，缺失的选中项显示占位', async () => {
    const user = userEvent.setup()
    const input = props({ trees: [], selectedId: 'missing' })
    render(<GrowTreeSelector {...input} />)
    expect(screen.getByRole('combobox', { name: '需求树' })).toBeDisabled()
    expect(screen.getByText('暂无需求树')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '刷新' }))
    expect(input.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('加载和禁用状态阻止操作，并向辅助技术报告加载', () => {
    const input = props({ loading: true })
    const { rerender } = render(<GrowTreeSelector {...input} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载需求树')
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled()
    rerender(<GrowTreeSelector {...input} loading={false} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled()
  })

  it('支持键盘聚焦选择器和触发刷新', async () => {
    const user = userEvent.setup()
    const input = props({ selectedId: undefined })
    render(<GrowTreeSelector {...input} />)
    await user.tab()
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.selectOptions(screen.getByRole('combobox'), 'second')
    expect(input.onSelect).toHaveBeenCalledWith('second')
    await user.tab()
    expect(screen.getByRole('button', { name: '刷新' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(input.onRefresh).toHaveBeenCalledTimes(1)
  })
})
