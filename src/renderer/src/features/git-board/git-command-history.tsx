import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, RefreshCw, X } from '@renderer/components/icons'
import { toast } from 'sonner'

type Entry = { time: number; command: string; output: string; success: boolean }
const clearAnsi = (value: string) => value.replace(new RegExp('\\x1b\\[[0-?]*[ -/]*[@-~]', 'g'), '')

export function GitCommandHistory({ entries, onRefresh, onClear }: {
  entries: Entry[]
  onRefresh: () => Promise<void>
  onClear: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  const zh = i18n.language.startsWith('zh')
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try { await action() } catch { toast.error(zh ? '无法更新命令记录' : 'Could not update command history') }
    finally { setBusy(false) }
  }
  return <div className="git-command-history">
    <header className="git-command-toolbar">
      <div><strong>{t('common:gitBoard.log')}</strong><p>{zh ? '查看提交、推送等 Git 操作的结果' : 'Review the results of commits, pushes and other Git operations'}</p></div>
      <button type="button" className="workbench-icon" disabled={busy} aria-label={t('common:gitBoard.refresh')} title={t('common:gitBoard.refresh')} onClick={() => void run(onRefresh)}><RefreshCw size={14} /></button>
      <button type="button" className="workbench-button" disabled={busy || !entries.length} onClick={() => void run(onClear)}>{t('common:gitBoard.clearLog')}</button>
    </header>
    {entries.map((entry, index) => {
      const output = clearAnsi(entry.output)
      const date = new Date(entry.time * 1000)
      return <details key={`${entry.time}:${entry.command}:${index}`} className="git-command-card">
        <summary>
          <ChevronRight size={13} className="git-command-chevron" />
          <div className="min-w-0 flex-1"><code title={entry.command}>{entry.command}</code><time dateTime={date.toISOString()}>{date.toLocaleString(i18n.language)}</time></div>
          <span className="git-command-status" data-success={entry.success}>{entry.success ? <Check size={12} /> : <X size={12} />}{entry.success ? (zh ? '成功' : 'Success') : (zh ? '失败' : 'Failed')}</span>
        </summary>
        <div className="git-command-output"><pre>{output || t('common:gitBoard.noOutput')}</pre><button type="button" className="workbench-button" onClick={() => void navigator.clipboard.writeText(`${entry.command}\n${output}`).catch(() => toast.error(zh ? '无法复制输出' : 'Could not copy output'))}>{t('common:gitBoard.copyOutput')}</button></div>
      </details>
    })}
    {!entries.length && <p className="git-command-empty">{zh ? '暂无 Git 命令记录' : 'No Git commands recorded yet'}</p>}
  </div>
}
