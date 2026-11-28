import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ProviderTemplateDialog } from './provider-template-dialog'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
  onAppEvent: vi.fn(() => () => {}),
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const invoke = vi.mocked(ipcClient.invoke)

const SDK_OPTIONS = [
  { providerId: 'openai', modelCount: 41, accountLabel: 'Signed in', isConfigured: true },
  { providerId: 'opencode-go', modelCount: 31, accountLabel: '', isConfigured: false },
]

function setup() {
  const onLoginProvider = vi.fn()
  const onSelectCustom = vi.fn()
  const onClose = vi.fn()
  invoke.mockImplementation(async (method: string) => {
    if (method === 'model.auth.providers') {
      return {
        providers: [
          { providerId: 'openai', name: 'OpenAI', oauth: { supported: true, loginLabel: 'Sign in with ChatGPT', subscription: true }, apiKey: { supported: false } },
          { providerId: 'opencode-go', name: 'opencode-go', oauth: { supported: false }, apiKey: { supported: true } },
        ],
      }
    }
    return {}
  })
  render(
    <ProviderTemplateDialog
      onClose={onClose}
      onSelectCustom={onSelectCustom}
      sdkOptions={SDK_OPTIONS}
      onLoginProvider={onLoginProvider}
    />,
  )
  return { onLoginProvider, onSelectCustom, onClose }
}

describe('ProviderTemplateDialog', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('renders built-in options with configured badge and login actions', async () => {
    const { onLoginProvider } = setup()
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeTruthy());
    // openai 已配置打勾，oauth 登录按钮变成“重新登录”
    expect(screen.getByText('models.providerConfigured')).toBeTruthy()
    const reloginButtons = screen.getAllByText('models.reloginAction')
    fireEvent.click(reloginButtons[0])
    expect(onLoginProvider).toHaveBeenCalledWith('openai', 'oauth')
    // opencode-go 未配置，走 API Key 登录
    const keyButtons = screen.getAllByText('models.apiKeySignInAction')
    fireEvent.click(keyButtons[0])
    expect(onLoginProvider).toHaveBeenCalledWith('opencode-go', 'api_key')
  })

  it('search filters built-in options and custom card triggers onSelectCustom', async () => {
    const { onSelectCustom } = setup()
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeTruthy());
    const search = screen.getByPlaceholderText('models.searchProviderPlaceholder')
    fireEvent.change(search, { target: { value: 'opencode' } })
    expect(screen.queryByText('OpenAI')).toBeNull()
    expect(screen.getByText('opencode-go')).toBeTruthy()
    fireEvent.click(screen.getByText('models.customProvider'))
    expect(onSelectCustom).toHaveBeenCalledTimes(1)
  })
})
