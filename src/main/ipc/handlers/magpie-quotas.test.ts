import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  readModelsConfigRaw: vi.fn(),
}))
vi.mock('../registry', () => ({ registerHandler: mocks.registerHandler }))
vi.mock('../../pi-models-json', () => ({ readModelsConfigRaw: mocks.readModelsConfigRaw }))

let quota: () => Promise<any>
let statusline: () => Promise<any>

function configure(baseUrl = 'http://localhost:3425/v1', apiKey = 'key-a') {
  mocks.readModelsConfigRaw.mockReturnValue({ config: { providers: { magpie: { baseUrl, apiKey } } } })
}

describe('magpie quota handlers', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.registerHandler.mockReset()
    mocks.readModelsConfigRaw.mockReset()
    configure()
    const handlers = await import('./magpie-quotas')
    handlers.registerMagpieQuotaHandlers()
    quota = mocks.registerHandler.mock.calls.find(([name]) => name === 'ipc:magpie.quotas')![1]
    statusline = mocks.registerHandler.mock.calls.find(([name]) => name === 'ipc:magpie.statusline')![1]
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('fetches wrapped data and caches it for 60 seconds', async () => {
    vi.useFakeTimers()
    const data = [{ provider: 'codex', windows: [] }]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await quota()).toEqual({ ok: true, data })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3425/v1/magpie/quotas', expect.objectContaining({ headers: { Authorization: 'Bearer key-a' } }))
    expect(await quota()).toEqual({ ok: true, data, cached: true })
    vi.advanceTimersByTime(60_000)
    expect(await quota()).toEqual({ ok: true, data })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not reuse cached quota after endpoint or credential changes', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => ({ ok: true, json: async () => [options.headers.Authorization] }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await quota()).data).toEqual(['Bearer key-a'])
    configure('http://other/v1', 'key-b')
    expect((await quota()).data).toEqual(['Bearer key-b'])
    configure('http://other/v1', 'key-c')
    expect((await quota()).data).toEqual(['Bearer key-c'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reports missing configuration and fetch failures without caching them', async () => {
    mocks.readModelsConfigRaw.mockReturnValue({ config: {} })
    expect(await quota()).toEqual({ ok: false, error: 'magpie-not-configured' })
    configure()
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    expect(await quota()).toEqual({ ok: false, error: 'http-503' })
    expect(await quota()).toEqual({ ok: true, data: [] })
  })

  it('preserves the separate statusline endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'status' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await statusline()).toEqual({ ok: true, text: 'status' })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3425/v1/magpie/statusline', expect.anything())
  })
})
