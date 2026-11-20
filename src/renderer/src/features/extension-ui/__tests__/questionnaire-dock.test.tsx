import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { QuestionnaireDock } from '../questionnaire-dock'

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (...args: unknown[]) => invoke(...args) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

const ask = {
  id: 'ask-1',
  method: 'ask_user_question' as const,
  questions: [{ question: '走哪种登录？', header: '账号体系', options: [{ label: '复用后台账号' }, { label: '独立账号', description: '单独一套账号' }] }],
}

beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

afterEach(() => {
  act(() => {
    useExtensionUIStore.setState({ activePending: null, suspended: null })
    useUIStore.setState({ timelineItems: [] })
  })
  invoke.mockClear()
})

describe('QuestionnaireDock', () => {
  it('docks the question above the composer and answers through the extension channel', () => {
    render(<QuestionnaireDock />)
    act(() => useExtensionUIStore.setState({ activePending: ask }))

    const dock = screen.getByTestId('questionnaire-dock')
    expect(dock).toHaveTextContent('等你确认')
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('走哪种登录？')

    fireEvent.click(screen.getByRole('radio', { name: /复用后台账号/ }))
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(invoke).toHaveBeenCalledWith('extension.respondUI', {
      id: 'ask-1',
      result: {
        cancelled: false,
        answers: [{ questionIndex: 0, question: '走哪种登录？', kind: 'option', answer: '复用后台账号' }],
      },
    })
  })

  it('collapses to a single header row and back', () => {
    render(<QuestionnaireDock />)
    act(() => useExtensionUIStore.setState({ activePending: ask }))

    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
    expect(screen.getByTestId('questionnaire-dock')).toHaveTextContent('走哪种登录？')

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
  })

  it('stays out of the way when the timeline row already draws the question', () => {
    act(() => {
      useUIStore.setState({
        timelineItems: [{ id: 'row-1', type: 'tool-call', toolName: 'ask_user_question', toolPhase: 'start', extensionUiRequestId: 'ask-1' } as never],
      })
      useExtensionUIStore.setState({ activePending: ask })
    })
    render(<QuestionnaireDock />)
    expect(screen.queryByTestId('questionnaire-dock')).toBeNull()
  })
})
