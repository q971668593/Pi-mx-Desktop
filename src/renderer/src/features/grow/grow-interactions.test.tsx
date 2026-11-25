import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GrowNodeView } from '@shared/ipc-contract'
import { useUIStore } from '@renderer/stores/ui-store'
import { buildGrowKickoff } from './grow-kickoff'
import { GrowPanel } from './grow-panel'
import { GrowRoundCards } from './grow-round-card'
import { EMPTY_GROW_STATE } from './grow-types'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/send-composer-prompt', () => ({ sendComposerPrompt: mocks.send }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const workspace = 'C:/project'
const sessionFile = 'C:/sessions/clarify.jsonl'
const session = 'g-current'
const question = { id: 'q1', q: '给谁用？' }
const round = { session, round: 1, questions: [question] }
const multiple = { id: 'q1', q: '覆盖哪些人群？', kind: 'multiple' as const, options: ['应届生', '在职人群', '自由职业者'] }
const single = { id: 'q2', q: '展示几个结果？', kind: 'single' as const, options: ['一个', '三个'] }

function savedQuestion(question: typeof multiple | typeof single, selectedOptions?: string[]): GrowNodeView {
  return {
    id: question.id, question: question.q, kind: question.kind, options: question.options,
    round: 1, status: selectedOptions ? 'answered' : 'pending',
    selectedOptions, answer: selectedOptions?.join('、'),
  }
}

function treeState(nodes: GrowNodeView[]) {
  return { ok: true, state: { ...EMPTY_GROW_STATE, ready: true, nodes } }
}

beforeEach(() => {
  localStorage.clear()
  mocks.invoke.mockReset().mockResolvedValue(null)
  mocks.send.mockReset()
  useUIStore.setState({
    currentWorkspace: workspace,
    historySessionFile: sessionFile,
    timelineItems: [{ id: 'kickoff', type: 'user-message', timestamp: 1, text: buildGrowKickoff(session, '做个问卷') }],
    sessionRuntimeRunning: {},
    workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' },
  })
})

