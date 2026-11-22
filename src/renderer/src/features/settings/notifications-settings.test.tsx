import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationsSettings } from './notifications-settings'
import { SettingsSearchContext } from './settings-page-shared'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  translate: vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  ),
  setAlertSoundEnabled: vi.fn(),
  setAlertNotificationEnabled: vi.fn(),
  setAlertOnRunIdle: vi.fn(),
  setAlertOnRunFailed: vi.fn(),
  setCompletionNotificationOnlyWhenUnfocused: vi.fn(),
  setCompletionNotificationDndMinutes: vi.fn(),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: mocks.translate }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
}))

vi.mock('@renderer/lib/alert-sound', () => ({
  previewAlertSound: vi.fn(),
}))

vi.mock('@renderer/features/settings/settings-draft-context', () => ({
  useSettingsDraft: () => ({
    draft: {
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
    },
    setAlertSoundEnabled: mocks.setAlertSoundEnabled,
    setAlertSoundPreset: vi.fn(),
    setAlertSoundVolume: vi.fn(),
    setAlertNotificationEnabled: mocks.setAlertNotificationEnabled,
    setAlertOnExtensionUi: vi.fn(),
    setAlertOnRunIdle: mocks.setAlertOnRunIdle,
    setAlertOnBackgroundRunIdle: vi.fn(),
    setAlertOnRunFailed: mocks.setAlertOnRunFailed,
    setAiActivityGlowEnabled: vi.fn(),
    setCompletionNotificationTimeoutSeconds: vi.fn(),
    setCompletionNotificationPreview: vi.fn(),
    setCompletionNotificationOnlyWhenUnfocused: mocks.setCompletionNotificationOnlyWhenUnfocused,
    setCompletionNotificationDndMinutes: mocks.setCompletionNotificationDndMinutes,
    setCompletionNotificationDelivery: vi.fn(),
  }),
}))

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.invoke.mockResolvedValue({ ok: true })
  mocks.setAlertSoundEnabled.mockReset()
  mocks.setAlertNotificationEnabled.mockReset()
  mocks.setAlertOnRunIdle.mockReset()
  mocks.setAlertOnRunFailed.mockReset()
  mocks.setCompletionNotificationOnlyWhenUnfocused.mockReset()
  mocks.setCompletionNotificationDndMinutes.mockReset()
})

describe('NotificationsSettings', () => {
  it('applies one-click scenario presets', () => {
    render(<NotificationsSettings />)

    fireEvent.click(screen.getByRole('radio', { name: /settings:notifications\.presetStandard/ }))
    expect(mocks.setAlertNotificationEnabled).toHaveBeenCalledWith(true)
    expect(mocks.setAlertSoundEnabled).toHaveBeenCalledWith(true)
    expect(mocks.setCompletionNotificationOnlyWhenUnfocused).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('radio', { name: /settings:notifications\.presetSoundOnly/ }))
    expect(mocks.setAlertNotificationEnabled).toHaveBeenCalledWith(false)
    expect(mocks.setAlertSoundEnabled).toHaveBeenCalledWith(true)
  })

  it('exposes selected semantics for completion notification segments when rules are expanded', () => {
    render(<NotificationsSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'settings:notifications.rulesShow' }))

    expect(screen.getByRole('button', { name: 'settings:general.alertPreview.response' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'settings:general.alertPreview.fixed' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'settings:general.alertDelivery.auto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'settings:general.alertDnd.off' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('auto-expands custom rules when search matches inside them', () => {
    render(
      <SettingsSearchContext.Provider value="alertDelivery">
        <NotificationsSettings />
      </SettingsSearchContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'settings:general.alertDelivery.auto' })).toBeInTheDocument()
  })

  it('shows feedback for a test completion notification', async () => {
    render(<NotificationsSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'settings:notifications.rulesShow' }))
    fireEvent.click(screen.getByRole('button', { name: 'settings:general.alertTestAction' }))

    expect(await screen.findByRole('status')).toHaveTextContent('settings:general.alertTestSent')
  })
})
