import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import i18n from '@renderer/lib/i18n'
import { clearAvailableModelsCacheForTests } from '@renderer/lib/available-models-cache'
import { getDirtySettingsSlices } from './settings-dirty-registry'
import { ModelsSettingsPanel } from './models-settings-panel'

const appEventListeners = new Set<(event: { type: string }) => void>()

// The assertions below use the English copy; the app ships Chinese by default.
beforeAll(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
  onAppEvent: (listener: (event: { type: string }) => void) => {
    appEventListeners.add(listener)
    return () => appEventListeners.delete(listener)
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

// The plugin-model row reads the shared settings draft and has its own ipc cadence; this
// panel test covers provider rows, so keep its call order untouched.
vi.mock('./plugin-model-settings', () => ({ PluginModelSettings: () => null }))
vi.mock('./image-gen-settings', () => ({ ImageGenSettings: () => null }))

// Advanced runtime tuning (cycle scope / thinking bindings) has its own slice and ipc cadence.
vi.mock('./model-runtime-advanced', () => ({ ModelRuntimeAdvanced: () => null }))

// Default-model picking has its own slice and ipc cadence; covered by model-default-section.test.tsx.
vi.mock('./model-default-section', () => ({ ModelDefaultSection: () => null }))

const initialConfig = {
  providers: {
    custom: {
      name: 'Original provider',
      baseUrl: 'https://example.invalid/v1',
      models: [{ id: 'model-a' }],
    },
  },
}

const availableModels = [
  {
    id: 'store-only',
    name: 'Store only',
    provider: 'custom',
    contextWindow: 128000,
    maxOutput: 4096,
    available: true,
  },
]

function getRequest(method: string) {
  return vi.mocked(ipcClient.invoke).mock.calls.filter(([name]) => name === method)
}

function getCallPayloads(method: string) {
  return getRequest(method).map(([, payload]) => payload)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Method-keyed stub: mount also calls pi.settings.get (useModelPreferences) and
 *  model.list { scope: 'available' } (ensureAvailableModels), so per-call
 *  mockResolvedValueOnce chains are order-fragile. */
function stubInvoke(handler: (method: string, args?: any) => unknown) {
  vi.mocked(ipcClient.invoke).mockImplementation(async (...invokeArgs: any[]) =>
    handler(invokeArgs[0], invokeArgs[1]),
  )
}

function defaultHandler(state: {
  getConfig: () => unknown
  setConfig?: (config: unknown) => unknown
  settingsModels?: () => unknown[]
  reloadResult?: () => unknown
}) {
  return (method: string, args?: any): unknown => {
    if (method === 'pi.models.get') return { path: 'models.json', config: state.getConfig() }
    if (method === 'pi.models.set') {
      if (state.setConfig) return state.setConfig(args?.config)
      return { ok: true, path: 'models.json' }
    }
    if (method === 'pi.settings.get') return { settings: {} }
    if (method === 'pi.settings.set') return { ok: true }
    if (method === 'model.reload') {
      if (state.reloadResult) return state.reloadResult()
      return { ok: true, models: availableModels }
    }
    if (method === 'model.list') {
      if (args?.scope === 'settings') return { models: state.settingsModels?.() ?? [] }
      return { models: [] }
    }
    return {}
  }
}

/** Drive the real workbench UI: open "Edit config" for the selected provider,
 *  rename it in ProviderConfigDialog, and submit. */
async function editProviderName(next = 'Changed provider') {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit config' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: next } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
}

async function clickRefreshCatalog() {
  fireEvent.click(await screen.findByRole('button', { name: /refresh local catalog/i }))
}

beforeEach(() => {
  vi.mocked(ipcClient.invoke).mockReset()
  clearAvailableModelsCacheForTests()
  appEventListeners.clear()
})

afterEach(() => {
  cleanup()
  clearAvailableModelsCacheForTests()
})

describe('ModelsSettingsPanel save', () => {
  it('shows configured OAuth accounts beside custom providers and omits the SDK directory', async () => {
    stubInvoke(
      defaultHandler({
        getConfig: () => initialConfig,
        settingsModels: () => [
          { ...availableModels[0], provider: 'openai-codex', auth: { supported: true, configured: true, type: 'oauth' } },
          { ...availableModels[0], provider: 'unconfigured', auth: { supported: true, configured: false } },
        ],
      }),
    )
    render(<ModelsSettingsPanel />)
    const section = await screen.findByTestId('user-provider-section')
    expect(section).toHaveTextContent('Original provider')
    expect(section).toHaveTextContent('openai-codex')
    expect(section).not.toHaveTextContent('unconfigured')
    expect(screen.queryByTestId('sdk-provider-section')).toBeNull()
  })

  it('refreshes the local catalog without replacing an unsaved provider draft', async () => {
    let stored: any = structuredClone(initialConfig)
    let settingsCalls = 0
    stubInvoke(
      defaultHandler({
        getConfig: () => structuredClone(stored),
        setConfig: (config) => {
          stored = structuredClone(config)
          return { ok: true, path: 'models.json' }
        },
        settingsModels: () =>
          settingsCalls++
            ? [{ ...availableModels[0], provider: 'openai-codex', auth: { supported: true, configured: true, type: 'oauth' } }]
            : [],
      }),
    )
    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Original provider')
    await editProviderName()
    await screen.findAllByText('Changed provider')
    await clickRefreshCatalog()
    // Catalog refresh surfaced the newly configured OAuth row while the draft edit stays visible.
    expect(await screen.findAllByText('openai-codex')).not.toHaveLength(0)
    expect(screen.getAllByText('Changed provider').length).toBeGreaterThan(0)
    // Worker reload ran exactly once for the refresh.
    expect(getRequest('model.reload')).toHaveLength(1)
    // The unsaved draft is the new "dirty": the debounced autosave writes the edited config,
    // and the refresh itself must not have reloaded models.json on top of it (every
    // pi.models.get before the first pi.models.set is the initial mount read).
    await waitFor(() => expect(getRequest('pi.models.set')).toHaveLength(1))
    const setPayloads = getCallPayloads('pi.models.set')
    expect((setPayloads[0] as any)?.config?.providers?.custom?.name).toBe('Changed provider')
    const allMethods = vi.mocked(ipcClient.invoke).mock.calls.map(([name]) => name)
    const firstSet = allMethods.indexOf('pi.models.set')
    expect(allMethods.slice(0, firstSet).filter((m) => m === 'pi.models.get')).toHaveLength(1)
  })

  it('reloads externally changed config when the draft is clean', async () => {
    let reads = 0
    const external = { providers: { custom: { ...initialConfig.providers.custom, name: 'External provider' } } }
    stubInvoke(
      defaultHandler({
        getConfig: () => (reads++ ? structuredClone(external) : structuredClone(initialConfig)),
        settingsModels: () => [],
      }),
    )
    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Original provider')
    await clickRefreshCatalog()
    await screen.findAllByText('External provider')
    // Clean draft: no write scheduled by the refresh.
    expect(getRequest('pi.models.set')).toHaveLength(0)
    expect(getDirtySettingsSlices()).toEqual([])
    await editProviderName()
    await waitFor(() => expect(getRequest('pi.models.set')).toHaveLength(1))
    const setPayload = getCallPayloads('pi.models.set')[0] as any
    expect(setPayload?.config?.providers?.custom?.name).toBe('Changed provider')
    expect(setPayload?.config?.providers?.custom?.baseUrl).toBe(external.providers.custom.baseUrl)
  })

  it('reports reload failures instead of showing success', async () => {
    const { toast } = await import('sonner')
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    stubInvoke(
      defaultHandler({
        getConfig: () => initialConfig,
        settingsModels: () => [],
        reloadResult: () => ({ ok: false, models: [], error: 'worker failed' }),
      }),
    )
    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Original provider')
    await clickRefreshCatalog()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('worker failed'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('preserves edits made while the refreshed config is loading', async () => {
    let resolveRead!: (value: unknown) => void
    let reads = 0
    const base = defaultHandler({
      getConfig: () => structuredClone(initialConfig),
      settingsModels: () => [],
    })
    stubInvoke((method: string, args?: any) => {
      if (method === 'pi.models.get') {
        // Second read (refresh) must stay a raw pending promise so the refresh
        // genuinely stays in flight while the user edits.
        if (reads++ === 0) return { path: 'models.json', config: structuredClone(initialConfig) }
        return new Promise((resolve) => {
          resolveRead = resolve
        })
      }
      return base(method, args)
    })
    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Original provider')
    await clickRefreshCatalog()
    await waitFor(() => expect(reads).toBe(2))
    await editProviderName()
    await act(async () => {
      resolveRead({ path: 'models.json', config: { providers: {} } })
    })
    // The late external response must not clobber the newer draft edit.
    expect(screen.getAllByText('Changed provider').length).toBeGreaterThan(0)
    await waitFor(() => expect(getRequest('pi.models.set')).toHaveLength(1))
    expect(getDirtySettingsSlices().map((slice) => slice.id)).not.toContain('pi-models')
  })

  it('writes the edited provider, reloads the normalized config, and clears dirty state', async () => {
    let stored: any = structuredClone(initialConfig)
    stubInvoke(
      defaultHandler({
        getConfig: () => structuredClone(stored),
        setConfig: (config) => {
          stored = structuredClone(config)
          return { ok: true, path: 'models.json' }
        },
        settingsModels: () => [],
      }),
    )

    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Original provider')
    await editProviderName()
    // Debounced autosave persists the draft without any manual bottom-bar commit.
    await waitFor(() => expect(getRequest('pi.models.set')).toHaveLength(1))
    const setPayload = getCallPayloads('pi.models.set')[0] as any
    expect(setPayload?.config?.providers?.custom?.name).toBe('Changed provider')
    expect(setPayload?.config?.providers?.custom?.models).toEqual(initialConfig.providers.custom.models)
    // Autosave reloads models.json afterwards (mount read + post-save reload).
    await waitFor(() => expect(getRequest('pi.models.get').length).toBeGreaterThanOrEqual(2))
    // Normalized reload echoes the saved name, so the row stays renamed.
    expect(await screen.findAllByText('Changed provider')).not.toHaveLength(0)
    // Settled: nothing left to save (legacy bottom-bar registry stays out of it).
    await sleep(700)
    expect(getRequest('pi.models.set')).toHaveLength(1)
    expect(getDirtySettingsSlices()).toEqual([])
  })

  it('preserves configured model metadata and overrides when editing a provider', async () => {
    const config = {
      providers: {
        custom: {
          name: 'Custom',
          baseUrl: 'https://example.invalid/v1',
          models: [{ id: 'model-a', contextWindow: 1234 }],
          modelOverrides: { 'sdk-model': { contextWindow: 64000 } },
        },
      },
    }
    stubInvoke(
      defaultHandler({
        getConfig: () => structuredClone(config),
        settingsModels: () => [],
      }),
    )
    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Custom')
    await editProviderName()
    await waitFor(() => expect(getRequest('pi.models.set')).toHaveLength(1))
    const saved = (getCallPayloads('pi.models.set')[0] as any)?.config?.providers?.custom
    expect(saved?.name).toBe('Changed provider')
    expect(saved?.models).toEqual([{ id: 'model-a', contextWindow: 1234 }])
    expect(saved?.modelOverrides).toEqual({ 'sdk-model': { contextWindow: 64000 } })
  })

  it('keeps the edited provider dirty and displays the write error', async () => {
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    stubInvoke(
      defaultHandler({
        getConfig: () => structuredClone(initialConfig),
        setConfig: () => ({ ok: false, path: 'models.json', error: 'invalid provider config' }),
        settingsModels: () => [],
      }),
    )

    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Original provider')
    await editProviderName()

    await waitFor(() => expect(screen.getByText('invalid provider config')).toBeTruthy())

    // Failed write: no reload attempted, draft kept, autosave does not spin on the same sig.
    expect(getRequest('pi.models.get')).toHaveLength(1)
    expect(screen.getAllByText('Changed provider').length).toBeGreaterThan(0)
    await sleep(600)
    expect(getRequest('pi.models.set')).toHaveLength(1)
    expect(toast.error).toHaveBeenCalled()
  })

  it('keeps the edited provider dirty when post-save reload fails', async () => {
    let reads = 0
    stubInvoke((method: string, args?: any) => {
      if (method === 'pi.models.get') {
        reads++
        if (reads === 1) return { path: 'models.json', config: structuredClone(initialConfig) }
        throw new Error('reload failed')
      }
      return defaultHandler({
        getConfig: () => structuredClone(initialConfig),
        settingsModels: () => [],
      })(method, args)
    })

    render(<ModelsSettingsPanel />)
    await screen.findAllByText('Original provider')
    await editProviderName()

    await waitFor(() => expect(screen.getByText('reload failed')).toBeTruthy())

    // The write itself went through, but the post-save reload failed: baseline was not
    // advanced, so the draft is still pending and stays visible.
    expect(getRequest('pi.models.set')).toHaveLength(1)
    expect(screen.getAllByText('Changed provider').length).toBeGreaterThan(0)
  })
})
