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
    { id: 'pi-ui', available: true, promptTokens: 120, tools: 0 },
    { id: 'browser', available: true, promptTokens: 900, tools: 24, coreTools: 10 },
    { id: 'chrome', available: false, reason: 'chrome-off', promptTokens: 900, tools: 24 },
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
    expect(invoke).toHaveBeenCalledWith('capabilities.apply', { sessionFile: '/s.jsonl', capabilities: ['browser', 'computer'] }),
  )
  fireEvent.click(computer)
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('capabilities.apply', { sessionFile: '/s.jsonl', capabilities: ['browser'] }),
  )
  expect(useSessionCapabilitiesStore.getState().byKey['/s.jsonl']).toEqual(['browser'])
})
