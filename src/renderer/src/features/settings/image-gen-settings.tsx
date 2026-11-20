import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { DEFAULT_IMAGE_GEN_CONFIG, normalizeImageGenConfig, type ImageGenConfig } from '@shared/image-gen'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { btnOutline, btnPrimary, inputCls, selectCls } from './settings-controls'

/** invoke 在某些测试/受限环境下可能返回非 Promise：统一兜一层，别让页面挂掉。 */
type IpcReply = {
  config?: unknown
  status?: Status
  models?: unknown
  images?: Array<{ rel?: string }>
}

function call(channel: string, request?: unknown): Promise<IpcReply | null> {
  try {
    return Promise.resolve(ipcClient.invoke(channel, request) as Promise<IpcReply>).catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

type Status = {
  provider: ImageGenConfig['provider']
  active: boolean
  codexAuthorized: boolean
  codexExpiresAt: number | null
  models?: string[]
}

/**
 * 设置 → 模型 → 生图。
 *
 * 把生图收进应用自己的设置：选 ChatGPT 订阅（复用本机 ~/.codex/auth.json）或任意
 * OpenAI 兼容中转。配好之后 agent 用内置的 `image_gen`，不必再挂 MCP 生图工具。
 */
export function ImageGenSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ImageGenConfig>(DEFAULT_IMAGE_GEN_CONFIG)
  const [status, setStatus] = useState<Status | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [testPrompt, setTestPrompt] = useState('')
  const [testing, setTesting] = useState(false)

  const load = async () => {
    const res = await call('imageGen.status')
    if (res?.config) setConfig(normalizeImageGenConfig(res.config))
    if (res?.status) {
      setStatus(res.status)
      setModels(Array.isArray(res.status.models) ? res.status.models : [])
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async (next: ImageGenConfig) => {
    const normalized = normalizeImageGenConfig(next)
    setConfig(normalized)
    setSaving(true)
    try {
      const res = await call('imageGen.config.set', {
        provider: normalized.provider,
        model: normalized.model,
        baseUrl: normalized.baseUrl,
        apiKey: normalized.apiKey,
        size: normalized.size,
        quality: normalized.quality,
        identity: normalized.identity,
        outputDir: normalized.outputDir,
        promptEnhance: normalized.promptEnhance,
      })
      if (res?.config) setConfig(normalizeImageGenConfig(res.config))
      toast.success(t('settings:imageGen.saved'))
      await load()
    } catch (error) {
      toast.error(t('settings:imageGen.saveFailed'), { description: String((error as Error)?.message || error) })
    } finally {
      setSaving(false)
    }
  }

  const refreshModels = async () => {
    const res = await call('imageGen.models', { refresh: true })
    setModels(Array.isArray(res?.models) ? res.models : [])
  }

  const runTest = async () => {
    if (!testPrompt.trim()) return
    const workspaceId = (await import('@renderer/stores/ui-store')).useUIStore.getState().currentWorkspace
    if (!workspaceId) {
      toast.error(t('settings:imageGen.noWorkspace'))
      return
    }
    setTesting(true)
    try {
      const res = await call('imageGen.generate', { workspaceId, prompt: testPrompt.trim(), quality: config.quality })
      if (!res) throw new Error('imageGen.generate failed')
      const first = res?.images?.[0]
      toast.success(t('settings:imageGen.testDone'), { description: first?.rel || '' })
      setTestPrompt('')
    } catch (error) {
      toast.error(t('settings:imageGen.testFailed'), { description: String((error as Error)?.message || error) })
    } finally {
      setTesting(false)
    }
  }

  const expiry = status?.codexExpiresAt ? new Date(status.codexExpiresAt).toLocaleString() : ''
  const modelOptions = [...new Set([config.model, ...models].filter(Boolean))]

  return (
    <SettingsSection title={t('settings:imageGen.title')} description={t('settings:imageGen.description')}>
      <SettingRow label={t('settings:imageGen.provider')} description={t('settings:imageGen.providerHint')}>
        <select
          className={selectCls}
          aria-label={t('settings:imageGen.provider')}
          value={config.provider}
          onChange={(event) => void save({ ...config, provider: event.target.value as ImageGenConfig['provider'] })}
          disabled={saving}
        >
          <option value="off">{t('settings:imageGen.providerOff')}</option>
          <option value="codex">{t('settings:imageGen.providerCodex')}</option>
          <option value="custom">{t('settings:imageGen.providerCustom')}</option>
        </select>
      </SettingRow>

      {config.provider === 'codex' ? (
        <SettingRow
          label={t('settings:imageGen.auth')}
          description={t('settings:imageGen.authHint')}
          badge={
            <span className={status?.codexAuthorized ? 'text-emerald-600' : 'text-amber-600'}>
              {status?.codexAuthorized ? t('settings:imageGen.authorized') : t('settings:imageGen.notAuthorized')}
            </span>
          }
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{expiry ? t('settings:imageGen.expiresAt', { time: expiry }) : '—'}</span>
            <button type="button" className={btnOutline} onClick={() => void load()}>
              {t('settings:imageGen.recheck')}
            </button>
          </div>
        </SettingRow>
      ) : null}

      {config.provider !== 'off' ? (
        <SettingRow
          label={t('settings:imageGen.model')}
          description={config.provider === 'codex' ? t('settings:imageGen.modelHintCodex') : t('settings:imageGen.modelHintCustom')}
        >
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              aria-label={t('settings:imageGen.model')}
              list="image-gen-models"
              value={config.model}
              placeholder={config.provider === 'codex' ? 'gpt-image-2' : 'gpt-image-1'}
              onChange={(event) => setConfig({ ...config, model: event.target.value })}
              onBlur={() => void save(config)}
            />
            <datalist id="image-gen-models">
              {modelOptions.map((model) => <option key={model} value={model} />)}
            </datalist>
            {config.provider === 'codex' ? (
              <button type="button" className={btnOutline} onClick={() => void refreshModels()}>
                {t('settings:imageGen.syncModels')}
              </button>
            ) : null}
          </div>
        </SettingRow>
      ) : null}

      {config.provider === 'custom' ? (
        <>
          <SettingRow label={t('settings:imageGen.baseUrl')} description={t('settings:imageGen.baseUrlHint')}>
            <input
              className={inputCls}
              aria-label={t('settings:imageGen.baseUrl')}
              value={config.baseUrl}
              placeholder="https://host/v1"
              onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
              onBlur={() => void save(config)}
            />
          </SettingRow>
          <SettingRow label={t('settings:imageGen.apiKey')} description={t('settings:imageGen.apiKeyHint')}>
            <input
              className={inputCls}
              aria-label={t('settings:imageGen.apiKey')}
              type="password"
              value={config.apiKey}
              onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
              onBlur={() => void save(config)}
            />
          </SettingRow>
        </>
      ) : null}

      {config.provider !== 'off' ? (
        <>
          <SettingRow label={t('settings:imageGen.quality')} description={t('settings:imageGen.qualityHint')}>
            <select
              className={selectCls}
              aria-label={t('settings:imageGen.quality')}
              value={config.quality}
              onChange={(event) => void save({ ...config, quality: event.target.value as ImageGenConfig['quality'] })}
            >
              <option value="auto">{t('settings:imageGen.qualityAuto')}</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
              <option value="max">max</option>
            </select>
          </SettingRow>
          <SettingRow label={t('settings:imageGen.identity')} description={t('settings:imageGen.identityHint')}>
            <select
              className={selectCls}
              aria-label={t('settings:imageGen.identity')}
              value={config.identity}
              onChange={(event) => void save({ ...config, identity: event.target.value as ImageGenConfig['identity'] })}
            >
              <option value="web">{t('settings:imageGen.identityWeb')}</option>
              <option value="codex">{t('settings:imageGen.identityCodex')}</option>
            </select>
          </SettingRow>
          {/*
            不设「默认尺寸」：一次横版一次竖版是常态，全局默认只会互相打架。
            agent 调用时按需求传 size；不传就是 auto（服务端按内容决定）。
          */}
          <SettingRow label={t('settings:imageGen.promptEnhance')} description={t('settings:imageGen.promptEnhanceHint')}>
            <select
              className={selectCls}
              aria-label={t('settings:imageGen.promptEnhance')}
              value={config.promptEnhance}
              onChange={(event) =>
                void save({ ...config, promptEnhance: event.target.value as ImageGenConfig['promptEnhance'] })
              }
            >
              <option value="auto">{t('settings:imageGen.promptEnhanceAuto')}</option>
              <option value="off">{t('settings:imageGen.promptEnhanceOff')}</option>
            </select>
          </SettingRow>
          <SettingRow label={t('settings:imageGen.outputDir')} description={t('settings:imageGen.outputDirHint')}>
            <input
              className={inputCls}
              aria-label={t('settings:imageGen.outputDir')}
              value={config.outputDir}
              onChange={(event) => setConfig({ ...config, outputDir: event.target.value })}
              onBlur={() => void save(config)}
            />
          </SettingRow>
          <SettingRow label={t('settings:imageGen.try')} description={t('settings:imageGen.tryHint')}>
            <div className="flex items-center gap-2">
              <input
                className={inputCls}
                aria-label={t('settings:imageGen.try')}
                value={testPrompt}
                placeholder={t('settings:imageGen.tryPlaceholder')}
                onChange={(event) => setTestPrompt(event.target.value)}
              />
              <button type="button" className={btnPrimary} disabled={testing || !testPrompt.trim()} onClick={() => void runTest()}>
                {testing ? t('settings:imageGen.testing') : t('settings:imageGen.test')}
              </button>
            </div>
          </SettingRow>
        </>
      ) : null}
    </SettingsSection>
  )
}
