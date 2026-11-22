import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AppUpdateCheckResult } from '@shared/app-update'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings, GeneralSettings } from './settings-general-appearance'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  translate: vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  ),
  showAppUpdateDialog: vi.fn(),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: mocks.translate }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
}))

vi.mock('@renderer/lib/app-update-notify', () => ({
  showAppUpdateDialog: mocks.showAppUpdateDialog,
}))

vi.mock('@renderer/features/settings/settings-draft-context', () => ({
  useSettingsDraft: () => ({
    draft: {
      autoOpenLastProject: false,
      builtinBillionContext: true,
      autoCheckRegistryUpdates: true,
      includePrereleaseUpdates: false,
      alertSoundEnabled: false,
      alertSoundPreset: 'chime',
      alertSoundVolume: 100,
      alertNotificationEnabled: false,
      alertOnExtensionUi: false,
      alertOnRunIdle: false,
      alertOnBackgroundRunIdle: false,
      alertOnRunFailed: true,
      aiActivityGlowEnabled: true,
      completionNotificationTimeoutSeconds: 15,
      completionNotificationPreview: 'response',
      completionNotificationOnlyWhenUnfocused: true,
      completionNotificationDndUntil: null,
      completionNotificationDelivery: 'auto',
      maxSessionWorkers: 2,
      sessionWorkerIdleTimeoutMinutes: 10,
      language: 'en',
      theme: 'system',
      iconTheme: 'phosphor',
      timelineVisibleTurns: 10,
      timelineMaxAutoExpandedTools: 4,
    },
    setAutoOpenLastProject: vi.fn(),
    setAutoCheckRegistryUpdates: vi.fn(),
    setIncludePrereleaseUpdates: vi.fn(),
    setLanguage: vi.fn(),
    setAlertSoundEnabled: vi.fn(),
    setAlertSoundPreset: vi.fn(),
    setAlertSoundVolume: vi.fn(),
    setAlertNotificationEnabled: vi.fn(),
    setAlertOnExtensionUi: vi.fn(),
    setAlertOnRunIdle: vi.fn(),
    setAlertOnBackgroundRunIdle: vi.fn(),
    setAlertOnRunFailed: vi.fn(),
    setCompletionNotificationTimeoutSeconds: vi.fn(),
    setCompletionNotificationPreview: vi.fn(),
    setCompletionNotificationOnlyWhenUnfocused: vi.fn(),
    setCompletionNotificationDndMinutes: vi.fn(),
    setCompletionNotificationDelivery: vi.fn(),
    setMaxSessionWorkers: vi.fn(),
    setSessionWorkerIdleTimeoutMinutes: vi.fn(),
    setTheme: vi.fn(),
    setIconTheme: vi.fn(),
    setCustomTheme: vi.fn(),
    setBackground: vi.fn(),
    setTimelineVisibleTurns: vi.fn(),
    setTimelineMaxAutoExpandedTools: vi.fn(),
  }),
}))

vi.mock('@renderer/features/settings/pi-settings-panel', () => ({ PiSettingsPanel: () => null }))
vi.mock('@renderer/features/settings/appearance-theme-editor', () => ({ AppearanceThemeEditor: () => null }))
vi.mock('@renderer/features/settings/appearance-background', () => ({ AppearanceBackground: () => null }))
vi.mock('@renderer/features/settings/runtime-settings-panel', () => ({ RuntimeSettingsPanel: () => null }))

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function checkUpdateButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /settings:general\.(checkUpdate|checking)/,
  }) as HTMLButtonElement
}

function clickCheckUpdate(): void {
  fireEvent.click(checkUpdateButton())
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.translate.mockClear()
  mocks.showAppUpdateDialog.mockReset()
  mocks.invoke.mockImplementation((method: string) => {
    if (method === 'settings.get') return Promise.resolve({ settings: {} })
    if (method === 'desktop.appName') return Promise.resolve({ name: 'Pi mx Desktop', version: '0.1.0' })
    if (method === 'model.list') return Promise.resolve({ models: [] })
    return Promise.resolve({ status: 'error' })
  })
})

