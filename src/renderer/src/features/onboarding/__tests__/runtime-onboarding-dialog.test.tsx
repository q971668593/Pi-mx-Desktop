import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zhOnboarding from '../../../locales/zh/onboarding.json'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import i18n from '../../../lib/i18n'
import { RuntimeOnboardingDialog } from '../runtime-onboarding-dialog'

/** 首次启动的运行环境引导：默认中文，且装过的机器不再弹。 */
describe('RuntimeOnboardingDialog', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
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
})
