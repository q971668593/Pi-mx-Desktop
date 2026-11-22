import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDraftProvider, useSettingsDraft } from './settings-draft-context'
import { SettingsSaveBar } from './settings-save-bar'
import { useSettingsDirtySlice } from './use-settings-dirty-slice'

const invokeMock = vi.fn()

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}))

function Probe({ externalDirty = false }: { externalDirty?: boolean }) {
  const { setTheme, setAgentRuntime } = useSettingsDraft()
  useSettingsDirtySlice({
    id: 'test-external',
    label: 'External Slice',
    isDirty: () => externalDirty,
    commit: vi.fn(async () => {}),
    discard: vi.fn(),
  })
  return (
    <div>
      <button type="button" onClick={() => setTheme('dark')}>
        change-theme
      </button>
      <button type="button" onClick={() => setAgentRuntime({ mode: 'wsl', distro: 'Ubuntu' })}>
        change-runtime
      </button>
    </div>
  )
}

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (method: string) => {
    if (method === 'settings.get') return { settings: { theme: 'light' } }
    if (method === 'rightPanels.catalog') return { catalog: [] }
    return { ok: true }
  })
})

describe('SettingsDraftProvider auto-save & SettingsSaveBar', () => {
  it('auto-saves regular preference changes without rendering the manual save bar', async () => {
    render(
      <SettingsDraftProvider>
        <Probe />
        <SettingsSaveBar />
      </SettingsDraftProvider>,
    )

    const themeBtn = await screen.findByRole('button', { name: 'change-theme' })
    expect(screen.queryByRole('button', { name: 'common:save' })).not.toBeInTheDocument()

    act(() => {
      themeBtn.click()
    })

    expect(screen.queryByRole('button', { name: 'common:save' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('settings.set', { key: 'theme', value: 'dark' })
    })
    expect(await screen.findByRole('status')).toHaveTextContent('common:autoSaved')
  })

  it('shows the manual save bar when agentRuntime or an external dirty slice changes', async () => {
    const view = render(
      <SettingsDraftProvider>
        <Probe externalDirty={false} />
        <SettingsSaveBar />
      </SettingsDraftProvider>,
    )

    const runtimeBtn = await screen.findByRole('button', { name: 'change-runtime' })
    act(() => {
      runtimeBtn.click()
    })
    expect(await screen.findByRole('button', { name: 'common:save' })).toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: 'common:discard' }).click()
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'common:save' })).not.toBeInTheDocument()
    })

    view.rerender(
      <SettingsDraftProvider>
        <Probe externalDirty={true} />
        <SettingsSaveBar />
      </SettingsDraftProvider>,
    )
    expect(await screen.findByRole('button', { name: 'common:save' })).toBeInTheDocument()
  })
})
