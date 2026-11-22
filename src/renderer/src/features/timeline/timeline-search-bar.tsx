import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'

/** Floating in-session timeline search bar (`Ctrl/Cmd+F`). */
export function TimelineSearchBar({
  query,
  matchCount,
  activeIndex,
  focusSeq,
  onQueryChange,
  onPrev,
  onNext,
  onClose,
}: {
  query: string
  matchCount: number
  activeIndex: number
  focusSeq: number
  onQueryChange: (value: string) => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [focusSeq])

  const trimmed = query.trim()
  const statusLabel = !trimmed
    ? ''
    : matchCount > 0
      ? `${activeIndex + 1} / ${matchCount}`
      : t('timeline:search.noMatches')

  return (
    <div
      role="search"
      data-timeline-search-bar=""
      className="timeline-search-bar absolute right-4 top-3 z-20 flex items-center gap-1 rounded-lg border border-border/80 bg-popover/95 px-2.5 py-1.5 shadow-md backdrop-blur-sm"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/70" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault()
            inputRef.current?.select()
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder={t('timeline:search.placeholder')}
        aria-label={t('timeline:search.placeholder')}
        className="w-44 bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground-secondary/50 sm:w-52"
      />
      {statusLabel ? (
        <span
          className={cn(
            'min-w-[3.25rem] select-none text-right text-[11px] tabular-nums',
            matchCount > 0 ? 'text-foreground-secondary' : 'text-amber-600 dark:text-amber-400',
          )}
        >
          {statusLabel}
        </span>
      ) : null}
      <button
        type="button"
        disabled={matchCount === 0}
        onClick={onPrev}
        title={t('timeline:search.prev')}
        aria-label={t('timeline:search.prev')}
        className="chrome-icon-btn flex h-6 w-6 items-center justify-center rounded text-foreground-secondary disabled:opacity-35 disabled:pointer-events-none"
      >
        <ChevronDown className="h-3.5 w-3.5 rotate-180" />
      </button>
      <button
        type="button"
        disabled={matchCount === 0}
        onClick={onNext}
        title={t('timeline:search.next')}
        aria-label={t('timeline:search.next')}
        className="chrome-icon-btn flex h-6 w-6 items-center justify-center rounded text-foreground-secondary disabled:opacity-35 disabled:pointer-events-none"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title={t('timeline:search.close')}
        aria-label={t('timeline:search.close')}
        className="chrome-icon-btn flex h-6 w-6 items-center justify-center rounded text-foreground-secondary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
