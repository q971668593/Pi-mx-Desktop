import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setCapabilities: vi.fn(), get: vi.fn() }))
vi.mock('../config-store', () => ({ configStore: { get: mocks.get } }))
vi.mock('../worker-manager', () => ({ workerManager: { setCapabilities: mocks.setCapabilities } }))
vi.mock('../browser/browser-host', () => ({ peekBrowserHost: vi.fn() }))
vi.mock('../browser/targets', () => ({ noteBrowserTarget: vi.fn() }))
vi.mock('../session-file-meta', () => ({ readSessionMetaFromFile: vi.fn() }))
vi.mock('./pi-ui.md?raw', () => ({ default: '' }))

import { configureCapabilities, capabilityCatalog } from './catalog'
import { applySessionCapabilities } from './session-apply'

describe('session capability defaults', () => {
  it('activates default web search without a catalog lookup, regardless of another workspace catalog', async () => {
    mocks.get.mockReturnValue(undefined)
    mocks.setCapabilities.mockResolvedValue(undefined)
    configureCapabilities({ browserPanelEnabled: () => true, webSearchEnabled: () => true })
    capabilityCatalog({ 'web-search': 0 })
    const result = await applySessionCapabilities('/workspace-b/session.jsonl')
    expect(result.capabilities).toContain('web-search')
    expect(mocks.setCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({ 'web-search': expect.stringContaining('# Web search') }),
      expect.arrayContaining(['web-search']),
      '/workspace-b/session.jsonl',
    )
  })
})
