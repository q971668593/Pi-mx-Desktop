import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke } }))
vi.mock('@renderer/components/icons', () => ({
  Clock: () => null,
  Globe: () => null,
  Monitor: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  Sparkles: () => null,
  Users: () => null,
}))
vi.mock('@renderer/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: { checked: boolean; onCheckedChange: (next: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...rest} />
  ),
}))
// The panel itself is positioned through a portal; the menu content is what these rules are about.
vi.mock('./composer-popover', () => ({
  ComposerPopover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { useSessionCapabilitiesStore } from '@renderer/lib/session-capabilities'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerToolsMenu } from './composer-tools-menu'

const CATALOG = {
  capabilities: [
    { id: 'work-team', available: true, promptTokens: 60, tools: 1 },
    { id: 'pi-ui', available: true, promptTokens: 120, tools: 0 },
    { id: 'browser', available: true, promptTokens: 900, tools: 24, coreTools: 10 },
    { id: 'chrome', available: false, reason: 'chrome-off', promptTokens: 900, tools: 24 },
    { id: 'web-search', available: true, promptTokens: 100, tools: 2 },
    { id: 'computer', available: true, promptTokens: 300, tools: 18 },
  ],
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(async (method: string) => {
    if (method === 'capabilities.catalog') return CATALOG
    if (method === 'pi.settings.get') return { settings: { cacheWarming: 'streaming' } }
    return { ok: true }
  })
  useSessionCapabilitiesStore.setState({ byKey: {}, loaded: true })
  useUIStore.setState({ historySessionFile: '/s.jsonl' })
})

afterEach(cleanup)

const open = async () => {
  render(<ComposerToolsMenu />)
  fireEvent.click(document.querySelector('[data-composer-tools]') as HTMLElement)
  // Opening fetches the catalog; the rows only exist once it lands.
  await waitFor(() => expect(screen.getByText('composer:tools.items.pi-ui.name')).toBeInTheDocument())
}

it('a conversation nobody switched anything in shows the built-in browser', async () => {
  await open()
  const builtin = screen.getByRole('radio', { name: 'composer:tools.browserMode.builtin' })
  expect(builtin).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: 'composer:tools.browserMode.off' })).toHaveAttribute('aria-checked', 'false')
})

it('keeps search and browser status in sync when availability changes', async () => {
  invoke.mockImplementation(async (method: string) => {
    if (method === 'capabilities.catalog') return { capabilities: CATALOG.capabilities.map((cap) =>
      cap.id === 'web-search' || cap.id === 'browser' ? { ...cap, available: false, reason: cap.id === 'browser' ? 'browser-panel-off' : 'web-search-not-installed' } : cap) }
    if (method === 'pi.settings.get') return { settings: { cacheWarming: 'streaming' } }
    return { ok: true }
  })
  render(<ComposerToolsMenu location="status" />)
  fireEvent.click(document.querySelector('[data-composer-tools]') as HTMLElement)
  await waitFor(() => expect(screen.getByRole('switch', { name: 'composer:tools.items.web-search.name' })).toBeDisabled())
  expect(screen.getByRole('switch', { name: 'composer:tools.items.web-search.name' })).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByRole('radio', { name: 'composer:tools.browserMode.off' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText('composer:tools.items.web-search.name ○')).toBeInTheDocument()
  expect(screen.getByText('composer:tools.browserMode.label ○')).toBeInTheDocument()
})

it('switches browser mode with one live update', async () => {
  await open()
  invoke.mockClear()
  fireEvent.click(screen.getByRole('radio', { name: 'composer:tools.browserMode.off' }))
  expect(invoke.mock.calls.filter(([method]) => method === 'capabilities.apply')).toEqual([
    ['capabilities.apply', { sessionFile: '/s.jsonl', capabilities: ['web-search'] }],
  ])
})

it('keeps the cost out of the row text so it cannot push the menu wider', async () => {
  await open()
  // The tool count still reaches the user, but as the row tooltip, not as a visible micro-label.
  const row = screen.getByText('composer:tools.items.pi-ui.name').closest('label')
  await waitFor(() => expect(row?.getAttribute('title')).toContain('composer:tools.items.pi-ui.desc'))
})

it('revokes a capability on the live worker as soon as its switch goes off', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await open()
  const computer = screen.getByRole('switch', { name: 'composer:tools.items.computer.name' })
  fireEvent.click(computer)
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('capabilities.apply', { sessionFile: '/s.jsonl', capabilities: ['browser', 'web-search', 'computer'] }),
  )
  fireEvent.click(computer)
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('capabilities.apply', { sessionFile: '/s.jsonl', capabilities: ['browser', 'web-search'] }),
  )
  expect(useSessionCapabilitiesStore.getState().byKey['/s.jsonl']).toEqual(['browser', 'web-search'])
})

it('keeps work team off for fresh conversations and applies it to this session only', async () => {
  await open()
  const toggle = screen.getByRole('switch', { name: 'composer:tools.items.work-team.name' })
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('capabilities.apply', {
    sessionFile: '/s.jsonl', capabilities: ['browser', 'web-search', 'work-team'],
  }))
})
