import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sessionFile: 'banner-test-session-one' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/components/icons', () => ({ Monitor: () => null, X: () => null }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async (method: string) => method === 'browser.chrome.status' ? { connected: false } : { tabs: [] }) } }))
vi.mock('@renderer/lib/session-capabilities', () => ({ capabilityKey: (key: string) => key, useSessionCapabilitiesStore: (selector: (state: unknown) => unknown) => selector({ byKey: { 'banner-test-session-one': ['chrome'], 'banner-test-session-two': ['chrome'] } }) }))
vi.mock('@renderer/stores/ui-store', () => ({ useUIStore: (selector: (state: unknown) => unknown) => selector({ historySessionFile: mocks.sessionFile }) }))

import { ChromeModeBanner } from './chrome-mode-banner'

afterEach(cleanup)

it('keeps the Chrome notice dismissed for the same session but shows it for another session', async () => {
  const first = render(<ChromeModeBanner />)
  await waitFor(() => expect(screen.getByText('chromeMode.disconnected')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'common:close' }))
  expect(screen.queryByText('chromeMode.title')).not.toBeInTheDocument()
  first.unmount()
  const second = render(<ChromeModeBanner />)
  expect(screen.queryByText('chromeMode.title')).not.toBeInTheDocument()
  mocks.sessionFile = 'banner-test-session-two'
  second.rerender(<ChromeModeBanner />)
  await waitFor(() => expect(screen.getByText('chromeMode.title')).toBeInTheDocument())
})
