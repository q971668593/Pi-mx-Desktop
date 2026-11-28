import type { RefObject } from 'react'
import type { MagpieQuotaEntry, MagpieQuotaWindow } from '@shared/ipc-contract'

/** 优先取 5h 窗口，没有则取第一个。 */
export function pickPrimaryWindow(entry: MagpieQuotaEntry | undefined): MagpieQuotaWindow | undefined {
  const windows = entry?.windows
  if (!windows || windows.length === 0) return undefined
  return windows.find((w) => w.name.includes('5h')) ?? windows[0]
}

function fmtPercent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : '--'
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/** 该 provider 是否有真实数据：余额或任一窗口有有效数字。没接中转/离线时全是 --，这种就不显示。 */
export function hasQuotaData(entry: MagpieQuotaEntry | undefined): boolean {
  if (!entry) return false
  if (entry.balance !== undefined && entry.balance !== null && String(entry.balance).trim() !== '' && String(entry.balance) !== '--') return true
  return (entry.windows || []).some((w) => numOrNull(w.usedPercent) !== null || numOrNull(w.remainingPercent) !== null)
}

/** 状态栏一行：只拼有数据的那家；两家都没数据返回 null（调用方直接隐藏按钮，不显示）。 */
export function formatQuotaSummary(codex?: MagpieQuotaEntry, opencode?: MagpieQuotaEntry): string | null {
  const cw = hasQuotaData(codex) ? pickPrimaryWindow(codex) : undefined
  const ow = hasQuotaData(opencode) ? pickPrimaryWindow(opencode) : undefined
  if (!cw && !ow) return null
  const parts: string[] = []
  if (codex && hasQuotaData(codex)) parts.push(cw ? `Codex ${cw.name}剩${fmtPercent(cw.remainingPercent)}` : 'Codex --')
  if (opencode && hasQuotaData(opencode)) parts.push(ow ? `opencode ${ow.name}剩${fmtPercent(ow.remainingPercent)}` : 'opencode --')
  return parts.join(' · ') || null
}

/** hover title：窗口明细 + balance，一行一个 provider。 */
export function buildQuotaTitle(codex?: MagpieQuotaEntry, opencode?: MagpieQuotaEntry): string {
  const lines: string[] = []
  for (const entry of [codex, opencode]) {
    if (!entry) continue
    const label = entry.provider === 'codex' ? 'Codex' : 'opencode'
    const balance = entry.balance ?? '--'
    const windows = (entry.windows || [])
      .map((w) => `${w.name} 已用${fmtPercent(w.usedPercent)}/剩余${fmtPercent(w.remainingPercent)}${w.resetsAt ? ` 重置${w.resetsAt}` : ''}`)
      .join('；')
    lines.push(`${label}(余额${balance}): ${windows || '无窗口数据'}`)
  }
  return lines.join('\n') || '暂无额度数据'
}

export function formatResetsAt(resetsAt?: string): string {
  if (!resetsAt) return '--'
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return resetsAt
  return date.toLocaleString()
}

/** 状态栏触发按钮（anchor 由调用方持有，popover 由调用方渲染 ShellPopover）。 */
export function StatusQuotaButton({
  anchorRef,
  open,
  label,
  title,
  onClick,
}: {
  anchorRef: RefObject<HTMLButtonElement>
  open: boolean
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      ref={anchorRef}
      type="button"
      className="workbench-status-trigger tabular-nums"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="剩余额度"
      title={title}
      onClick={onClick}
    >
      <span>{label}</span>
    </button>
  )
}

