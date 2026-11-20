import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { AskUserInlineCard } from '../ask-user-inline-card'

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (...args: unknown[]) => invoke(...args) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

const questions = [
  { question: '先做哪一屏？', header: '范围', options: [{ label: '桌面端' }, { label: '移动端', description: '优先手机' }] },
  { question: '要不要保留旧导航？', options: [{ label: '保留' }, { label: '删掉' }] },
]

beforeEach(async () => {
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
  invoke.mockClear()
})

afterEach(cleanup)

describe('AskUserInlineCard', () => {
  it('renders the options inline and submits the picked answer', () => {
    const onDone = vi.fn()
    render(<AskUserInlineCard requestId="req-1" questions={questions} timelineItemId="row-1" onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: '移动端' }))
    fireEvent.click(screen.getByRole('button', { name: '保留' }))
    fireEvent.click(screen.getByRole('button', { name: '就这样' }))
    expect(invoke).toHaveBeenCalledWith('extension.respondUI', {
      id: 'req-1',
      result: {
        cancelled: false,
        answers: [
          { questionIndex: 0, question: '先做哪一屏？', kind: 'option', answer: '移动端' },
          { questionIndex: 1, question: '要不要保留旧导航？', kind: 'option', answer: '保留' },
        ],
      },
    })
    expect(onDone).toHaveBeenCalled()
    expect(screen.getByText('已回答，模型继续处理')).toBeInTheDocument()
  })

  it('accepts a typed answer and marks it as custom', () => {
    render(<AskUserInlineCard requestId="req-2" questions={[questions[0]]} onDone={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('也可以直接写你的答案…'), { target: { value: '先做平板断点' } })
    fireEvent.click(screen.getByRole('button', { name: '就这样' }))
    const call = invoke.mock.calls[0] as unknown as [string, { result: { answers: Array<{ kind: string; answer: string }> } }]
    expect(call[1].result.answers[0]).toMatchObject({ kind: 'custom', answer: '先做平板断点' })
  })

  it('does not submit before anything is answered, and can cancel', () => {
    render(<AskUserInlineCard requestId="req-3" questions={questions} onDone={() => {}} />)
    expect(screen.getByRole('button', { name: '就这样' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(invoke).toHaveBeenCalledWith('extension.respondUI', { id: 'req-3', cancelled: true })
  })
})
