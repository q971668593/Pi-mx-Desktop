import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ModelDefaultSection, changedModelDefaultSettings } from './model-default-section'
import { commitAllSettingsSlices, getDirtySettingsSlices } from './settings-dirty-registry'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
  onAppEvent: vi.fn(() => () => {}),
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const invoke = vi.mocked(ipcClient.invoke)
let stored: Record<string, unknown>

const MODELS = [
  { provider: 'anthropic', id: 'opus', available: true, auth: { configured: true } },
  { provider: 'openai', id: 'gpt-6', available: true, auth: { configured: true } },
]

beforeEach(() => {
  stored = { defaultProvider: 'anthropic', defaultModel: 'opus', defaultThinkingLevel: 'high' }
  invoke.mockReset()
  invoke.mockImplementation(async (method: string, req?: unknown) => {
    if (method === 'pi.settings.get') return { settings: stored }
    if (method === 'pi.settings.set') {
      stored = { ...stored, ...(req as { patch: Record<string, unknown> }).patch }
      return { ok: true }
    }
    if (method === 'model.auth.providers') {
      return {
        providers: [
          { providerId: 'anthropic', name: 'Anthropic', oauth: { subscription: true } },
          { providerId: 'openai', name: 'OpenAI', oauth: { subscription: true } },
        ],
      }
    }
    return {}
  })
})

describe('changedModelDefaultSettings', () => {
  it('returns only the keys that changed and nulls a cleared default', () => {
    expect(
      changedModelDefaultSettings(
        { defaultProvider: 'openai', defaultModel: 'gpt-6', defaultThinkingLevel: 'low' },
        { defaultProvider: 'openai', defaultModel: 'gpt-6', defaultThinkingLevel: 'low' },
      ),
    ).toEqual({})
    expect(
      changedModelDefaultSettings(
        {},
        { defaultProvider: 'openai', defaultModel: 'gpt-6', defaultThinkingLevel: 'low' },
      ),
    ).toEqual({ defaultProvider: null, defaultModel: null, defaultThinkingLevel: null })
  })
})

describe('ModelDefaultSection', () => {
  const selectByLabel = (label: string) => {
    const found = screen.getAllByLabelText(label).find((el) => el.tagName === 'SELECT')
    if (!found) throw new Error(`no select for ${label}`)
    return found as HTMLSelectElement
  }

  it('shows the current default and saves a changed model', async () => {
    render(<ModelDefaultSection models={MODELS as never} />)

    await waitFor(() => expect(selectByLabel('settings:models.default.model')).toBeTruthy())
    const model = selectByLabel('settings:models.default.model')
    await waitFor(() => expect(model).toHaveValue('opus'))

    fireEvent.change(selectByLabel('settings:models.default.provider'), { target: { value: 'openai' } })
    await waitFor(() => expect(model).toHaveValue('gpt-6'))
    await waitFor(() => expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['model-default']))

    await act(async () => {
      await commitAllSettingsSlices()
    })

    const sets = invoke.mock.calls.filter(([name]) => name === 'pi.settings.set')
    expect(sets).toHaveLength(1)
    expect(sets[0][1]).toEqual({
      patch: { defaultProvider: 'openai', defaultModel: 'gpt-6' },
    })
    await waitFor(() => expect(getDirtySettingsSlices()).toEqual([]))
  })

  it('backfills a missing thinking level for an existing default, and saves only that key', async () => {
    invoke.mockImplementation(async (method: string, req?: unknown) => {
      // 老配置：有供应商+模型，没强度（用户以前没选过）。
      if (method === 'pi.settings.get') return { settings: { defaultProvider: 'anthropic', defaultModel: 'opus' } }
      if (method === 'pi.settings.set') {
        stored = { ...stored, ...(req as { patch: Record<string, unknown> }).patch }
        return { ok: true }
      }
      if (method === 'model.auth.providers') {
        return { providers: [{ providerId: 'anthropic', oauth: { subscription: true } }] }
      }
      return {}
    })
    render(<ModelDefaultSection models={MODELS as never} />)

    await waitFor(() => expect(selectByLabel('settings:models.default.model')).toHaveValue('opus'))
    // 没存过强度：自动补“中”，并标脏提醒保存。
    expect(selectByLabel('settings:models.default.thinking')).toHaveValue('medium')
    await waitFor(() => expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['model-default']))

    await act(async () => {
      await commitAllSettingsSlices()
    })
    const sets = invoke.mock.calls.filter(([name]) => name === 'pi.settings.set')
    expect(sets).toHaveLength(1)
    expect(sets[0][1]).toEqual({ patch: { defaultThinkingLevel: 'medium' } })
  })

  it('hides unsubscribed providers', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'pi.settings.get') return { settings: {} }
      if (method === 'model.auth.providers') {
        return {
          providers: [
            { providerId: 'anthropic', oauth: { subscription: true } },
            { providerId: 'openai', oauth: {} },
          ],
        }
      }
      return {}
    })
    render(<ModelDefaultSection models={MODELS as never} />)

    await waitFor(() => expect(selectByLabel('settings:models.default.provider')).toBeTruthy())
    await waitFor(() => {
      const live = [...selectByLabel('settings:models.default.provider').querySelectorAll('option')].map((o) =>
        o.getAttribute('value'),
      )
      expect(live).toContain('anthropic')
      expect(live).not.toContain('openai')
    })
  })
})
