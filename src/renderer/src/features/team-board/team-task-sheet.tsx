import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Play,
  Copy,
  X,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { TEAM_STATUSES, type TeamRoleBinding, type TeamRun, type TeamStatus, type TeamTask } from '@shared/team-board'
import { isSessionRunning, latestRun, roleColor, roleFullAvatar, roleLabel, sessionFileName, shortModel, statusLabel, STATUS_COLORS } from './team-board-lib'

const BLOCK_TYPES = ['待用户确认', '缺环境/工具', '外部依赖', '执行失败'] as const

type StatusOptions = {
  reason?: string
  manualConfirmed?: boolean
  blockType?: string
}

export function TeamTaskSheet({
  task,
  binding,
  runs,
  runtimeRunning,
  busy,
  initialPending,
  onClose,
  onStatus,
  onDispatch,
  onCopyPrompt,
  onOpenRole,
  onOpenSession,
  onSettleRun,
}: {
  task: TeamTask
  binding: TeamRoleBinding | undefined
  runs: TeamRun[]
  runtimeRunning: Record<string, boolean> | null | undefined
  busy: boolean
  initialPending?: TeamStatus | null
  onClose: () => void
  onStatus: (to: TeamStatus, options?: StatusOptions) => Promise<boolean>
  onDispatch: () => void
  onCopyPrompt: () => void
  onOpenRole: () => void
  onOpenSession: (run: TeamRun) => void
  onSettleRun: (run: TeamRun) => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<TeamStatus | null>(initialPending ?? null)
  const [acceptedCheck, setAcceptedCheck] = useState(false)
  const [reason, setReason] = useState('')
  const [blockType, setBlockType] = useState<string>(BLOCK_TYPES[0])
  const [blockReason, setBlockReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPending(initialPending ?? null)
    setAcceptedCheck(false)
    setReason('')
    setBlockReason('')
  }, [initialPending, task.id])

  const run = latestRun(task, runs)
  const live = isSessionRunning(runtimeRunning, run?.sessionFile)
  const runActive = run?.status === 'starting' || run?.status === 'running'
  const role = task.role
  const accent = roleColor(role)
  const accepted = task.acceptance.filter((item) => item.done).length

  const choose = async (to: TeamStatus) => {
    if (to === task.status) return
    if (to === '已验收' || to === '阻塞') {
      setPending(to)
      return
    }
    setSaving(true)
    try {
      await onStatus(to)
    } finally {
      setSaving(false)
    }
  }

  const confirmPending = async () => {
    if (!pending) return
    if (pending === '已验收') {
      if (!acceptedCheck) return
      setSaving(true)
      try {
        if (await onStatus('已验收', { reason, manualConfirmed: true })) setPending(null)
      } finally {
        setSaving(false)
      }
      return
    }
    setSaving(true)
    try {
      if (await onStatus('阻塞', { blockType, reason: blockReason })) setPending(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="team-overlay" role="dialog" aria-modal="true" aria-label={`${task.id} ${task.title}`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2.5 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('team:back')}
          className="rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="team-card-id">{task.id}</span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLORS[task.status] }} />
        <span className="truncate text-xs font-medium" title={task.title}>
          {task.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('team:close')}
          className="ml-auto rounded p-1 text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="team-sheet-scroll team-scroll">
        <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 p-2">
          <span className="team-avatar" style={{ '--team-role': accent } as CSSProperties}>
            <img src={roleFullAvatar(role)} alt="" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{roleLabel(role, t)}</div>
            <div className="truncate text-2xs text-foreground-tertiary" title={binding?.model || ''}>
              {binding?.model ? shortModel(binding.model) : t('team:unbound')}
              {binding?.effort ? ` · ${binding.effort}` : ''}
              {binding && !binding.enabled ? ` · ${t('team:settingsDisabled')}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenRole}
            className="rounded px-1.5 py-1 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            {t('team:open')}
          </button>
        </div>

        <section className="mt-3">
          <div className="team-field-label">{t('team:status')}</div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {TEAM_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => void choose(status)}
                disabled={saving}
                data-active={status === task.status}
                className="team-status-button"
                style={{ '--status-color': STATUS_COLORS[status] } as CSSProperties}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLORS[status] }} />
                <span>{statusLabel(status, t)}</span>
                {status === task.status ? <Check className="ml-auto h-3 w-3" /> : null}
              </button>
            ))}
          </div>
        </section>

        {pending === '已验收' ? (
          <section className="mt-3 rounded-lg border border-emerald-500/35 bg-emerald-500/5 p-2.5">
            <div className="text-xs font-semibold">{t('team:confirmAccepted')}</div>
            <p className="mt-1 text-2xs leading-relaxed text-foreground-secondary">{t('team:confirmAcceptedHint')}</p>
            <label className="mt-2 flex cursor-pointer items-start gap-1.5 text-2xs text-foreground-secondary">
              <input
                type="checkbox"
                checked={acceptedCheck}
                onChange={(event) => setAcceptedCheck(event.target.checked)}
                className="mt-[2px] h-3 w-3"
              />
              <span>{t('team:confirmAcceptedCheck')}</span>
            </label>
            <label className="mt-2 block text-2xs text-foreground-secondary">
              {t('team:reason')}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                maxLength={1500}
                placeholder={t('team:reasonPlaceholder')}
                className="mt-1 w-full resize-y rounded border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary/60"
              />
            </label>
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" onClick={() => setPending(null)} className="rounded px-2 py-1 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)]">
                {t('team:cancel')}
              </button>
              <button
                type="button"
                disabled={!acceptedCheck || !reason.trim() || saving}
                onClick={() => void confirmPending()}
                className="rounded bg-emerald-600 px-2 py-1 text-2xs font-medium text-white disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : t('team:confirm')}
              </button>
            </div>
          </section>
        ) : null}

        {pending === '阻塞' ? (
          <section className="mt-3 rounded-lg border border-red-500/35 bg-red-500/5 p-2.5">
            <div className="text-xs font-semibold">{t('team:blockTitle')}</div>
            <p className="mt-1 text-2xs leading-relaxed text-foreground-secondary">{t('team:blockHint')}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {BLOCK_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setBlockType(type)}
                  data-active={blockType === type}
                  className="team-status-button"
                  style={{ '--status-color': '#ef4444' } as CSSProperties}
                >
                  {type}
                </button>
              ))}
            </div>
            <label className="mt-2 block text-2xs text-foreground-secondary">
              {t('team:blockReason')}
              <input
                value={blockReason}
                onChange={(event) => setBlockReason(event.target.value)}
                maxLength={1500}
                className="mt-1 w-full rounded border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary/60"
              />
            </label>
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" onClick={() => setPending(null)} className="rounded px-2 py-1 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)]">
                {t('team:cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void confirmPending()}
                className="rounded bg-red-600 px-2 py-1 text-2xs font-medium text-white disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : t('team:confirm')}
              </button>
            </div>
          </section>
        ) : null}

        <section className="mt-3">
          <div className="team-field-label">{t('team:taskCard')}</div>
          <dl className="mt-1 space-y-1">
            {task.input ? <Info label={t('team:input')} value={task.input} /> : null}
            {task.output ? <Info label={t('team:output')} value={task.output} mono /> : null}
            {task.dependsOn.length ? <Info label={t('team:dependsOn')} value={task.dependsOn.join('、')} mono /> : null}
            {task.wave ? <Info label={t('team:wave')} value={task.wave} /> : null}
            {task.blockType ? <Info label={t('team:blockType')} value={task.blockType} /> : null}
            {task.note ? <Info label={t('team:note')} value={task.note} /> : null}
            {task.manualNote ? <Info label={t('team:manualNote')} value={task.manualNote} /> : null}
            {task.autoNote ? <Info label={t('team:autoNote')} value={task.autoNote} /> : null}
          </dl>
        </section>

        <section className="mt-3">
          <div className="flex items-center gap-2">
            <div className="team-field-label">{t('team:acceptance')}</div>
            {task.acceptance.length ? (
              <span className="text-2xs text-foreground-tertiary">
                {accepted}/{task.acceptance.length}
              </span>
            ) : null}
          </div>
          {task.acceptance.length ? (
            <ul className="mt-1 space-y-0.5">
              {task.acceptance.map((item, index) => (
                <li key={`${index}:${item.text}`} className="flex items-start gap-1.5 text-xs leading-relaxed">
                  <span
                    className={cn(
                      'mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border',
                      item.done ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600' : 'border-border/70 text-transparent',
                    )}
                  >
                    <Check className="h-2.5 w-2.5" />
                  </span>
                  <span className={cn('min-w-0', item.done && 'text-foreground-secondary line-through decoration-1')}>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-2xs text-foreground-tertiary">{t('team:noAcceptance')}</p>
          )}
        </section>

        <section className="mt-3 rounded-lg border border-border/40 bg-card/30 p-2">
          <div className="flex items-center gap-1.5">
            <span className="team-field-label">{t('team:run')}</span>
            {run ? (
              <span
                className={cn(
                  'team-chip',
                  runActive && live ? 'text-sky-600' : '',
                )}
                data-tone={run.status === 'failed' || run.status === 'cancelled' ? 'danger' : run.status === 'done' ? 'success' : undefined}
              >
                {run.status === 'starting'
                  ? t('team:runStarting')
                  : run.status === 'running'
                    ? t('team:runRunning')
                    : run.status === 'done'
                      ? t('team:runDone')
                      : run.status === 'failed'
                        ? t('team:runFailed')
                        : t('team:runCancelled')}
              </span>
            ) : null}
          </div>
          {run ? (
            <>
              <div className="mt-1 flex items-center gap-2 text-2xs text-foreground-tertiary">
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <span className="truncate font-mono" title={run.sessionFile}>{sessionFileName(run.sessionFile)}</span>
              </div>
              {runActive && !live ? (
                <div className="mt-1 flex items-start gap-1.5 text-2xs text-amber-600">
                  <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
                  <span className="flex-1">{t('team:staleRun')}</span>
                </div>
              ) : null}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => onOpenSession(run)} className="rounded bg-[var(--bg-hover)] px-2 py-1 text-2xs hover:bg-[var(--bg-active)]">
                  {t('team:openSession')}
                </button>
                {runActive && !live ? (
                  <button type="button" onClick={() => onSettleRun(run)} className="rounded bg-amber-500/10 px-2 py-1 text-2xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                    {t('team:settleRun')}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="mt-1 text-2xs text-foreground-tertiary">{t('team:runIdle')}</p>
          )}
        </section>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onDispatch}
            disabled={busy || task.status === '已验收'}
            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground disabled:opacity-40"
            title={t('team:dispatchNote')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {t('team:dispatch')}
          </button>
          <button
            type="button"
            onClick={onCopyPrompt}
            className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-2xs text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
            {t('team:copyPrompt')}
          </button>
        </div>

        {task.raw ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-2xs text-foreground-tertiary hover:text-foreground">{t('team:raw')}</summary>
            <pre className="team-raw mt-1">{task.raw}</pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <dt className="w-12 shrink-0 text-2xs text-foreground-tertiary">{label}</dt>
      <dd className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words', mono && 'font-mono text-2xs')}>{value}</dd>
    </div>
  )
}
