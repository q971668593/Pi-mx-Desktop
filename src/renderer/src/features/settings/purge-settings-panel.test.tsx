import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PurgeState } from '@shared/ipc-contract'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(method: string, request: unknown) => Promise<PurgeState>>(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
// 只验开关与 IPC 契约，i18n 直接回 key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { message: vi.fn(), error: vi.fn() } }))

import { PurgeSettings } from './purge-settings-panel'

function state(patch: Partial<PurgeState> = {}): PurgeState {
  return {
    enabled: false,
    mode: 'strict',
    source: '',
    configFile: 'C:/agent/purge/config.json',
    extensionFile: 'C:/agent/extensions/pi-app-purge.ts',
    extensionInstalled: true,
    personaFile: 'C:/agent/purge/persona.md',
    personaExists: true,
    personaChars: 20926,
    bundledPersona: true,
    bundledPersonaFile: 'C:/app/resources/purge/persona.md',
    bundledDir: 'C:/app/resources/purge',
    ...patch,
  }
}

describe('PurgeSettings', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('打开时读状态：关闭 -> 拨开写 purge.setEnabled，并立刻反映结果', async () => {
    mocks.invoke.mockImplementation(async (method) => {
      if (method === 'purge.getState') return state()
      if (method === 'purge.setEnabled') return state({ enabled: true })
      throw new Error(`unexpected ${method}`)
    })
    render(<PurgeSettings />)

    const row = await screen.findByRole('group', { name: /settings:purge\.enableLabel/ })
    const toggle = row.querySelector('button[role="switch"]') as HTMLElement | null
    expect(toggle).not.toBeNull()
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))

    await userEvent.click(toggle!)

    expect(mocks.invoke).toHaveBeenCalledWith('purge.setEnabled', { enabled: true })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText('settings:purge.badgeOn')).toBeInTheDocument()
  })

  it('切换接管强度时写 purge.setMode', async () => {
    mocks.invoke.mockImplementation(async (method, request) => {
      if (method === 'purge.getState') return state({ enabled: true })
      if (method === 'purge.setMode') return state({ enabled: true, mode: (request as { mode: PurgeState['mode'] }).mode })
      throw new Error(`unexpected ${method}`)
    })
    render(<PurgeSettings />)

    const select = await screen.findByRole('combobox', { name: 'settings:purge.modeLabel' })
    await userEvent.selectOptions(select, 'replace')

    expect(mocks.invoke).toHaveBeenCalledWith('purge.setMode', { mode: 'replace' })
    await waitFor(() => expect(select).toHaveValue('replace'))
  })

  it('人设缺失时提示导入，而不是假装已就绪', async () => {
    mocks.invoke.mockResolvedValue(state({ enabled: false, personaExists: false, personaChars: 0 }))
    render(<PurgeSettings />)

    expect(await screen.findByText('settings:purge.personaMissing')).toBeInTheDocument()
    expect(screen.getByText('settings:purge.needPersona')).toBeInTheDocument()
  })

  it('扩展没落地时提示重新安装', async () => {
    mocks.invoke.mockResolvedValue(state({ extensionInstalled: false }))
    render(<PurgeSettings />)

    expect(await screen.findByText('settings:purge.extensionMissing')).toBeInTheDocument()
    expect(screen.getByText('settings:purge.needReinstall')).toBeInTheDocument()
  })

  it('点「导入人设」走 purge.choosePersona', async () => {
    mocks.invoke.mockImplementation(async (method) => {
      if (method === 'purge.getState') return state()
      if (method === 'purge.choosePersona') return state({ personaChars: 300 })
      throw new Error(`unexpected ${method}`)
    })
    render(<PurgeSettings />)

    await screen.findByRole('group', { name: /settings:purge\.enableLabel/ })
    await userEvent.click(screen.getByRole('button', { name: 'settings:purge.choosePersona' }))
    expect(mocks.invoke).toHaveBeenCalledWith('purge.choosePersona', {})
  })
})
