import { useTranslation } from 'react-i18next'
import { SettingsPageHeader } from './settings-shell'
import { ImageGenSettings } from './image-gen-settings'

/**
 * 设置 → 生图模型配置。
 *
 * 生图是独立能力（订阅通道 / 自定义 OpenAI 兼容中转 + 画质 / 请求身份 / 提示词增强），
 * 不该挤在「模型」页里跟供应商混在一起，所以拆成单独入口。
 */
export function ImageGenSettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t('imageGen.title')}
        description={t('imageGen.description')}
      />
      <ImageGenSettings showHeading={false} />
    </div>
  )
}
