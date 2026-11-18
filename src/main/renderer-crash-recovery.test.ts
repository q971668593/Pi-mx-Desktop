import { describe, expect, it } from 'vitest'
import { CRASH_RELOAD_WINDOW_MS, MAX_CRASH_RELOADS, planCrashReload } from './renderer-crash-recovery'

const t0 = 1_700_000_000_000

describe('renderer crash reload limiter', () => {
  it('reloads the first crash and records it', () => {
    expect(planCrashReload([], t0)).toEqual({ reload: true, history: [t0] })
  })

  it('reloads a second crash inside the window', () => {
    const plan = planCrashReload([t0], t0 + 1_000)
    expect(plan.reload).toBe(true)
    expect(plan.history).toEqual([t0, t0 + 1_000])
  })

  it('denies a third crash inside the window and keeps history for later checks', () => {
    const history = [t0, t0 + 1_000]
    const plan = planCrashReload(history, t0 + 2_000)
    expect(plan.reload).toBe(false)
    expect(plan.history).toEqual(history)
  })

  it('allows reloading again once old crashes left the window', () => {
    const plan = planCrashReload([t0, t0 + 1_000], t0 + CRASH_RELOAD_WINDOW_MS + 1)
    expect(plan.reload).toBe(true)
    // t0 expired; the crash at t0 + 1s is still inside the window, and this crash is appended.
    expect(plan.history).toEqual([t0 + 1_000, t0 + CRASH_RELOAD_WINDOW_MS + 1])
  })

  it('drops entries in the future instead of treating them as recent', () => {
    const plan = planCrashReload([t0 + 60_000, t0], t0)
    expect(plan.reload).toBe(true)
    expect(plan.history).toEqual([t0, t0])
    expect(MAX_CRASH_RELOADS).toBe(2)
  })
})
