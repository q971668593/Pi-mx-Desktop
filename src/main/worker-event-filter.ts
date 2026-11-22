import type { AppEvent } from '@shared/app-events'

/**
 * Skips forwarding high-frequency token deltas (`message` with `phase: 'delta'`) from
 * non-foreground sessions to the renderer process. Lifecycle, tool, state, completion, error,
 * and message boundary (`start`/`end`) events still flow for sidebar/goal/notification tracking.
 */
export function shouldForwardEventToRenderer(
  event: AppEvent,
  opts: { fromPoolKey: string; foregroundPoolKey: string | null },
): boolean {
  if (opts.foregroundPoolKey === null) return true
  if (opts.fromPoolKey === opts.foregroundPoolKey) return true
  if (event.type === 'message' && event.phase === 'delta') return false
  return true
}