describe('GeneralSettings manual update feedback', () => {
  it('consumes a terminal result after the StrictMode effect remount', async () => {
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return Promise.resolve({ status: 'up-to-date', currentVersion: '0.5.6', latestVersion: '0.5.6' })
    })
    render(
      <StrictMode>
        <GeneralSettings />
      </StrictMode>,
    )

    clickCheckUpdate()

    expect(await screen.findByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    expect(checkUpdateButton()).toHaveAttribute('aria-busy', 'false')
  })

  it('consumes an immediate terminal result from the invoked check', async () => {
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return Promise.resolve({ status: 'up-to-date', currentVersion: '0.5.6', latestVersion: '0.5.6' })
    })
    render(<GeneralSettings />)

    clickCheckUpdate()

    expect(await screen.findByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    expect(checkUpdateButton()).toHaveAttribute('aria-busy', 'false')
    expect(mocks.showAppUpdateDialog).not.toHaveBeenCalled()
  })

  it('renders a failed terminal result with a classified reason, never the raw network detail', async () => {
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return Promise.resolve({ status: 'error', reason: 'rate_limit' })
    })
    render(<GeneralSettings />)

    clickCheckUpdate()

    expect(
      await screen.findByText(
        'settings:general.updateCheckFailedReason:{"reason":"settings:general.updateFailReason_rate_limit"}',
      ),
    ).toBeInTheDocument()
    // 限流的原始响应和代理地址只留在主进程日志里，不进界面。
    expect(document.body.textContent).not.toContain('http_403')
    expect(checkUpdateButton()).toHaveAttribute('aria-busy', 'false')
  })

  it('opens the existing dialog for an available update', async () => {
    const update = {
      currentVersion: '0.5.6',
      latestVersion: '0.5.7',
      releaseUrl: 'https://example.test/releases/0.5.7',
      releaseNotes: 'Fixes',
      downloadUrl: 'https://example.test/setup.exe',
      downloadName: 'setup.exe',
      assets: [],
    }
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      return Promise.resolve({ status: 'available', update })
    })
    render(<GeneralSettings />)

    clickCheckUpdate()

    await waitFor(() => expect(mocks.showAppUpdateDialog).toHaveBeenCalledWith(update))
    expect(mocks.translate).toHaveBeenCalledWith('settings:general.updateHasNew', {
      version: '0.5.7',
      current: '0.5.6',
    })
  })

  it('ignores an older check that resolves after the current attempt', async () => {
    const first = deferred<AppUpdateCheckResult>()
    const second = deferred<AppUpdateCheckResult>()
    let checkCount = 0
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      if (method === 'desktop.appName') return Promise.resolve({ name: 'Pi mx Desktop', version: '0.1.0' })
      if (method === 'app.checkUpdate') {
        checkCount += 1
        return checkCount === 1 ? first.promise : second.promise
      }
      return Promise.resolve({})
    })
    render(<GeneralSettings />)

    const button = checkUpdateButton()
    fireEvent.click(button)
    expect(checkCount).toBe(1)
    fireEvent.click(button)
    expect(checkCount).toBe(2)
    await act(async () => {
      second.resolve({ status: 'up-to-date', currentVersion: '0.5.6', latestVersion: '0.5.6' })
    })
    expect(await screen.findByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    await act(async () => {
      first.resolve({ status: 'error' })
    })

    expect(screen.getByText('settings:general.updateLatest:{"version":"0.5.6"}')).toBeInTheDocument()
    expect(screen.queryByText('settings:general.updateCheckFailed')).not.toBeInTheDocument()
  })

  it('does not consume a pending result after unmount', async () => {
    const pending = deferred<AppUpdateCheckResult>()
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      if (method === 'desktop.appName') return Promise.resolve({ name: 'Pi mx Desktop', version: '0.1.0' })
      if (method === 'model.list') return Promise.resolve({ models: [] })
      return pending.promise
    })
    const view = render(<GeneralSettings />)
    clickCheckUpdate()

    view.unmount()
    await act(async () => {
      pending.resolve({
        status: 'available',
        update: {
          currentVersion: '0.5.6',
          latestVersion: '0.5.7',
          releaseUrl: 'https://example.test/releases/0.5.7',
          releaseNotes: 'Fixes',
          downloadUrl: null,
          downloadName: null,
          assets: [],
        },
      })
    })

    expect(mocks.showAppUpdateDialog).not.toHaveBeenCalled()
  })
})

describe('GeneralSettings sidebar section', () => {
  /** 侧栏标题行里那两个看不懂的小开关搬到这里：文案 + 标准 Switch。 */
  it('exposes both sidebar behaviours as labelled switches', async () => {
    mocks.invoke.mockImplementation((method: string, payload?: { key?: string }) => {
      if (method === 'settings.get') {
        if (payload?.key === 'recentProjectsFixedOrder') {
          return Promise.resolve({ settings: { recentProjectsFixedOrder: true } })
        }
        if (payload?.key === 'sessionTitleFollowsLatest') {
          return Promise.resolve({ settings: { sessionTitleFollowsLatest: true } })
        }
        return Promise.resolve({ settings: {} })
      }
      return Promise.resolve({ ok: true })
    })
    render(<GeneralSettings />)

    const section = screen.getByText('settings:general.sidebarSection').closest('section')!
    expect(section).not.toBeNull()
    expect(within(section as HTMLElement).getByText('settings:general.titleFollowsLatestDesc')).toBeInTheDocument()

    const switches = within(section as HTMLElement).getAllByRole('switch')
    expect(switches).toHaveLength(2)
    // 两个开关的当前状态必须一眼可读（而不是挤在标题行里的迷你轨道）
    await waitFor(() => expect(switches[0]).toHaveAttribute('aria-checked', 'true'))
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(switches[0])
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('settings.set', {
        key: 'sessionTitleFollowsLatest',
        value: false,
      }),
    )
    fireEvent.click(switches[1])
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('settings.set', {
        key: 'recentProjectsFixedOrder',
        value: false,
      }),
    )
  })

  it('displays the current app version badge next to the app version row', async () => {
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      if (method === 'desktop.appName') return Promise.resolve({ name: 'Pi mx Desktop', version: '0.5.9' })
      if (method === 'model.list') return Promise.resolve({ models: [] })
      return Promise.resolve({ status: 'error' })
    })
    render(<GeneralSettings />)

    expect(await screen.findByText('v0.5.9')).toBeInTheDocument()
    expect(screen.getByLabelText('settings:readiness.title')).toBeInTheDocument()
  })

  it('exposes reset defaults action on AppearanceSettings with confirmation dialog', () => {
    render(<AppearanceSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'settings:appearance.resetDefaults' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
