import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveGrowQuestionFormat } from '@shared/grow-question'
import { useTranslation } from 'react-i18next'
import { Sprout, RefreshCw, FileText, ArrowRight } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import { openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'
import { useUIStore } from '@renderer/stores/ui-store'
import { GrowMiniTree, layoutGrowTree } from './grow-mini-tree'
import { GrowPlanReader } from './grow-plan-reader'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { extractGrowRounds, findGrowSessionId, type GrowRoundQuestion } from './grow-round'
import { EMPTY_GROW_STATE } from './grow-types'
import { GrowTreeSelector } from './grow-tree-selector'
import { growDraftPrefix, hasGrowMemoryDraft, isCurrentGrowTarget, useGrowTarget } from './use-grow-target'
import { sendComposerPrompt } from '@renderer/lib/send-composer-prompt'

/**
 * 右侧需求树面板：只看图 + 跳转 + 果子，不在这里答题。
 * 答题统一在中间聊天卡片里做，避免窄栏拥挤。
 */
export function GrowPanel() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const fallback = useUIStore((s) => findGrowSessionId(s.timelineItems))
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const target = useGrowTarget(workspace, sessionFile, fallback)
  const sessionId = target.id
  const viewSessionKey = useUIStore((s) => s.viewSessionKey)
  return (
    <GrowPanelSession
      key={JSON.stringify([workspace, viewSessionKey, sessionId])}
      workspace={workspace}
      sessionId={sessionId}
      sessionFile={sessionFile}
      bindingError={target.error}
      bindingLoading={target.loading}
      onRetryBinding={target.refresh}
    />
  )
}

