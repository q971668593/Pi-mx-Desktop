import type { SessionModelOverrides } from './session-model-overrides'

/**
 * Apply the model/thinking level a user picked for a session while it had no worker.
 *
 * Extracted from the worker manager so the "apply after the session is bound" contract is
 * unit-testable: clear the override only when the worker confirmed it, otherwise keep it for
 * the next attempt (the user's choice must never be lost silently).
 */
export async function applyPendingSessionModel(
  request: (type: string, data: Record<string, unknown>) => Promise<unknown>,
  overrides: SessionModelOverrides,
  sessionFile: string,
): Promise<boolean> {
  const pending = overrides.get(sessionFile)
  if (!pending) return false
  try {
    await request('setModel', {
      provider: pending.provider,
      modelId: pending.modelId,
      sessionFile,
    })
    if (pending.thinkingLevel) {
      await request('setThinkingLevel', { level: pending.thinkingLevel, sessionFile })
    }
    overrides.clear(sessionFile)
    return true
  } catch (error) {
    console.warn('[WorkerManager] pending session model could not be applied:', error)
    return false
  }
}
