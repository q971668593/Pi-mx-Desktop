import { describe, expect, it } from 'vitest'
import zhOnboarding from '../../locales/zh/onboarding.json'
import enOnboarding from '../../locales/en/onboarding.json'
import i18n from '../i18n'

describe('首次启动的运行环境引导（onboarding 命名空间）', () => {
  it('should_ship_the_onboarding_namespace_so_the_dialog_is_not_raw_keys', () => {
    expect(i18n.hasResourceBundle('zh', 'onboarding')).toBe(true)
    expect(i18n.hasResourceBundle('en', 'onboarding')).toBe(true)
  })

  it('should_render_chinese_by_default', async () => {
    await i18n.changeLanguage('zh')
    expect(i18n.t('onboarding:title')).toBe(zhOnboarding.title)
    expect(i18n.t('onboarding:globalTitle')).toBe(zhOnboarding.globalTitle)
    expect(i18n.t('onboarding:useGlobal')).toBe(zhOnboarding.useGlobal)
  })

  it('should_switch_to_english_when_the_user_picks_english', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('onboarding:title')).toBe(enOnboarding.title)
    await i18n.changeLanguage('zh')
  })
})