function GrowPanelSession({ workspace, sessionId, sessionFile, bindingError, bindingLoading, onRetryBinding }: { workspace: string | null; sessionId?: string; sessionFile: string | null; bindingError: boolean; bindingLoading: boolean; onRetryBinding: () => Promise<void> }) {
  const [trees, setTrees] = useState<Array<{ sessionId: string; requirement: string; pendingCount: number; reviewCount: number }>>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [switching, setSwitching] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const loadTrees = useCallback(async () => {
    if (!workspace) return
    setListLoading(true); setListError('')
    try {
      const result = await ipcClient.invoke('grow:listSessions', { workspaceId: workspace })
      if (!result?.ok || !Array.isArray(result.trees)) throw new Error('list')
      setTrees(result.trees)
      if (result.unreadable) setListError(`有 ${result.unreadable} 棵需求树读取失败，请检查文件。`)
    } catch { setListError('需求树列表读取失败，请刷新重试。') }
    finally { setListLoading(false) }
  }, [workspace])
  useEffect(() => { void loadTrees() }, [loadTrees])
  const selectTree = async (id: string) => {
    if (!workspace || !sessionFile || id === sessionId || lock.current) return
    if (composerTurnActive(useUIStore.getState())) { setNotice('当前对话正在运行，请等待结束后切换。'); return }
    try {
      const prefix = growDraftPrefix(workspace, sessionFile, sessionId ?? '')
      if (sessionId && (hasGrowMemoryDraft(prefix) || Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).some((key) => key?.startsWith(prefix)))) {
        setNotice('当前需求树有未保存的题卡草稿，请先保存或取消修改。'); return
      }
    } catch { setNotice('草稿状态读取失败，请稍后重试。'); return }
    lock.current = true; setSwitching(true); setNotice('')
    try {
      const result = await ipcClient.invoke('grow:listSessions', { workspaceId: workspace, action: 'setBinding', sessionFile, sessionId: id })
      if (!result?.ok) throw new Error('binding')
      window.dispatchEvent(new CustomEvent('grow:binding-changed'))
      setNotice('已绑定需求树。可点击续接按钮发送消息。')
    } catch { setNotice('绑定失败，请确认会话已保存且属于当前项目，然后重试。') }
    finally { lock.current = false; setSwitching(false) }
  }
  const continueTree = async () => {
    if (!workspace || !sessionId || lock.current || composerTurnActive(useUIStore.getState())) return
    lock.current = true; setContinuing(true)
    try {
      if (!(await isCurrentGrowTarget(workspace, sessionId)) || composerTurnActive(useUIStore.getState())) throw new Error('changed')
      if (!(await sendComposerPrompt(`请继续澄清需求树 ${sessionId}。先用 grow_tree get_state 读取最新状态，再按已有需求和待答问题继续访谈。`))) throw new Error('send')
      setNotice('续接消息已发送。')
    } catch { setNotice('续接消息发送失败，请确认当前会话和需求树后重试。') }
    finally { lock.current = false; setContinuing(false) }
  }
  const { t } = useTranslation()
  const running = useUIStore(composerTurnActive)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const timelineItems = useUIStore((s) => s.timelineItems)
  const publishedQuestions = useMemo(() => {
    const questions = new Map<string, GrowRoundQuestion>()
    if (!sessionId) return questions
    for (const { type, text } of timelineItems) {
      if (type !== 'assistant-message' || !text?.includes('```grow-round')) continue
      for (const round of extractGrowRounds(text).rounds) {
        if (round.session !== sessionId) continue
        for (const question of round.questions) questions.set(question.id, question)
      }
    }
    return questions
  }, [sessionId, timelineItems])
  const [state, setState] = useState(EMPTY_GROW_STATE)
  const nodes = useMemo(() => state.nodes.map((node) => {
    const published = publishedQuestions.get(node.id)
    return published ? { ...node, ...resolveGrowQuestionFormat(node, published), question: node.question || published.q } : node
  }), [publishedQuestions, state.nodes])
  const chapterNumbers = useMemo(() => {
    const numbers = new Map<string, number>()
    const roots = layoutGrowTree(nodes).filter((row) => row.parentIndex === null)
    roots.forEach(({ node }, index) => {
      if (node.chapter_id && !numbers.has(node.chapter_id)) numbers.set(node.chapter_id, index + 1)
    })
    return numbers
  }, [nodes])
  const [loading, setLoading] = useState(false)
  const [converting, setConverting] = useState(false)
  const [confirmConvert, setConfirmConvert] = useState(false)
  const [convertResult, setConvertResult] = useState<{ ids: string[]; error?: string } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reader, setReader] = useState<{ path: string; chapter: { id: string; serial: number } | null } | null>(null)
  const chapterSerial = useRef(0)
  const seqRef = useRef(0)

  const fetchState = useCallback(async () => {
    if (!workspace || !sessionId) return
    const seq = ++seqRef.current
    setLoading(true)
    setLoadFailed(false)
    try {
      const res = await ipcClient.invoke('grow:getState', { workspaceId: workspace, sessionId })
      if (seq !== seqRef.current) return
      if (res?.ok && res.state) setState(res.state)
      else setLoadFailed(true)
    } catch {
      if (seq === seqRef.current) setLoadFailed(true)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [workspace, sessionId])

  // AI 直接写文件，聊天结束时需要重新读取。
  useEffect(() => {
    void fetchState()
    return () => { seqRef.current++ }
  }, [fetchState, running])

  useEffect(() => {
    window.addEventListener('grow:state-changed', fetchState)
    return () => window.removeEventListener('grow:state-changed', fetchState)
  }, [fetchState])

  const convertToTeam = useCallback(async () => {
    if (!workspace || !sessionId || converting) return
    setConverting(true)
    setConvertResult(null)
    try {
      const res = await ipcClient.invoke('grow:convertToTeam', { workspaceId: workspace, sessionId })
      if (res?.ok && Array.isArray(res.created)) {
        setConvertResult({ ids: (res.created as Array<{ id: string }>).map((c) => c.id) })
      } else {
        setConvertResult({ ids: [], error: res?.error === 'no_chapters' ? '还没有可转移的方案，请先在问卷底部点「开始制定方案」。' : res?.error === 'plan_stale' ? '回答已变化，请先复核问题并更新方案。' : '转过去失败，稍后再试。已成功创建的任务不会重复创建。' })
      }
    } catch {
      setConvertResult({ ids: [], error: '转过去失败，稍后再试。' })
    } finally {
      setConverting(false)
    }
  }, [workspace, sessionId, converting])

  const openPlanFile = useCallback(() => {
    if (state.docFile && openWorkspaceRelativePath(state.docFile)) setReader(null)
    else setLoadFailed(true)
  }, [state.docFile])

  const openPlan = useCallback((chapterId?: string) => {
    if (!state.docFile) return
    setReader({ path: state.docFile, chapter: chapterId ? { id: chapterId, serial: ++chapterSerial.current } : null })
  }, [state.docFile])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <Sprout className="h-4 w-4 text-green-600" />
          {t('common:panel.grow', '需求树')}
        </div>
        <button
          onClick={fetchState}
          disabled={!sessionId || loading}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          刷新
        </button>
      </div>

      {!workspace ? (
        <div className="rounded-lg border border-dashed p-4 text-[12px] text-muted-foreground">
          先在左边打开一个项目文件夹，树会存在该项目的 .文档/grow-me/ 里。
        </div>
      ) : (
        <>
          <GrowTreeSelector trees={trees} selectedId={sessionId} loading={listLoading} disabled={!sessionFile || running || switching || bindingLoading} onSelect={(id) => void selectTree(id)} onRefresh={() => void loadTrees()} />
          {!sessionFile && <p role="status" className="text-[12px] text-muted-foreground">新对话尚未保存，请先发送一条消息，待会话创建后选择需求树。</p>}
          {bindingError && <p role="alert" className="text-[12px] text-red-600">需求树绑定读取失败。<button className="underline" onClick={() => void onRetryBinding()}>重试</button></p>}
          {listError && <p role="alert" className="text-[12px] text-red-600">{listError}</p>}
          {notice && <p role="status" className="text-[12px]">{notice}</p>}
          {sessionId && sessionFile && !bindingError && <button type="button" disabled={running || switching || continuing || bindingLoading} onClick={() => void continueTree()} className="rounded-md border px-2 py-1 text-[12px] disabled:opacity-50">{continuing ? '正在发送…' : '发送续接消息'}</button>}
          <div className="rounded-lg bg-muted/60 px-2.5 py-2 text-[12px] text-muted-foreground" aria-live="polite">
            {loadFailed ? '需求树读取失败，请点刷新重试。' : state.ready ? (
              <>共 {state.nodes.length} 个问题 · 第 {state.currentRound ?? 1} 轮 · 待答 {state.pendingCount} · 待复核 {state.reviewCount}</>
            ) : loading ? '正在读取需求树…' : sessionId ? (
              '当前对话的需求树还没准备好。'
            ) : '当前对话还没有需求树。输入 /澄清 加上你的需求即可开始。'}
          </div>

          {(state.planStale || state.reviewCount > 0) && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[12px] text-amber-700">回答需要复核或已发生变化，请确认相关问题并更新方案后再转任务。</div>}
          <div className="min-h-0 flex-1 overflow-auto">
            <GrowMiniTree nodes={nodes} requirement={state.requirement} chapters={state.chapters} onChapter={state.docFile ? openPlan : undefined} />
          </div>

          {reader && <GrowPlanReader workspace={workspace} path={reader.path} chapter={reader.chapter} onClose={() => setReader(null)} onOpenFile={openPlanFile} />}

          <div className="rounded-xl border p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium">
              <FileText className="h-3.5 w-3.5" />
              方案果子
              {state.docFile && <button type="button" onClick={openPlanFile} className="ml-auto text-muted-foreground underline hover:text-foreground">打开文件</button>}
              {state.docFile && (
                <button onClick={() => openPlan()} className="text-muted-foreground underline hover:text-foreground">
                  打开方案
                </button>
              )}
            </div>
            {state.chapters.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">
                {state.docFile ? '方案已生成。' : running ? '正在处理，请稍候；生成方案后会显示在这里。' : '方案生成后会显示在这里。'}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {state.chapters.map((c) => (
                    <button
                      key={c.id}
                      disabled={!c.ready || !state.docFile}
                      onClick={() => openPlan(c.id)}
                      className="flex min-w-0 items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-left text-[12px] hover:border-green-500/40 disabled:opacity-50"
                      title={c.title}
                    >
                      <span className="min-w-0 break-words">{c.ready ? '🍎' : '◌'} {chapterNumbers.has(c.id) ? `${chapterNumbers.get(c.id)} · ` : ''}{c.title}</span>
                      {c.ready && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setConfirmConvert(true)}
                  disabled={converting || !!state.planStale || state.reviewCount > 0}
                  className="mt-2 w-full rounded-lg bg-green-600 px-2 py-1.5 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {converting ? '正在搬运…' : '一键转到工作团队'}
                </button>
                {convertResult && (
                  <div className="text-[12px] leading-5">
                    {convertResult.error ? (
                      <span className="text-muted-foreground">{convertResult.error}</span>
                    ) : (
                      <>
                        <span className="text-green-700">{convertResult.ids.length ? `已转入 ${convertResult.ids.length} 个任务（${convertResult.ids.join('、')}）。` : '这些章节已经转过工作团队。'}</span>{' '}
                        <button onClick={() => setActivePanel('team')} className="text-green-700 underline">
                          去看板看看
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <ConfirmDialog open={confirmConvert} title="转到工作团队" message={`将以下章节转为任务：${state.chapters.map((chapter) => chapter.title).join('、')}。已转过的章节会跳过。`} confirmLabel="确认转入" onCancel={() => setConfirmConvert(false)} onConfirm={() => { setConfirmConvert(false); void convertToTeam() }} />
        </>
      )}
    </div>
  )
}
