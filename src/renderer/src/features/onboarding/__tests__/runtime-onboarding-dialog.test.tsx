import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zhOnboarding from '../../../locales/zh/onboarding.json'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openSettingsPage: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
  onAppEvent: () => () => {},
}))

vi.mock('@renderer/lib/settings-navigation', () => ({
  openSettingsPage: mocks.openSettingsPage,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import i18n from '../../../lib/i18n'
import { RuntimeOnboardingDialog } from '../runtime-onboarding-dialog'

/** 首次启动的运行环境引导：默认中文，且装过的机器不再弹。 */
describe('RuntimeOnboardingDialog', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.openSettingsPage.mockReset()
  })

  it('should_show_chinese_copy_on_a_fresh_machine', async () => {
    await i18n.changeLanguage('zh')
    mocks.invoke.mockImplementation((channel: string) =>
      channel === 'runtime.onboarding.get' ? Promise.resolve({ done: false, mode: null }) : Promise.resolve({}),
    )

    render(<RuntimeOnboardingDialog />)

    expect(await screen.findByText(zhOnboarding.title)).toBeTruthy()
    expect(screen.getByText(zhOnboarding.globalTitle)).toBeTruthy()
    expect(screen.getByText(zhOnboarding.builtinTitle)).toBeTruthy()
    // 一旦出现键名（onboarding:title / title）就说明命名空间又没接上
    expect(screen.queryByText('onboarding:title')).toBeNull()
    expect(screen.queryByText('title')).toBeNull()
  })

  it('should_stay_closed_when_the_machine_already_finished_onboarding', async () => {
    await i18n.changeLanguage('zh')
    mocks.invoke.mockImplementation((channel: string) =>
      channel === 'runtime.onboarding.get' ? Promise.resolve({ done: true, mode: 'global' }) : Promise.resolve({}),
    )

    const { container } = render(<RuntimeOnboardingDialog />)

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('runtime.onboarding.get'))
    expect(container).toBeEmptyDOMElement()
  })

  it('skips the model setup step automatically when an available model already exists', async () => {
    await i18n.changeLanguage('zh')
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'runtime.onboarding.get') return Promise.resolve({ done: false, mode: null })
      if (channel === 'runtime.probe') return Promise.resolve({ node: false, npm: false, pi: false })
      if (channel === 'model.list') {
        return Promise.resolve({ models: [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', available: true }] })
      }
      return Promise.resolve({ ok: true })
    })

    const { container } = render(<RuntimeOnboardingDialog />)
    const builtinBtn = await screen.findByText(zhOnboarding.builtinTitle)
    fireEvent.click(builtinBtn.closest('button')!)

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('runtime.onboarding.complete', { mode: 'builtin' })
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows quick model sign-in options in step 2 when no available model is configured and allows skipping', async () => {
    await i18n.changeLanguage('zh')
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'runtime.onboarding.get') return Promise.resolve({ done: false, mode: null })
      if (channel === 'runtime.probe') return Promise.resolve({ node: true, npm: true, pi: false })
      if (channel === 'model.list') return Promise.resolve({ models: [] })
      if (channel === 'model.auth.providers') {
        return Promise.resolve({
          providers: [
            {
              providerId: 'openai-codex',
              name: 'OpenAI Codex',
              oauth: { supported: true, subscription: true, loginLabel: 'Sign in with ChatGPT' },
              apiKey: { supported: false },
            },
            {
              providerId: 'deepseek',
              name: 'DeepSeek',
              oauth: { supported: false },
              apiKey: { supported: true },
            },
          ],
        })
      }
      return Promise.resolve({ ok: true })
    })

    render(<RuntimeOnboardingDialog />)
    const builtinBtn = await screen.findByText(zhOnboarding.builtinTitle)
    fireEvent.click(builtinBtn.closest('button')!)

    expect(await screen.findByText(zhOnboarding.modelTitle)).toBeTruthy()
    expect(await screen.findByText('OpenAI Codex')).toBeTruthy()
    expect(screen.getByText('DeepSeek')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: zhOnboarding.signInApiKey })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: zhOnboarding.skipModel }))
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('runtime.onboarding.complete', { mode: 'builtin' })
    })
  })
})
