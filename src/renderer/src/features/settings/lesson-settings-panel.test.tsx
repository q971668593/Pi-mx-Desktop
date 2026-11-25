import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
// 只验列表/开关/删除与 IPC 契约，i18n 直接回 key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { message: vi.fn(), error: vi.fn() } }))

import { LessonSettingsPanel } from './lesson-settings-panel'

function snapshot(patch: Record<string, unknown> = {}) {
  return {
    lessons: [
      { id: 'l1', createdAt: 1, text: '表格太丑', status: 'pending', source: 'auto' },
    ],
    rules: [
      { id: 'r1', createdAt: 1, title: '表格', body: '报销别用表格', polarity: 'negative', fromLessonIds: [], source: 'model' },
    ],
    counts: { pending: 1, kept: 0, rules: 1 },
    injectIntoContext: true,
    ...patch,
  }
}

describe('LessonSettingsPanel', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === 'feedback.list') return snapshot()
      throw new Error(`unexpected ${method}`)
    })
  })

  it('打开时列出规则与教训，开关默认开', async () => {
    render(<LessonSettingsPanel />)
    await screen.findByText('报销别用表格')
    expect(screen.getByText('表格太丑')).toBeInTheDocument()
    const toggle = screen.getByRole('switch')
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
  })

  it('拨掉开关写 feedback.inject.set', async () => {
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === 'feedback.list') return snapshot()
      if (method === 'feedback.inject.set') return { ok: true, injectIntoContext: false }
      throw new Error(`unexpected ${method}`)
    })
    render(<LessonSettingsPanel />)
    const toggle = await screen.findByRole('switch')
    await userEvent.click(toggle)
    expect(mocks.invoke).toHaveBeenCalledWith('feedback.inject.set', { enabled: false })
  })

  it('删除规则写 feedback.rule.delete 并刷新列表', async () => {
    let rules = [{ id: 'r1', createdAt: 1, title: '表格', body: '报销别用表格', polarity: 'negative', fromLessonIds: [], source: 'model' }]
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === 'feedback.list') return snapshot({ rules })
      if (method === 'feedback.rule.delete') {
        rules = []
        return { ok: true }
      }
      throw new Error(`unexpected ${method}`)
    })
    render(<LessonSettingsPanel />)
    await screen.findByText('报销别用表格')
    const deletes = screen.getAllByText('common:delete')
    await userEvent.click(deletes[0])
    expect(mocks.invoke).toHaveBeenCalledWith('feedback.rule.delete', { id: 'r1' })
    await waitFor(() => expect(screen.queryByText('报销别用表格')).not.toBeInTheDocument())
  })
})
