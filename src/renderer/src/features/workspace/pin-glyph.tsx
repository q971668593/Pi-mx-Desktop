import { cn } from '@renderer/lib/utils'

/** Crisp geometric pin glyph so session pinning doesn't require modifying icon theme packs. */
export function PinGlyph({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-3 w-3 shrink-0', className)}
      aria-hidden
    >
      <path d="M9.8 2.2 13.8 6.2l-1.5 1.5-1.1-.4-2.5 2.5.4 1.6-1.2 1.2-2.4-2.4-2.8 2.8-.7-.7 2.8-2.8-2.4-2.4 1.2-1.2 1.6.4 2.5-2.5-.4-1.1Z" />
    </svg>
  )
}
