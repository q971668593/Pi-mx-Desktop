import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { DEFAULT_IMAGE_GEN_CONFIG, normalizeImageGenConfig, type ImageGenConfig } from '@shared/image-gen'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { btnOutline, btnPrimary, inputCls, selectCls } from './settings-controls'

/** 生图页右侧输入框加宽：SettingRow 右列是内容撑宽，input 的 w-full 在这里撑不起来，得给最小宽。 */
const wideInputCls = `${inputCls} min-w-[16rem] sm:min-w-[22rem]`

/** invoke 在某些测试/受限环境下可能返回非 Promise：统一兜一层，别让页面挂掉。 */
type IpcReply = {
  config?: unknown
  status?: Status
  models?: unknown
  pulled?: unknown
  fetchError?: unknown
  rawPreview?: unknown
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
 * 设置 → 生图模型配置。
 *
 * 把生图收进应用自己的设置：选 ChatGPT 订阅（复用本机 ~/.codex/auth.json）或任意
 * OpenAI 兼容中转。配好之后 agent 用内置的 `image_gen`，不必再挂 MCP 生图工具。
 *
 * 作为独立设置页时，标题由 `SettingsPageHeader` 负责，这里不再重复渲染 section 标题。
 */
export function ImageGenSettings({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ImageGenConfig>(DEFAULT_IMAGE_GEN_CONFIG)
  const [status, setStatus] = useState<Status | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [testPrompt, setTestPrompt] = useState('')
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [testImage, setTestImage] = useState<{ url: string; rel: string } | null>(null)
  const [lastSync, setLastSync] = useState<{
    count: number
    models: string[]
    raw: string
    pulled: boolean
  } | null>(null)

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
    const list = Array.isArray(res?.models) ? (res.models as string[]) : []
    setModels(list)
    const pulled = res?.pulled === true
    const raw = typeof res?.rawPreview === 'string' ? res.rawPreview : ''
    setLastSync({ count: pulled ? list.length : 0, models: list.slice(0, 30), raw, pulled })
    if (!pulled) {
      const err =
        typeof res?.fetchError === 'string' && res.fetchError ? res.fetchError : '没拉到，用已填模型继续'
      toast.error('模型列表没拉到', { description: err })
    } else if (list.length) {
      toast.success(`拉到 ${list.length} 个模型，下拉框里选就行`)
    }
  }

  const runTest = async () => {
    if (!testPrompt.trim()) return
    const workspaceId = (await import('@renderer/stores/ui-store')).useUIStore.getState().currentWorkspace
    if (!workspaceId) {
      toast.error(t('settings:imageGen.noWorkspace'))
      return
    }
    setTesting(true)
    setTestError(null)
    setTestImage(null)
    try {
      // 生成接口走原始 invoke：失败原因（HTTP 状态 + 服务端回执）必须原样抛出来，
      // 不能像其它读取接口那样吞成 null，否则只剩一句 generate failed，没法定位。
      const res = (await ipcClient.invoke('imageGen.generate', {
        workspaceId,
        prompt: testPrompt.trim(),
        quality: config.quality,
      })) as unknown as { images?: Array<{ rel?: string; path?: string }>; prompt?: unknown; warnings?: string[] }
      const first = res?.images?.[0]
      const rel = typeof first?.rel === 'string' ? first.rel : ''
      if (!rel) throw new Error('生图服务没有返回图片')
      // 直接读图预览：和时间线共用 shell.readImagePreview，不用跳目录找文件。
      try {
        const preview = (await ipcClient.invoke('shell.readImagePreview', {
          workspaceRoot: workspaceId,
          path: rel,
        })) as unknown as { ok?: boolean; dataUrl?: string }
        if (preview?.ok && preview?.dataUrl) setTestImage({ url: String(preview.dataUrl), rel })
      } catch {
        // 预览失败不影响主流程，至少把路径告诉用户。
      }
      toast.success(t('settings:imageGen.testDone'), { description: rel })
      } catch (error) {
      const raw = String((error as Error)?.message || error)
      const message = raw.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
      setTestError(message)
      toast.error(t('settings:imageGen.testFailed'), { description: message })
    } finally {
      setTesting(false)
    }
  }

  const expiry = status?.codexExpiresAt ? new Date(status.codexExpiresAt).toLocaleString() : ''
  // 自定义中转不限制模型：输入框随便填，下拉只给提示（APIMart 这类网关模型很多，拉不到全量列表）。
  const CUSTOM_MODEL_HINTS = [
    'gpt-image-1.5',
    'gpt-image-2.5',
    'Nano-banana',
    'Nano-banana-Pro',
    'Seedream-4.5',
    'Flux-2.0',
  ]
  const modelOptions =
    config.provider === 'custom'
      ? [...new Set([config.model, ...models, ...CUSTOM_MODEL_HINTS].filter(Boolean))]
      : [...new Set([config.model, ...models].filter(Boolean))]

  return (
    <Section title={t('settings:imageGen.title')} description={t('settings:imageGen.description')} showHeading={showHeading}>
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
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                className={wideInputCls}
                aria-label={t('settings:imageGen.model')}
                list="image-gen-models"
                value={config.model}
                placeholder={config.provider === 'codex' ? 'gpt-image-2' : 'gpt-image-1.5，可直接输入 APIMart 模型名'}
                onChange={(event) => setConfig({ ...config, model: event.target.value })}
                onBlur={(event) => void save({ ...config, model: event.target.value })}
              />
              <datalist id="image-gen-models">
                {modelOptions.map((model) => <option key={model} value={model} />)}
              </datalist>
              <button type="button" className={btnOutline} onClick={() => void refreshModels()}>
                {t('settings:imageGen.syncModels')}
              </button>
            </div>
            {lastSync ? (
              <div className="rounded-lg border border-border/60 bg-muted/40 p-2 text-xs leading-5">
                <div className="font-medium">
                  {lastSync.pulled ? `同步到 ${lastSync.count} 个模型：` : '没拉到（用的已填模型）：'}
                </div>
                <div className="break-all">{lastSync.models.join('、') || '（空）'}</div>
                {lastSync.raw ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">看原始报文</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                      {lastSync.raw}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </SettingRow>
      ) : null}

      {config.provider === 'custom' ? (
        <>
          <SettingRow label={t('settings:imageGen.baseUrl')} description={t('settings:imageGen.baseUrlHint')}>
            <input
              className={wideInputCls}
              aria-label={t('settings:imageGen.baseUrl')}
              value={config.baseUrl}
              placeholder="https://api.apimart.ai/v1"
              onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
              onBlur={(event) => void save({ ...config, baseUrl: event.target.value })}
            />
          </SettingRow>
          <SettingRow label={t('settings:imageGen.apiKey')} description={t('settings:imageGen.apiKeyHint')}>
            <input
              className={wideInputCls}
              aria-label={t('settings:imageGen.apiKey')}
              type="password"
              value={config.apiKey}
              onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
              onBlur={(event) => void save({ ...config, apiKey: event.target.value })}
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
          {config.provider === 'codex' ? (
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
          ) : null}
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
              className={wideInputCls}
              aria-label={t('settings:imageGen.outputDir')}
              value={config.outputDir}
              onChange={(event) => setConfig({ ...config, outputDir: event.target.value })}
              onBlur={(event) => void save({ ...config, outputDir: event.target.value })}
            />
          </SettingRow>
          <SettingRow label={t('settings:imageGen.try')} description={t('settings:imageGen.tryHint')}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  className={wideInputCls}
                  aria-label={t('settings:imageGen.try')}
                  value={testPrompt}
                  placeholder={t('settings:imageGen.tryPlaceholder')}
                  onChange={(event) => setTestPrompt(event.target.value)}
                />
                <button type="button" className={btnPrimary} disabled={testing || !testPrompt.trim()} onClick={() => void runTest()}>
                  {testing ? t('settings:imageGen.testing') : t('settings:imageGen.test')}
                </button>
              </div>
              {testError ? (
                <div className="rounded-lg border border-red-300/60 bg-red-50 p-2 text-xs leading-5 text-red-800 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-200">
                  <div className="font-medium">失败原因：</div>
                  <div className="break-all whitespace-pre-wrap">{testError}</div>
                  {/model_not_found|is not supported by any|MODEL_NOT_FOUND/i.test(testError) ? (
                    <div className="mt-1 opacity-80">这个分组不认你填的模型名：去后台看看分组里配了哪些模型，照着名字原样填（比如分组叫 GPT-生图，就找它对应的模型 ID）。</div>
                  ) : /404|No such|not found|images\/generations/i.test(testError) ? (
                    <div className="mt-1 opacity-80">多数 404 都是中转地址少了 /v1：改成 https://apexapi.roixw.com/v1 再试。</div>
                  ) : null}
                </div>
              ) : null}
              {testImage ? (
                <div className="overflow-hidden rounded-lg border border-border/50">
                  <img src={testImage.url} alt={testImage.rel} className="max-h-64 w-full object-contain bg-black/5" />
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">{testImage.rel}</div>
                </div>
              ) : null}
            </div>
          </SettingRow>
        </>
      ) : null}
    </Section>
  )
}

/** Same rows, either under a section heading or bare inside the page's own card. */
function Section({
  title,
  description,
  showHeading,
  children,
}: {
  title: string
  description: string
  showHeading: boolean
  children: ReactNode
}) {
  if (showHeading) return <SettingsSection title={title} description={description}>{children}</SettingsSection>
  return (
    <section className="settings-section">
      <div className="settings-section-rows settings-card">{children}</div>
    </section>
  )
}
