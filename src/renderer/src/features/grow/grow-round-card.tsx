import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { GrowNodeView, GrowSubmitAnswerRequest } from '@shared/ipc-contract'
import { resolveGrowQuestionFormat } from '@shared/grow-question'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { sendComposerPrompt } from '@renderer/lib/send-composer-prompt'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import { useUIStore } from '@renderer/stores/ui-store'
import { notifyGrowChanged, type GrowRound } from './grow-round'
import { growDraftPrefix, isCurrentGrowTarget, trackGrowDraft } from './use-grow-target'

const pendingRequests = new Set<string>()
const primaryButton = 'rounded-md bg-green-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50'
const secondaryButton = 'rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50'

export function GrowRoundCards({ rounds }: { rounds: GrowRound[] }) {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const sessionFile = useUIStore((s) => s.historySessionFile)
  if (!workspace || !rounds.length) return null
  return (
    <div className="mt-2 flex flex-col gap-2">
      {rounds.map((round, index) => (
        <GrowRoundCard key={JSON.stringify([workspace, sessionFile, round.session, round.round, index])} round={round} workspaceId={workspace} sessionFile={sessionFile} />
      ))}
    </div>
  )
}

type Answer = Pick<GrowSubmitAnswerRequest, 'action' | 'text' | 'selectedOptions' | 'publishedFormat'>
type RoundRequest = 'plan' | 'format'