describe('需求澄清交互', () => {
  it('同一棵树的草稿按对话隔离，切回后恢复已保存答案的编辑状态', async () => {
    const open = { id: 'q1', q: '给谁用？', kind: 'text' as const }
    mocks.invoke.mockImplementation(async (method) => method === 'grow:listSessions'
      ? { ok: true, sessionId: session } : treeState([{ id: open.id, question: open.q, kind: 'text', status: 'answered', answer: '旧答案' }]))
    render(<GrowRoundCards rounds={[{ ...round, questions: [open] }]} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改' }))
    fireEvent.change(screen.getByRole('textbox', { name: '你的回复' }), { target: { value: '未保存的新答案' } })
    act(() => useUIStore.setState({ historySessionFile: 'C:/sessions/other.jsonl' }))
    expect(await screen.findByText('已保存 · 旧答案')).toBeInTheDocument()
    act(() => useUIStore.setState({ historySessionFile: sessionFile }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '你的回复' })).toHaveValue('未保存的新答案'))
    expect(screen.getByRole('button', { name: '取消修改' })).toBeInTheDocument()
  })

  it('历史题卡显示树中更新后的题目', async () => {
    mocks.invoke.mockResolvedValue(treeState([{ id: question.id, question: '更新后的问题', kind: 'text', status: 'pending' }]))
    render(<GrowRoundCards rounds={[round]} />)
    expect(await screen.findByText('更新后的问题')).toBeInTheDocument()
    expect(screen.queryByText(question.q)).not.toBeInTheDocument()
  })
  it('点击收尾只发一次请求，连点不重复，也不写入输入框', async () => {
    mocks.invoke.mockImplementation(async (method) => method === 'grow:listSessions'
      ? { ok: true } : treeState([{ id: question.id, question: question.q, status: 'pending' }]))
    let finishSending: (accepted: boolean) => void = () => {}
    mocks.send.mockReturnValue(new Promise<boolean>((resolve) => { finishSending = resolve }))
    const retry = vi.fn()
    window.addEventListener('pi-desktop:composer-retry', retry)
    try {
      render(<><textarea aria-label="聊天草稿" defaultValue="我原来的草稿" /><GrowRoundCards rounds={[round]} /></>)
      const plan = screen.getByRole('button', { name: '开始制定方案' })
      fireEvent.click(plan)
      fireEvent.click(plan)
      expect(plan).toBeDisabled()
      await waitFor(() => expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('grow_tree 工具 begin_plan')))
      expect(screen.getByRole('textbox', { name: '聊天草稿' })).toHaveValue('我原来的草稿')
      expect(retry).not.toHaveBeenCalled()
      await act(async () => { finishSending(true) })
    } finally {
      window.removeEventListener('pi-desktop:composer-retry', retry)
    }
  })

  it('从题卡底部开始制定方案时，先保存已选和已填的答案，跳过空题', async () => {
    const open = { id: 'q3', q: '还有什么限制？', kind: 'text' as const }
    let nodes: GrowNodeView[] = [savedQuestion(multiple), savedQuestion(single), { id: open.id, question: open.q, kind: 'text', status: 'pending' }]
    mocks.invoke.mockImplementation(async (method, payload) => {
      if (method !== 'grow:submitAnswer') return treeState(nodes)
      const previous = nodes.find((node) => node.id === payload.nodeId)!
      const node: GrowNodeView = { ...previous, status: 'answered', answer: payload.text ?? payload.selectedOptions.join('、') }
      nodes = nodes.map((item) => item.id === node.id ? node : item)
      return { ok: true, node }
    })
    const answersAtSend = vi.fn()
    mocks.send.mockImplementation(async () => {
      answersAtSend(nodes.map((node) => node.answer))
      return true
    })
    render(<GrowRoundCards rounds={[{ ...round, questions: [multiple, single, open] }]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '应届生' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '在职人群' }))
    const textarea = screen.getByRole('textbox', { name: '你的回复' })
    fireEvent.change(textarea, { target: { value: '周五前完成' } })
    expect(mocks.invoke.mock.calls.filter(([method]) => method === 'grow:submitAnswer')).toHaveLength(0)
    const plan = screen.getByRole('button', { name: '开始制定方案' })
    expect(textarea.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(plan)
    await waitFor(() => expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('开始制定方案。')))
    expect(answersAtSend).toHaveBeenCalledExactlyOnceWith(['应届生、在职人群', undefined, '周五前完成'])
    expect(mocks.invoke.mock.calls.filter(([method]) => method === 'grow:submitAnswer').map(([, payload]) => payload)).toEqual([
      { workspaceId: workspace, sessionId: session, nodeId: multiple.id, action: 'select', selectedOptions: ['应届生', '在职人群'],
        publishedFormat: { kind: multiple.kind, options: multiple.options } },
      { workspaceId: workspace, sessionId: session, nodeId: open.id, action: 'answer', text: '周五前完成' },
    ])
  })

  it('答案保存失败时暂停制定方案，并保留选项供重试', async () => {
    let shouldFail = true
    let nodes = [savedQuestion(multiple)]
    mocks.invoke.mockImplementation(async (method, payload) => {
      if (method !== 'grow:submitAnswer') return treeState(nodes)
      if (shouldFail) return { ok: false, error: 'invalid_selection' }
      nodes = [savedQuestion(multiple, payload.selectedOptions)]
      return { ok: true, node: nodes[0] }
    })
    mocks.send.mockResolvedValue(true)
    render(<GrowRoundCards rounds={[{ ...round, questions: [multiple] }]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '应届生' }))
    fireEvent.click(screen.getByRole('button', { name: '开始制定方案' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('选项有变化')
    expect(screen.getByRole('checkbox', { name: '应届生' })).toBeChecked()
    expect(mocks.send).not.toHaveBeenCalled()
    shouldFail = false
    fireEvent.click(screen.getByRole('button', { name: '开始制定方案' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(screen.getByText('已保存 · 应届生')).toBeInTheDocument()
  })

  it('在题目内保存多行自定义回复', async () => {
    const answer = '应届生\n也考虑刚工作的人'
    const node: GrowNodeView = { id: question.id, question: question.q, status: 'answered', answer }
    mocks.invoke.mockImplementation(async (method) => method === 'grow:submitAnswer'
      ? { ok: true, node } : treeState([]))
    render(<GrowRoundCards rounds={[round]} />)
    fireEvent.click(screen.getByRole('button', { name: '其他 / 自定义回复' }))
    const input = screen.getByRole('textbox', { name: '自定义回复' })
    const save = screen.getByRole('button', { name: '保存回复' })
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: '应届生\n也考虑刚工作的人' } })
    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '自定义回复' })).not.toBeInTheDocument())
    expect(mocks.invoke).toHaveBeenCalledWith('grow:submitAnswer', {
      workspaceId: workspace, sessionId: session, nodeId: question.id, action: 'answer', text: '应届生\n也考虑刚工作的人',
    })
  })

  it('选择题按题型限制选择，并在重新打开后显示已保存的答案', async () => {
    let nodes = [savedQuestion(multiple), savedQuestion(single)]
    mocks.invoke.mockImplementation(async (method, payload) => {
      if (method !== 'grow:submitAnswer') return treeState(nodes)
      const node = savedQuestion(payload.nodeId === single.id ? single : multiple, payload.selectedOptions)
      nodes = nodes.map((item) => item.id === node.id ? node : item)
      return { ok: true, node }
    })
    mocks.send.mockResolvedValue(true)
    const cards = <GrowRoundCards rounds={[{ ...round, questions: [multiple, single] }]} />
    const { unmount } = render(cards)
    expect(screen.queryByRole('button', { name: '保存所选' })).not.toBeInTheDocument()
    for (const name of ['其他 / 自定义回复', '稍后答', '没看懂']) {
      expect(screen.getAllByRole('button', { name })).toHaveLength(2)
    }
    fireEvent.click(screen.getByRole('checkbox', { name: '应届生' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '在职人群' }))

    const one = screen.getByRole('radio', { name: '一个' })
    const three = screen.getByRole('radio', { name: '三个' })
    fireEvent.click(one)
    fireEvent.click(three)
    expect(one).not.toBeChecked()
    expect(three).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '开始制定方案' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(screen.getByText('已保存 · 应届生、在职人群')).toBeInTheDocument()
    expect(screen.getByText('已保存 · 三个')).toBeInTheDocument()
    expect(mocks.invoke).toHaveBeenCalledWith('grow:submitAnswer', {
      workspaceId: workspace, sessionId: session, nodeId: multiple.id, action: 'select', selectedOptions: ['应届生', '在职人群'],
      publishedFormat: { kind: multiple.kind, options: multiple.options },
    })
    expect(mocks.invoke).toHaveBeenCalledWith('grow:submitAnswer', {
      workspaceId: workspace, sessionId: session, nodeId: single.id, action: 'select', selectedOptions: ['三个'],
      publishedFormat: { kind: single.kind, options: single.options },
    })

    unmount()
    render(cards)
    expect(await screen.findByText('已保存 · 应届生、在职人群')).toBeInTheDocument()
    expect(screen.getByText('已保存 · 三个')).toBeInTheDocument()
  })

  it('保留其他轮的未提交选择，制定方案前一并保存', async () => {
    let nodes = [savedQuestion(multiple), savedQuestion(single)]
    mocks.invoke.mockImplementation(async (method, payload) => {
      if (method !== 'grow:submitAnswer') return treeState(nodes)
      const node = savedQuestion(payload.nodeId === single.id ? single : multiple, payload.selectedOptions)
      nodes = nodes.map((item) => item.id === node.id ? node : item)
      return { ok: true, node }
    })
    mocks.send.mockResolvedValue(true)
    const first = render(<GrowRoundCards rounds={[{ ...round, questions: [multiple] }]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '应届生' }))
    first.unmount()
    render(<GrowRoundCards rounds={[{ ...round, round: 2, questions: [single] }]} />)
    fireEvent.click(screen.getByRole('radio', { name: '三个' }))
    fireEvent.click(screen.getByRole('button', { name: '开始制定方案' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(nodes.map((node) => node.answer)).toEqual(['应届生', '三个'])
  })

  it('文件漏写题型时，两处仍显示聊天卡片已发布的选项', async () => {
    const questions = [multiple, single]
    const published = { ...round, questions }
    useUIStore.setState(({ timelineItems }) => ({ timelineItems: [...timelineItems, {
      id: 'round', type: 'assistant-message', timestamp: 2,
      text: '```grow-round\n' + JSON.stringify(published) + '\n```',
    }] }))
    const nodes = questions.map((question) => ({ ...savedQuestion(question), kind: undefined }))
    mocks.invoke.mockResolvedValue(treeState(nodes))
    const { container } = render(<><GrowRoundCards rounds={[published]} /><GrowPanel /></>)
    await waitFor(() => expect(container.querySelector('[data-node-id="q1"].tree-node')).toHaveAttribute('aria-label', expect.stringContaining('覆盖哪些人群')))
    expect(container.querySelector('[data-node-id="q2"].tree-node')).toHaveAttribute('aria-label', expect.stringContaining('展示几个结果'))
    expect(screen.getByRole('checkbox', { name: '应届生' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '三个' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '让 AI 补齐选项' })).not.toBeInTheDocument()
  })

  it('章节顺序不同时按实际树枝编号，并可定位方案文件', async () => {
    const nodes: GrowNodeView[] = [
      { id: 'a', question: '主题甲', status: 'answered', depends_on: [], chapter_id: 'ca' },
      { id: 'b', question: '主题乙', status: 'answered', depends_on: [], chapter_id: 'cb' },
    ]
    mocks.invoke.mockResolvedValue({ ok: true, state: { ...EMPTY_GROW_STATE, ready: true, nodes,
      chapters: [{ id: 'cb', title: '乙章节', ready: true }, { id: 'ca', title: '甲章节', ready: true }],
      docFile: 'C:/project/.文档/grow-me/g-current/方案.html' } })
    render(<GrowPanel />)
    expect(await screen.findByRole('button', { name: /2 · 乙章节/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 · 甲章节/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }))
    expect(useUIStore.getState().workspaceFileToOpen).toEqual({ workspaceRoot: workspace, rel: '.文档/grow-me/g-current/方案.html' })
    expect(useUIStore.getState().activePanel).toBe('files')
  })

  it('开放题直接显示输入框', () => {
    mocks.invoke.mockResolvedValue(treeState([]))
    render(<GrowRoundCards rounds={[{ ...round, questions: [{ ...question, kind: 'text' }] }]} />)
    expect(screen.getByRole('textbox', { name: '你的回复' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存所选' })).not.toBeInTheDocument()
  })

  it('旧题卡发送补齐请求，AI 完成后原卡片显示选项', async () => {
    let nodes: GrowNodeView[] = [{ id: question.id, question: question.q, status: 'pending' }]
    mocks.invoke.mockImplementation(async () => treeState(nodes))
    mocks.send.mockResolvedValue(true)
    render(<GrowRoundCards rounds={[round]} />)
    fireEvent.click(screen.getByRole('button', { name: '让 AI 补齐选项' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(JSON.stringify([{ id: question.id, question: question.q }]))))
    act(() => useUIStore.setState({ sessionRuntimeRunning: { [sessionFile]: true } }))
    nodes = [savedQuestion(multiple)]
    act(() => useUIStore.setState({ sessionRuntimeRunning: { [sessionFile]: false } }))
    expect(await screen.findByRole('checkbox', { name: '应届生' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '让 AI 补齐选项' })).not.toBeInTheDocument()
  })

  it('只读当前对话，AI 完成后刷新题目和方案', async () => {
    let written = false
    mocks.invoke.mockImplementation(async () => ({ ok: true, state: {
      ready: true, currentRound: 1, reviewCount: 0,
      pendingCount: written ? 1 : 0,
      nodes: written ? [{ id: question.id, question: question.q, status: 'pending', round: 1 }] : [],
      chapters: written ? [{ id: 'ch1', title: '城市推荐问卷', ready: true }] : [],
      docFile: written ? 'C:/project/.文档/grow-me/g-current/方案.html' : null,
    } }))
    render(<GrowPanel />)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('grow:getState', { workspaceId: workspace, sessionId: session }))
    expect(screen.queryByText(question.q)).not.toBeInTheDocument()

    act(() => useUIStore.setState({ sessionRuntimeRunning: { [sessionFile]: true } }))
    written = true
    act(() => useUIStore.setState({ sessionRuntimeRunning: { [sessionFile]: false } }))
    expect(await screen.findByText(question.q)).toBeInTheDocument()
    expect(screen.getByText(/共 1 个问题/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🍎 城市推荐问卷' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开方案' })).toBeInTheDocument()
    expect(mocks.invoke.mock.calls.filter(([method]) => method === 'grow:getState').every(([, payload]) => payload.sessionId === session)).toBe(true)

    act(() => useUIStore.setState({ timelineItems: [], historySessionFile: 'C:/sessions/unrelated.jsonl' }))
    expect(screen.queryByText(question.q)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开方案' })).not.toBeInTheDocument()
  })
})
