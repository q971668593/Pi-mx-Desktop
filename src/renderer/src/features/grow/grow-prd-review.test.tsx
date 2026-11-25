import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GrowPrdReview, type GrowPrdReviewProps } from './grow-prd-review'

function props(overrides: Partial<GrowPrdReviewProps> = {}): GrowPrdReviewProps {
  return { original: '原文\n第二行', updated: '新文\n第二行', reason: '明确需求', busy: false, onConfirm: vi.fn(), onCancel: vi.fn(), ...overrides }
}

describe('GrowPrdReview', () => {
  it('展示完整的修改前后、原因和确认写入说明', () => {
    const callbacks = props()
    render(<GrowPrdReview {...callbacks} />)
    expect(screen.getByRole('region', { name: '修改前' })).toHaveTextContent('原文 第二行')
    expect(screen.getByRole('region', { name: '修改后' })).toHaveTextContent('新文 第二行')
    expect(screen.getByText('明确需求')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '审阅 PRD 变更' })).toHaveAccessibleDescription('仅在确认后写入，取消将放弃本次变更。')
    expect(callbacks.onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))
    expect(callbacks.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('区分空内容并保留空白字符', () => {
    render(<GrowPrdReview {...props({ original: '', updated: '  \n', reason: '' })} />)
    expect(within(screen.getByRole('region', { name: '修改前' })).getByText('（空内容）')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '修改后' }).querySelector('pre')?.textContent).toBe('  \n')
    expect(screen.getAllByText('（空内容）')).toHaveLength(2)
  })

  it('取消按钮和 Escape 调用取消，卸载后移除快捷键', () => {
    const callbacks = props()
    const { unmount } = render(<GrowPrdReview {...callbacks} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callbacks.onCancel).toHaveBeenCalledTimes(2)
    unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callbacks.onCancel).toHaveBeenCalledTimes(2)
  })

  it('处理期间禁止重复确认、取消和 Escape，完成后可重试', async () => {
    let finish = () => {}
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const callbacks = props({ onConfirm })
    const { rerender } = render(<GrowPrdReview {...callbacks} />)
    const confirm = screen.getByRole('button', { name: '确认写入' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在处理')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(callbacks.onCancel).not.toHaveBeenCalled()
    rerender(<GrowPrdReview {...callbacks} busy />)
    await act(async () => finish())
    expect(confirm).toBeDisabled()
    rerender(<GrowPrdReview {...callbacks} busy={false} />)
    expect(confirm).toBeEnabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
  })
})
