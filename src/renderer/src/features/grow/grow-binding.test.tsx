import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { GrowPanel } from './grow-panel'
import { GrowRoundCards } from './grow-round-card'
import { EMPTY_GROW_STATE } from './grow-types'
import { growDraftPrefix } from './use-grow-target'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/send-composer-prompt', () => ({ sendComposerPrompt: mocks.send }))
const workspace = 'C:/project', file = 'C:/sessions/a.jsonl'
let binding: string | null
beforeEach(() => {
  localStorage.clear(); binding = null
  mocks.send.mockReset().mockResolvedValue(true)
  mocks.invoke.mockReset().mockImplementation(async (method, request) => {
    if (method === 'grow:getState') return { ok: true, state: { ...EMPTY_GROW_STATE, ready: true } }
    if (request.action === 'getBinding') return { ok: true, sessionId: binding }
    if (request.action === 'setBinding') { binding = request.sessionId; return { ok: true, sessionId: binding } }
    return { ok: true, unreadable: 0, trees: [{ sessionId: 'tree-a', requirement: '需求甲', pendingCount: 0, reviewCount: 0 }, { sessionId: 'tree-b', requirement: '需求乙', pendingCount: 0, reviewCount: 0 }] }
  })
  useUIStore.setState({ currentWorkspace: workspace, historySessionFile: file, timelineItems: [], sessionRuntimeRunning: {}, workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' } })
})

describe('跨对话需求树绑定', () => {
  it('选择后明确发送续接消息，并保留聊天输入', async () => {
    render(<><textarea aria-label="草稿" defaultValue="保留草稿" /><GrowPanel /></>)
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tree-a' } })
    await screen.findByRole('button', { name: '发送续接消息' })
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '发送续接消息' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.stringContaining('tree-a')))
    expect(screen.getByRole('textbox', { name: '草稿' })).toHaveValue('保留草稿')
  })
  it('旧题卡阻止向已切换的需求树提交', async () => {
    binding = 'tree-b'
    render(<GrowRoundCards rounds={[{ session: 'tree-a', round: 1, questions: [{ id: 'q', q: '问题', kind: 'text' }] }]} />)
    fireEvent.change(screen.getByRole('textbox', { name: '你的回复' }), { target: { value: '草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存回复' }))
    expect(await screen.findByText(/当前需求树已切换/)).toBeInTheDocument()
    expect(mocks.invoke.mock.calls.some(([method]) => method === 'grow:submitAnswer')).toBe(false)
  })
  it('绑定读取失败时仍可选择其他树恢复绑定', async () => {
    const original = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation(async (method, request) => {
      if (method === 'grow:listSessions' && request.action === 'getBinding' && !binding) return { ok: false }
      return original(method, request)
    })
    render(<GrowPanel />)
    expect(await screen.findByText(/需求树绑定读取失败/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tree-b' } })
    await waitFor(() => expect(binding).toBe('tree-b'))
    await screen.findByRole('button', { name: '发送续接消息' })
  })
  it('未落盘对话提示先发消息；有题卡草稿时拦截切换', async () => {
    useUIStore.setState({ historySessionFile: null })
    const view = render(<GrowPanel />)
    expect(screen.getByText(/新对话尚未保存/)).toBeInTheDocument()
    view.unmount()
    binding = 'tree-a'; useUIStore.setState({ historySessionFile: file })
    localStorage.setItem(`${growDraftPrefix(workspace, file, 'tree-a')}q`, '{}')
    render(<GrowPanel />)
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('tree-a'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tree-b' } })
    expect(screen.getByText(/有未保存的题卡草稿/)).toBeInTheDocument()
    expect(binding).toBe('tree-a')
  })
})
