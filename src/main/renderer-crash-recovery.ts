/**
 * Renderer crash recovery limiter.
 *
 * A single reload recovers from a transient GPU/OOM crash, but a renderer that dies during
 * every load would otherwise loop forever. This keeps the self-healing behaviour while
 * capping it at MAX_CRASH_RELOADS per CRASH_RELOAD_WINDOW_MS; past the cap the user gets a
 * explicit error instead of a silently white window.
 */
export const CRASH_RELOAD_WINDOW_MS = 5 * 60_000
export const MAX_CRASH_RELOADS = 2

export type CrashReloadPlan = { reload: boolean; history: number[] }

/** Drop entries outside the window; deny once the cap is reached (history is kept as-is). */
export function planCrashReload(history: number[], now: number): CrashReloadPlan {
  const recent = history.filter((at) => now - at >= 0 && now - at < CRASH_RELOAD_WINDOW_MS).sort((a, b) => a - b)
  if (recent.length >= MAX_CRASH_RELOADS) return { reload: false, history: recent }
  return { reload: true, history: [...recent, now] }
}
