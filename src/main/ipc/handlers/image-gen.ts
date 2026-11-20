/**
 * 内置生图的 IPC：设置读写、授权状态、订阅模型列表。
 * 生成本身由 agent 工具 `image_gen` 或面板按钮触发，这里只给状态与配置。
 */
import { z } from 'zod'
import { normalizeImageGenConfig, CODEX_IMAGE_MODELS } from '@shared/image-gen'
import { configStore } from '../../config-store'
import { authorizeProjectCwd } from '../../trusted-workspace'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { readCodexGrant } from '../../image-gen/codex-auth'
import { generateImages, listCodexImageModels } from '../../image-gen/generate'

export function registerImageGenHandlers(): void {
  registerHandler('ipc:imageGen.status', async () => {
    const config = normalizeImageGenConfig(configStore.get('imageGen'))
    const grant = config.provider === 'codex' ? await readCodexGrant() : null
    return {
      ok: true,
      config,
      status: {
        provider: config.provider,
        active: config.provider !== 'off',
        codexAuthorized: !!grant,
        // 不回传任何令牌内容，只告诉界面「有没有授权 / 过期时间」
        codexExpiresAt: grant?.expiresAt ?? null,
        models: config.provider === 'codex' ? [...CODEX_IMAGE_MODELS] : [],
      },
    }
  })

  registerHandlerWithSchema(
    'ipc:imageGen.config.set',
    z
      .object({
        provider: z.enum(['off', 'codex', 'custom']),
        model: z.string().max(120).optional(),
        baseUrl: z.string().max(400).optional(),
        apiKey: z.string().max(400).optional(),
        size: z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']).optional(),
        quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
        identity: z.enum(['web', 'codex']).optional(),
        outputDir: z.string().max(200).optional(),
        promptEnhance: z.enum(['auto', 'off']).optional(),
      })
      .strict(),
    async (req) => {
      const next = normalizeImageGenConfig({ ...configStore.get('imageGen'), ...req })
      configStore.set('imageGen', next)
      return { ok: true, config: next }
    },
  )

  registerHandler('ipc:imageGen.models', async (req) => {
    const config = normalizeImageGenConfig(configStore.get('imageGen'))
    if (config.provider === 'custom') {
      const models = config.model ? [config.model] : []
      return { ok: true, models }
    }
    const remote = config.provider === 'codex' ? await listCodexImageModels() : []
    const models = remote.length ? remote : [...CODEX_IMAGE_MODELS]
    return { ok: true, models, ...(req?.refresh === true ? { refreshed: true } : {}) }
  })

  // 面板「试一张」用：和 agent 工具走同一套生成逻辑。
  registerHandlerWithSchema(
    'ipc:imageGen.generate',
    z
      .object({
        workspaceId: z.string().min(1).max(4096),
        prompt: z.string().min(1).max(8000),
        size: z.string().max(20).optional(),
        quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
      })
      .strict(),
    async ({ workspaceId, prompt, size, quality }) => {
      const authorized = authorizeProjectCwd(workspaceId)
      if (!authorized.ok) throw new Error(`工作区不可用（${authorized.error}）`)
      const config = normalizeImageGenConfig(configStore.get('imageGen'))
      return generateImages({ args: { prompt, size, quality }, config, workspaceRoot: authorized.cwd })
    },
  )
}
