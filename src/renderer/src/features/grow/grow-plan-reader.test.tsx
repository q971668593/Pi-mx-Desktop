import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { buildGrowKickoff } from './grow-kickoff'
import { GrowPanel } from './grow-panel'
import { EMPTY_GROW_STATE } from './grow-types'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))

const workspace = 'C:/project'
const path = 'C:/project/.文档/grow-me/session/方案.html'
const state = { ...EMPTY_GROW_STATE, ready: true, docFile: path, chapters: [
  { id: 'F-01', title: '第一章', ready: true },
  { id: 'missing', title: '第二章', ready: true },
] }

beforeEach(() => {
  mocks.invoke.mockReset()
  useUIStore.setState({ currentWorkspace: workspace, historySessionFile: 'session.jsonl',
    timelineItems: [{ id: 'start', type: 'user-message', timestamp: 1, text: buildGrowKickoff('session', '需求') }],
    sessionRuntimeRunning: {}, workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' } })
})

describe('Grow 方案阅读', () => {
  it('在面板中打开方案并定位章节，保留需求树，重复点击仍可跳转', async () => {
    mocks.invoke.mockImplementation(async (method) => method === 'grow:getState'
      ? { ok: true, state } : { ok: true, content: '<section id="F-01">第一章内容</section>' })
    render(<GrowPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /第一章/ }))
    const frame = await screen.findByTitle('方案内容') as HTMLIFrameElement
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.srcdoc).toContain('第一章内容')
    expect(screen.getByRole('button', { name: /第二章/ })).toBeInTheDocument()
    expect(mocks.invoke).toHaveBeenCalledWith('workspace.fs.readText', expect.objectContaining({ workspaceRoot: workspace, path }))
    expect(mocks.invoke.mock.calls.some(([method]) => method === 'shell.openPath')).toBe(false)
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'grow:ready' } })))
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'grow:chapter', id: 'F-01' }, '*'))
    post.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /第一章/ }))
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'grow:chapter', id: 'F-01' }, '*'))
    post.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /第一章/ }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /第二章/ }))
    expect(screen.getByText('未找到对应章节，已打开完整方案。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭阅读器' }))
    expect(screen.queryByTitle('方案内容')).not.toBeInTheDocument()
  })

  it('读取失败可重试，加载期间显示状态', async () => {
    let finish: (result: unknown) => void = () => {}
    mocks.invoke.mockImplementation((method) => method === 'grow:getState' ? Promise.resolve({ ok: true, state })
      : method === 'grow:listSessions' ? Promise.resolve({ ok: true, trees: [], sessionId: null })
      : new Promise((resolve) => { finish = resolve }))
    render(<GrowPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '打开方案' }))
    expect(screen.getByText('正在读取方案…')).toBeInTheDocument()
    await act(async () => finish({ ok: false }))
    expect(screen.getByRole('alert')).toHaveTextContent('方案读取失败')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await act(async () => finish({ ok: true, content: '<p>方案</p>' }))
    expect(await screen.findByTitle('方案内容')).toBeInTheDocument()
  })

  it('切换会话后丢弃尚未完成的读取', async () => {
    let finish: (result: unknown) => void = () => {}
    mocks.invoke.mockImplementation((method) => method === 'grow:getState' ? Promise.resolve({ ok: true, state })
      : method === 'grow:listSessions' ? Promise.resolve({ ok: true, trees: [], sessionId: null })
      : new Promise((resolve) => { finish = resolve }))
    render(<GrowPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '打开方案' }))
    act(() => useUIStore.setState({ historySessionFile: 'another.jsonl', timelineItems: [] }))
    await act(async () => finish({ ok: true, content: '旧方案' }))
    expect(screen.queryByLabelText('方案阅读器')).not.toBeInTheDocument()
  })
})
