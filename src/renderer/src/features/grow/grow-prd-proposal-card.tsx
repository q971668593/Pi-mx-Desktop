import { useEffect, useRef, useState } from 'react'
import type { GrowPrdProposal } from '@shared/grow-prd-proposal'
import type { GrowPrdProjectPreview } from '@shared/ipc-contract'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { GrowPrdReview } from './grow-prd-review'
import { resolveGrowTarget } from './use-grow-target'

export function GrowPrdProposalCard({ proposal }: { proposal: GrowPrdProposal }) {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const viewKey = useUIStore((s) => s.viewSessionKey)
  const [preview, setPreview] = useState<GrowPrdProjectPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [incomplete, setIncomplete] = useState<Array<{ operationId: string; state: string }>>([])
  const lock = useRef(false)
  const generation = useRef(0)
  const identity = workspace && sessionFile ? { workspaceId: workspace, sessionFile, treeSessionId: proposal.treeSessionId } : null

  useEffect(() => {
    generation.current++
    setPreview(null); setNotice(''); setIncomplete([])
    const invalidate = () => { generation.current++; setPreview(null); setNotice('需求树绑定已变化，请重新生成预览。'); setIncomplete([]) }
    window.addEventListener('grow:binding-changed', invalidate)
    return () => { generation.current++; window.removeEventListener('grow:binding-changed', invalidate) }
  }, [workspace, sessionFile, viewKey, proposal])

  const current = (seq: number) => {
    const state = useUIStore.getState()
    return generation.current === seq && state.currentWorkspace === workspace && state.historySessionFile === sessionFile && state.viewSessionKey === viewKey
  }
  const check = async (seq: number) => !!identity && current(seq) && await resolveGrowTarget(identity.workspaceId, identity.sessionFile) === identity.treeSessionId && current(seq)
  const run = async (action: 'preview' | 'confirm' | 'recover', operationId?: string) => {
    if (!identity || lock.current) return
    const seq = generation.current
    lock.current = true; setBusy(true); setNotice('')
    try {
      if (!(await check(seq))) { if (current(seq)) { setPreview(null); setNotice('当前聊天未绑定此候选对应的需求树。') }; return }
      const result = action === 'preview'
        ? await ipcClient.invoke('grow-prd:projectPreview', { ...identity, proposal })
        : action === 'confirm'
          ? await ipcClient.invoke('grow-prd:projectConfirm', { ...identity, previewId: preview?.previewId, confirmed: true })
          : await ipcClient.invoke('grow-prd:projectRecover', { ...identity, operationId, confirmed: true })
      if (!current(seq)) { if (result?.ok && action !== 'preview') window.dispatchEvent(new CustomEvent('grow:state-changed')); return }
      if (!result?.ok) {
        setPreview(null)
        setNotice(`操作未完成（${result?.error ?? '请求失败'}），请检查当前状态后重新预览。`)
        const list = await ipcClient.invoke('grow-prd:projectListIncomplete', identity)
        if (current(seq) && list?.ok) setIncomplete(list.data)
        return
      }
      if (action === 'preview') { setPreview(result.data); setIncomplete([]) }
      else { setPreview(null); setIncomplete([]); setNotice(action === 'confirm' ? 'PRD 和需求树已更新。' : '未完成的变更已恢复，请重新生成预览。'); window.dispatchEvent(new CustomEvent('grow:state-changed')) }
    } catch {
      if (current(seq)) { setPreview(null); setNotice('操作失败，请检查当前聊天和需求树后重试。') }
    } finally { lock.current = false; if (current(seq)) setBusy(false) }
  }

  return <section className="electron-no-drag mt-3 rounded-xl border p-3 text-sm" aria-label="PRD 变更候选">
    <p className="font-semibold">PRD 变更候选</p>
    {!preview && <button type="button" className="mt-2 rounded-md bg-muted px-3 py-1 disabled:opacity-50" disabled={busy || !identity} onClick={() => void run('preview')}>{busy ? '正在处理…' : '生成变更预览'}</button>}
    {notice && <p role="status" className="mt-2 break-words">{notice}</p>}
    {incomplete.map((item) => <div key={item.operationId} className="mt-2"><p>未完成的变更：{item.operationId}（{item.state}）</p><button type="button" disabled={busy || item.state === 'invalid'} onClick={() => { if (window.confirm('确认恢复这项未完成的 PRD 和需求树变更？')) void run('recover', item.operationId) }} className="underline disabled:opacity-50">确认恢复</button></div>)}
    {preview && <GrowPrdReview original={preview.candidate.comparison.prd.before} updated={preview.candidate.comparison.prd.after} reason={preview.candidate.reason} changes={preview.candidate.changes} busy={busy} onCancel={() => { generation.current++; setPreview(null); setNotice('已取消预览。') }} onConfirm={() => run('confirm')} />}
  </section>
}