/** ShellPopover 里明细：只显示有数据的 provider；主窗口（5h）圆环 + 其余窗口进度条。 */
export function MagpieQuotaDetails({
  codex,
  opencode,
  error,
}: {
  codex?: MagpieQuotaEntry
  opencode?: MagpieQuotaEntry
  error?: string | null
}) {
  const list = [codex, opencode].filter((e): e is MagpieQuotaEntry => hasQuotaData(e))
  if (list.length === 0) {
    if (error) return <p role="alert" className="workbench-error">{error}</p>
    return <p className="workbench-empty">暂无额度数据（中转未配置或离线）</p>
  }
  return (
    <div className="space-y-5 px-4 py-4">
      {list.map((entry) => (
        <QuotaProviderCard key={entry.provider} entry={entry} />
      ))}
    </div>
  )
}

function QuotaProviderCard({ entry }: { entry: MagpieQuotaEntry }) {
  const windows = entry.windows || []
  const primary = pickPrimaryWindow(entry)
  const rest = primary ? windows.filter((w) => w !== primary) : windows
  return (
    <section aria-label={entry.provider}>
      <h3 className="workbench-group-heading">
        {entry.provider === 'codex' ? 'Codex' : 'opencode'}
        <span>余额 {String(entry.balance ?? '--')}</span>
      </h3>
      {primary ? <QuotaHero window={primary} /> : null}
      {rest.length ? (
        <div className="mt-3 space-y-2.5">
          {rest.map((w) => (
            <QuotaBarRow key={w.name} window={w} />
          ))}
        </div>
      ) : null}
      {!primary && rest.length === 0 ? <p className="workbench-row-detail">无窗口数据</p> : null}
    </section>
  )
}

/** 主窗口（一般是 5 小时）：圆环 = 剩余比例，右边配文字。 */
function QuotaHero({ window }: { window: MagpieQuotaWindow }) {
  const remaining = numOrNull(window.remainingPercent)
  const used = numOrNull(window.usedPercent)
  return (
    <div className="mt-1 flex items-center gap-4">
      <QuotaRing value={remaining} />
      <div className="min-w-0 flex-1 text-xs">
        <p className="truncate text-sm font-medium text-foreground">{window.name}</p>
        <p className="mt-0.5 text-foreground-secondary tabular-nums">
          已用{fmtPercent(used)} · 剩余{fmtPercent(remaining)}
        </p>
        <p className="mt-0.5 text-foreground-tertiary">{formatResetsAt(window.resetsAt)}重置</p>
      </div>
    </div>
  )
}

/** 其余窗口：一行文字 + 一条进度条（按已用比例）。 */
function QuotaBarRow({ window }: { window: MagpieQuotaWindow }) {
  const used = numOrNull(window.usedPercent)
  const remaining = numOrNull(window.remainingPercent)
  const fill = used !== null ? clampPercent(used) : remaining !== null ? 100 - clampPercent(remaining) : null
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-foreground-secondary">
          {window.name}
          <span className="workbench-row-detail"> · {formatResetsAt(window.resetsAt)}重置</span>
        </span>
        <span className="shrink-0 text-foreground-secondary tabular-nums">
          已用{fmtPercent(used)} · 剩余{fmtPercent(remaining)}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill ?? undefined}
        aria-label={`${window.name}已用比例`}
      >
        {fill !== null ? <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${fill}%` }} /> : null}
      </div>
    </div>
  )
}

/** 圆环：value 为剩余百分比，无数据时灰圈 + --。 */
function QuotaRing({ value }: { value: number | null }) {
  const R = 26
  const C = 2 * Math.PI * R
  const pct = value !== null ? clampPercent(value) : null
  const offset = pct !== null ? C * (1 - pct / 100) : 0
  return (
    <div className="relative h-[68px] w-[68px] shrink-0" aria-hidden={pct === null}>
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r={R} fill="none" strokeWidth="7" className="stroke-border" />
        {pct !== null ? (
          <circle
            cx="34"
            cy="34"
            r={R}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className="stroke-primary transition-all"
            strokeDasharray={C}
            strokeDashoffset={offset}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-foreground tabular-nums">
        {pct !== null ? `${Math.round(pct)}%` : '--'}
      </span>
    </div>
  )
}