function GrowRoundCard({ round, workspaceId, sessionFile }: { round: GrowRound; workspaceId: string; sessionFile: string | null }) {
  const groupId = useId()
  const draftPrefix = growDraftPrefix(workspaceId, sessionFile, round.session)
  const stashDraft = (nodeId: string, answer: Answer | null) => {
    const key = draftPrefix + encodeURIComponent(nodeId)
    trackGrowDraft(key, !!answer)
    try {
      if (answer) localStorage.setItem(key, JSON.stringify(answer))
      else localStorage.removeItem(key)
    } catch { /* The current screen still retains its in-memory draft. */ }
  }
  const [saved, setSaved] = useState<Record<string, GrowNodeView>>({})
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [openInput, setOpenInput] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null)
  const [requesting, setRequesting] = useState<RoundRequest | null>(null)
  const actionInFlight = useRef(false)
  const running = useUIStore(composerTurnActive)
  const questionsToRepair = round.questions.filter((question) => {
    const node = saved[question.id]
    return !resolveGrowQuestionFormat(node, question).kind && !(node?.status === 'answered' && node.answer?.trim())
  })

  useEffect(() => {
    try {
      for (const question of round.questions) {
        const raw = localStorage.getItem(draftPrefix + encodeURIComponent(question.id))
        if (!raw) continue
        const answer = JSON.parse(raw) as Answer
        setEditing((current) => ({ ...current, [question.id]: true }))
        if (answer.action === 'select' && Array.isArray(answer.selectedOptions)) setSelections((current) => ({ ...current, [question.id]: answer.selectedOptions! }))
        if (answer.action === 'answer' && typeof answer.text === 'string') {
          setDrafts((current) => ({ ...current, [question.id]: answer.text! }))
          if (question.kind !== 'text') setOpenInput(question.id)
        }
      }
    } catch { /* Ignore malformed or unavailable saved drafts. */ }
  }, [draftPrefix, round.questions])

  useEffect(() => {
    if (running) return
    let revision = 0
    const load = async () => {
      const request = ++revision
      const result = await ipcClient.invoke('grow:getState', { workspaceId, sessionId: round.session }).catch(() => null)
      if (request !== revision) return
      if (!result?.ok || !result.state) {
        setFailed({ id: '', message: '题卡状态读取失败，请刷新后重试。' })
        return
      }
      setFailed((current) => current?.id === '' ? null : current)
      setSaved(Object.fromEntries(result.state.nodes.map((node: GrowNodeView) => [node.id, node])))
    }
    void load()
    window.addEventListener('grow:state-changed', load)
    return () => {
      revision++
      window.removeEventListener('grow:state-changed', load)
    }
  }, [workspaceId, round.session, running])

  const sendRoundRequest = async (request: RoundRequest) => {
    const store = useUIStore.getState()
    const sessionFile = store.historySessionFile
    if (!sessionFile || store.currentWorkspace !== workspaceId) {
      toast.error('请在当前需求树的对话中操作。')
      return
    }
    if (actionInFlight.current || pendingRequests.has(sessionFile) || composerTurnActive(store)) return
    actionInFlight.current = true
    pendingRequests.add(sessionFile)
    setRequesting(request)
    const tree = `.文档/grow-me/${round.session}/tree.json`
    const roundQuestions = questionsToRepair.map(({ id, q, why }) => ({ id, question: q, rationale: why }))
    const prompt = request === 'plan'
      ? `开始制定方案。请调用 grow_tree 工具 begin_plan，sessionId 为 ${round.session}；再调用 get_state 获取最新需求树，根据需求树与 begin_plan 返回的 revision，按访谈约定在 .文档/grow-me/${round.session}/ 生成方案.html 和 task.manifest.json，没填实际答案的事项标为待确认。完成后调用 grow_tree finish_plan，expectedRevision 使用 begin_plan 返回的 revision；如版本冲突，重新读取并更新方案。不要直接修改 tree.json。`
      : `请为第 ${round.round} 轮补齐题型和选项。使用 grow_tree get_state 读取 ${tree}，按下面题卡的原题意设置 kind。只选一个用 single，可同时选多个用 multiple，各提供 2–8 个具体且不重复的 options 字符串。开放题用 text，不写 options。用 grow_tree put_questions 提交，传 sessionId、round、expectedRevision 和 questions；保留已答内容、题目 ID、当前轮次和方案文件，不要直接修改 tree.json。原卡片会自动更新，保存后回一句即可。\n原题：${JSON.stringify(roundQuestions)}`
    try {
      if (!(await isCurrentGrowTarget(workspaceId, round.session)) || composerTurnActive(useUIStore.getState())) {
        toast.error('当前需求树已切换，请在对应需求树中操作。')
        return
      }
      if (request === 'plan') {
        setFailed(null)
        if (!(await savePendingAnswers())) return
        const current = useUIStore.getState()
        if (current.historySessionFile !== sessionFile || current.currentWorkspace !== workspaceId ||
            !(await isCurrentGrowTarget(workspaceId, round.session)) || composerTurnActive(current)) {
          toast.error('已保存答案，请回到这轮问卷再开始制定方案。')
          return
        }
      }
      if (!(await sendComposerPrompt(prompt))) throw new Error('The clarification request was not sent')
      toast.success(request === 'plan' ? '已开始制定方案' : '已请 AI 补齐题型和选项')
    } catch {
      toast.error('请求发送失败，请重试。')
    } finally {
      actionInFlight.current = false
      pendingRequests.delete(sessionFile)
      setRequesting(null)
    }
  }

  const saveAnswer = async (nodeId: string, answer: Answer): Promise<boolean> => {
    try {
      const result = await ipcClient.invoke('grow:submitAnswer', { workspaceId, sessionId: round.session, nodeId, ...answer })
      if (!result?.ok || !result.node) {
        setFailed({ id: nodeId, message: result?.error === 'invalid_selection' ? '选项有变化，请按最新题卡重新选择。' : '回复保存失败，请重试。' })
        if (result?.error === 'invalid_selection') notifyGrowChanged()
        return false
      }
      const node: GrowNodeView = result.node
      stashDraft(nodeId, null)
      setSaved((current) => ({ ...current, [nodeId]: node }))
      setDrafts((current) => ({ ...current, [nodeId]: '' }))
      setSelections((current) => ({ ...current, [nodeId]: [] }))
      setOpenInput((current) => current === nodeId ? null : current)
      setEditing((current) => ({ ...current, [nodeId]: false }))
      return true
    } catch {
      setFailed({ id: nodeId, message: '回复保存失败，请重试。' })
      return false
    }
  }

  const savePendingAnswers = async (): Promise<boolean> => {
    let savedAny = false
    try {
      const pending: Array<{ id: string; answer: Answer }> = []
      try {
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index)
          if (!key?.startsWith(draftPrefix)) continue
          const value = localStorage.getItem(key)
          if (value) pending.push({ id: decodeURIComponent(key.slice(draftPrefix.length)), answer: JSON.parse(value) as Answer })
        }
      } catch { /* Fall back to the current card's in-memory values. */ }
      for (const { id, answer } of pending) {
        if (!(await saveAnswer(id, answer))) { toast.error('有答案保存失败，请检查题卡后重试。'); return false }
        savedAny = true
      }
      for (const question of round.questions) {
        const { id } = question
        if (pending.some((item) => item.id === id)) continue
        if (saved[id]?.status === 'answered' && saved[id].answer?.trim() && !editing[id]) continue
        const text = drafts[id]?.trim()
        const selectedOptions = selections[id]
        const publishedFormat = (question.kind === 'single' || question.kind === 'multiple') && question.options
          ? { kind: question.kind, options: question.options } : undefined
        const answer: Answer | undefined = text ? { action: 'answer', text }
          : selectedOptions?.length ? { action: 'select', selectedOptions, ...(publishedFormat && { publishedFormat }) } : undefined
        if (!answer) continue
        if (!(await saveAnswer(id, answer))) {
          toast.error('有答案保存失败，请检查题卡后重试。')
          return false
        }
        savedAny = true
      }
      return true
    } finally {
      if (savedAny) notifyGrowChanged()
    }
  }

  const submit = async (nodeId: string, answer: Answer) => {
    if (actionInFlight.current || composerTurnActive(useUIStore.getState())) return
    actionInFlight.current = true
    setBusy(nodeId)
    setFailed(null)
    try {
      if (!(await isCurrentGrowTarget(workspaceId, round.session)) || composerTurnActive(useUIStore.getState())) {
        setFailed({ id: nodeId, message: '当前需求树已切换，请切回原需求树后操作。' })
        return
      }
      if (await saveAnswer(nodeId, answer)) notifyGrowChanged()
    } catch {
      setFailed({ id: nodeId, message: '需求树绑定读取失败，请重试。' })
    } finally {
      actionInFlight.current = false
      setBusy(null)
    }
  }

  const disabled = busy !== null || requesting !== null || running

  return (
    <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 text-[12px]">
        <span className="font-medium text-green-700 dark:text-green-400">第 {round.round} 轮 · 需求澄清</span>
        {questionsToRepair.length > 0 && (
          <button disabled={disabled} onClick={() => void sendRoundRequest('format')} className={secondaryButton}>
            {requesting === 'format' ? '正在发送…' : '让 AI 补齐选项'}
          </button>
        )}
      </div>
      {failed?.id === '' && <p role="alert" className="text-[12px] text-red-600">{failed.message}</p>}
      <div className="flex flex-col gap-2">
        {round.questions.map((question, index) => {
          const { id } = question
          const node = saved[id]
          const changedQuestion = !!node?.question && node.question !== question.q
          const format = resolveGrowQuestionFormat(node, changedQuestion ? {} : question)
          const options = format.options ?? []
          const choiceKind = format.kind === 'single' || format.kind === 'multiple' ? format.kind : undefined
          const selected = options.filter((option) => selections[id]?.includes(option))
          const isAnswered = node?.status === 'answered' && !!node.answer?.trim() && !editing[id]
          const draft = drafts[id] ?? ''
          const writing = format.kind === 'text' || openInput === id
          const questionLabel = `${groupId}-${index}`
          return (
            <div key={id} id={`grow-q-${round.session}-${id}`} className="scroll-mt-24 rounded-lg border bg-card p-2">
              <div id={questionLabel} className="text-[13px] leading-6">
                <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>{node?.question || question.q}
              </div>
              {!changedQuestion && question.why && <div className="text-[12px] text-muted-foreground">{question.why}</div>}
              {isAnswered ? (
                <div className="mt-1.5 flex items-start justify-between gap-2"><p className="whitespace-pre-wrap break-words text-[12px] text-green-700 dark:text-green-400">已保存 · {node.answer}</p><button type="button" disabled={disabled} className={secondaryButton} onClick={() => {
                  setEditing((current) => ({ ...current, [id]: true }))
                  setSelections((current) => ({ ...current, [id]: node.selectedOptions ?? [] }))
                  setDrafts((current) => ({ ...current, [id]: node.selectedOptions?.length ? '' : node.answer ?? '' }))
                  if (!node.selectedOptions?.length && format.kind !== 'text') setOpenInput(id)
                }}>修改</button></div>
              ) : (
                <>
                  {options.length > 0 && !choiceKind && (
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
                      {options.map((option) => <li key={option}>{option}</li>)}
                    </ul>
                  )}
                  {options.length > 0 && choiceKind && (
                    <fieldset disabled={disabled} aria-labelledby={questionLabel} className="mt-1.5 min-w-0">
                      <p className="mb-1 text-[12px] text-muted-foreground">{format.kind === 'multiple' ? '多选，可选多项' : '单选，只选一项'}</p>
                      <div className="grid gap-1">
                        {options.map((option) => (
                          <label key={option} className={cn('flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5 text-[12px]',
                            selected.includes(option) && 'border-green-500/50 bg-green-500/10')}>
                            <input
                              name={questionLabel}
                              type={format.kind === 'multiple' ? 'checkbox' : 'radio'}
                              checked={selected.includes(option)}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked
                                const next = format.kind === 'single' ? [option] : selected.filter((value) => value !== option)
                                if (format.kind === 'multiple' && checked) next.push(option)
                                setSelections((current) => ({ ...current, [id]: next }))
                                stashDraft(id, next.length ? { action: 'select', selectedOptions: next, publishedFormat: { kind: choiceKind, options } } : null)
                                setDrafts((current) => ({ ...current, [id]: '' }))
                                setOpenInput((current) => current === id ? null : current)
                              }}
                              className="mt-0.5 shrink-0 accent-green-600"
                            />
                            <span className="min-w-0 break-words">{option}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {format.kind !== 'text' && (
                      <button disabled={disabled} aria-expanded={writing} onClick={() => setOpenInput(writing ? null : id)} className="rounded-md border px-2.5 py-1 text-[12px] hover:bg-muted disabled:opacity-50">
                        其他 / 自定义回复
                      </button>
                    )}
                    <button disabled={disabled} onClick={() => void submit(id, { action: 'defer' })} className={secondaryButton}>稍后答</button>
                    <button disabled={disabled} onClick={() => void submit(id, { action: 'unclear' })} className={secondaryButton}>没看懂</button>
                    <span role="status" className="text-[12px] text-muted-foreground">
                      {busy === id ? '正在保存…' : node?.status === 'deferred' ? '已标记稍后答' : node?.status === 'needs_review' ? '待重新确认或解释' : ''}
                    </span>
                  </div>
                  {writing && (
                    <div className="mt-1.5 flex gap-1.5">
                      <textarea
                        autoFocus={openInput === id}
                        aria-label={format.kind === 'text' ? '你的回复' : '自定义回复'}
                        rows={2}
                        maxLength={2000}
                        disabled={disabled}
                        value={draft}
                        onChange={(event) => {
                          const text = event.target.value
                          setDrafts((current) => ({ ...current, [id]: text }))
                          stashDraft(id, text.trim() ? { action: 'answer', text: text.trim() } : null)
                          if (text.trim()) setSelections((current) => ({ ...current, [id]: [] }))
                        }}
                        placeholder="写下你自己的答案"
                        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-[12px] outline-none focus:border-green-500"
                      />
                      <button disabled={disabled || !draft.trim()} onClick={() => void submit(id, { action: 'answer', text: draft.trim() })} className={cn('self-start', primaryButton)}>
                        保存回复
                      </button>
                    </div>
                  )}
                  {editing[id] && <div className="mt-2 flex gap-2"><button type="button" disabled={disabled} className={secondaryButton} onClick={() => { stashDraft(id, null); setSelections((current) => ({ ...current, [id]: [] })); setDrafts((current) => ({ ...current, [id]: '' })); setEditing((current) => ({ ...current, [id]: false })); setOpenInput(null) }}>取消修改</button>{choiceKind && selected.length > 0 && <button type="button" disabled={disabled} className={primaryButton} onClick={() => void submit(id, { action: 'select', selectedOptions: selected, ...(choiceKind && options.length ? { publishedFormat: { kind: choiceKind, options } } : {}) })}>保存修改</button>}</div>}
                  {failed?.id === id && <p role="alert" className="mt-1 text-[12px] text-red-600 dark:text-red-400">{failed.message}</p>}
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-green-500/20 pt-2.5">
        <p className="text-[12px] text-muted-foreground">已选和已填写的答案会一起保存，空题留待确认。</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void sendRoundRequest('plan')}
          className={primaryButton}
        >
          {requesting === 'plan' ? '正在提交…' : '开始制定方案'}
        </button>
      </div>
    </div>
  )
}
