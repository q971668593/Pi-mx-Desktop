import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPendingSessionModel } from './apply-pending-session-model'
import { createSessionModelOverrides } from './session-model-overrides'

const dirs: string[] = []
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'pi-apply-pending-'))
  dirs.push(dir)
  return createSessionModelOverrides({ filePath: join(dir, 'overrides.json') })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SESSION = 'C:\\sessions\\a.jsonl'

describe('applyPendingSessionModel', () => {
  it('does nothing when the session has no pending pick', async () => {
    const request = vi.fn()
    await expect(applyPendingSessionModel(request, store(), SESSION)).resolves.toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('applies the model through the worker and clears the override', async () => {
    const overrides = store()
    overrides.set(SESSION, 'magpie', 'deepseek', 'high')
    const request = vi.fn(async () => ({ type: 'setModel-done' }))
    await expect(applyPendingSessionModel(request, overrides, SESSION)).resolves.toBe(true)
    expect(request).toHaveBeenNthCalledWith(1, 'setModel', { provider: 'magpie', modelId: 'deepseek', sessionFile: SESSION })
    expect(request).toHaveBeenNthCalledWith(2, 'setThinkingLevel', { level: 'high', sessionFile: SESSION })
    expect(overrides.get(SESSION)).toBeNull()
  })

  it('keeps the override when the worker rejects the model, so the next start retries', async () => {
    const overrides = store()
    overrides.set(SESSION, 'magpie', 'missing', undefined)
    const request = vi.fn(async () => { throw new Error('MODEL_NOT_FOUND') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(applyPendingSessionModel(request, overrides, SESSION)).resolves.toBe(false)
    expect(overrides.get(SESSION)).toMatchObject({ modelId: 'missing' })
    warn.mockRestore()
  })

  it('does not send a thinking level when the pick did not include one', async () => {
    const overrides = store()
    overrides.set(SESSION, 'p', 'm')
    const request = vi.fn(async () => ({}))
    await applyPendingSessionModel(request, overrides, SESSION)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
