import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { clearAvailableModelsCacheForTests } from '@renderer/lib/available-models-cache'
import { ModelRuntimeAdvanced, changedModelAdvancedSettings } from './model-runtime-advanced'
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

beforeEach(() => {
  clearAvailableModelsCacheForTests()
  stored = {
    enabledModels: ['anthropic/*'],
    modelThinkingLevels: { 'anthropic/opus': 'max' },
  }
  invoke.mockReset()
  invoke.mockImplementation(async (method: string, req?: unknown) => {
    if (method === 'pi.settings.get') return { settings: stored }
    if (method === 'pi.settings.set') {
      stored = { ...stored, ...(req as { patch: Record<string, unknown> }).patch }
      return { ok: true }
    }
    if (method === 'model.list') {
      return {
        models: [
          { provider: 'anthropic', id: 'opus', available: true },
          { provider: 'openai', id: 'gpt-6', available: true },
        ],
      }
    }
    return {}
  })
})

describe('changedModelAdvancedSettings', () => {
  it('returns only the keys that changed and nulls an emptied cycle scope', () => {
    expect(changedModelAdvancedSettings({ modelThinkingLevels: {} }, { modelThinkingLevels: {} })).toEqual({})
    expect(
      changedModelAdvancedSettings({ modelThinkingLevels: {}, enabledModels: undefined }, { modelThinkingLevels: {}, enabledModels: ['a/*'] }),
    ).toEqual({ enabledModels: null })
  })
})

describe('ModelRuntimeAdvanced', () => {
  it('shows the cycle scope and bindings, and saves an edited level', async () => {
    render(<ModelRuntimeAdvanced />)

    const scope = await screen.findByPlaceholderText('settings:models.advanced.cycleScopePlaceholder')
    await waitFor(() => expect(scope).toHaveValue('anthropic/*'))
    expect(screen.getByText('settings:models.advanced.bindingsTitle')).toBeTruthy()

    const level = screen.getAllByLabelText('settings:models.advanced.bindingLevel')[0]
    fireEvent.change(level, { target: { value: 'low' } })
    await waitFor(() => expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['model-advanced']))

    await act(async () => {
      await commitAllSettingsSlices()
    })

    const sets = invoke.mock.calls.filter(([name]) => name === 'pi.settings.set')
    expect(sets).toHaveLength(1)
    expect(sets[0][1]).toEqual({ patch: { modelThinkingLevels: { 'anthropic/opus': 'low' } } })
    await waitFor(() => expect(getDirtySettingsSlices()).toEqual([]))
  })

  it('adds a binding for a model that has none yet', async () => {
    render(<ModelRuntimeAdvanced />)

    const pick = await screen.findByLabelText('settings:models.advanced.pickModel')
    await waitFor(() => expect(pick.querySelectorAll('option[value="openai/gpt-6"]')).toHaveLength(1))
    fireEvent.change(pick, { target: { value: 'openai/gpt-6' } })
    fireEvent.click(screen.getByRole('button', { name: /addBinding/ }))

    await act(async () => {
      await commitAllSettingsSlices()
    })

    const sets = invoke.mock.calls.filter(([name]) => name === 'pi.settings.set')
    expect(sets[0][1]).toEqual({
      patch: { modelThinkingLevels: { 'anthropic/opus': 'max', 'openai/gpt-6': 'high' } },
    })
  })
})
