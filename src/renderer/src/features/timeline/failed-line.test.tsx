import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { FailedLine, findRetryPromptBeforeItem } from './failed-line'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('FailedLine', () => {
  it('renders retry button when onRetry is provided and invokes callback', () => {
    const onRetry = vi.fn()
    render(<FailedLine error="Request timed out" onRetry={onRetry} />)

    const btn = screen.getByRole('button', { name: 'timeline:failed.retry' })
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('finds nearest preceding user prompt before the failed item', () => {
    const items: TimelineItem[] = [
      { id: 'u1', type: 'user-message', text: 'First question', timestamp: 1 },
      { id: 'a1', type: 'assistant-message', text: 'Answer', timestamp: 2 },
      { id: 'u2', type: 'user-message', text: 'Refactor the parser', timestamp: 3 },
      { id: 'a2', type: 'assistant-message', text: '', timestamp: 4 },
    ]
    expect(findRetryPromptBeforeItem(items, 'a2', 'Continue')).toBe('Refactor the parser')
    expect(findRetryPromptBeforeItem(items, 'missing', 'Continue')).toBe('Refactor the parser')
    expect(findRetryPromptBeforeItem([], 'a2', 'Continue')).toBe('Continue')
  })
})
