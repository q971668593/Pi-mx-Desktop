import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { QuestionnairePanel } from '../questionnaire-panel'
import type { AskQuestionPayload, QuestionnaireAnswer } from '../questionnaire-model'

const questions: AskQuestionPayload[] = [
  { question: 'Which database?', header: 'Storage', options: [{ label: 'SQLite' }, { label: 'Postgres', description: 'Server' }] },
  { question: 'Which features?', header: 'Scope', multiSelect: true, options: [{ label: 'Auth' }, { label: 'Billing' }, { label: 'Search' }] },
  { question: 'Ship when?', options: [{ label: 'Today' }, { label: 'Next week' }] },
]

function setup(id = 'req-1', qs = questions, variant: 'dock' | 'inline' = 'dock') {
  const onSubmit = vi.fn<(answers: QuestionnaireAnswer[]) => void>()
  const onCancel = vi.fn()
  const onSuspend = vi.fn()
  render(<QuestionnairePanel requestId={id} questions={qs} variant={variant} onSubmit={onSubmit} onCancel={onCancel} onSuspend={onSuspend} />)
  return { onSubmit, onCancel, onSuspend }
}

const title = () => screen.getByRole('heading', { level: 3 }).textContent

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('QuestionnairePanel', () => {
  it('shows one question at a time and advances right after a single-choice pick', () => {
    vi.useFakeTimers()
    const { onSubmit } = setup()
    expect(title()).toBe('Which database?')

    fireEvent.click(screen.getByRole('radio', { name: /SQLite/ }))
    act(() => vi.advanceTimersByTime(300))
    expect(title()).toBe('Which features?')

    // 多选不自动翻页，也不会自己提交
    fireEvent.click(screen.getByRole('checkbox', { name: /Search/ }))
    expect(title()).toBe('Which features?')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    fireEvent.click(screen.getByRole('radio', { name: /Today/ }))
    act(() => vi.advanceTimersByTime(300))
    expect(title()).toBe('Ship when?')
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith([
      { questionIndex: 0, question: 'Which database?', kind: 'option', answer: 'SQLite' },
      // 选项按扩展给的顺序，不按点击顺序
      { questionIndex: 1, question: 'Which features?', kind: 'multi', answer: null, selected: ['Search'] },
      { questionIndex: 2, question: 'Ship when?', kind: 'option', answer: 'Today' },
    ])
  })

  it('jumps to the first open question instead of submitting blanks', () => {
    const { onSubmit } = setup('req-2')
    fireEvent.click(screen.getByRole('button', { name: /^3$/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Next week/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(title()).toBe('Which database?')
    expect(screen.getByRole('status').textContent).toBe('2 questions unanswered')
  })

  it('keeps keyboard focus on the panel after jumping with a step tab', () => {
    setup('req-8')
    const tab = screen.getByRole('button', { name: /Scope/ })
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    tab.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    fireEvent.click(tab)
    expect(title()).toBe('Which features?')
  })

  it('treats a typed answer as its own choice', () => {
    const { onSubmit } = setup('req-3', [questions[0]])
    fireEvent.click(screen.getByRole('radio', { name: /Other|其他/ }))
    const box = screen.getByPlaceholderText(/answer|答案/)
    fireEvent.change(box, { target: { value: 'DuckDB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith([{ questionIndex: 0, question: 'Which database?', kind: 'custom', answer: 'DuckDB' }])
  })

  it('picks options with number keys and closes on Escape', () => {
    const { onSuspend } = setup('req-4', [questions[0]])
    fireEvent.keyDown(screen.getByTestId('questionnaire-panel'), { key: '2' })
    expect(screen.getByRole('radio', { name: /Postgres/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onSuspend).toHaveBeenCalled()
  })
})
