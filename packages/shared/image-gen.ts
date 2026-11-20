/**
 * 内置生图（image_gen）配置。
 *
 * 背景：桌面端的生图过去只能挂 MCP（Magpie 之类），模型链路一多就容易「被降智」——
 * 出图发灰、丢透明、画质骤降。这里把生图收进应用自己的设置：
 *   - codex：用本机 ChatGPT/Codex 订阅授权（~/.codex/auth.json）直连订阅生图端点；
 *   - custom：任意 OpenAI 兼容的中转（baseURL + apiKey）；
 *   - off：不内置，继续走 MCP。
 */
export type ImageGenProvider = 'off' | 'codex' | 'custom'

export type ImageGenQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ImageGenIdentity = 'web' | 'codex'

export const IMAGE_GEN_QUALITIES: readonly ImageGenQuality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

export type ImageGenConfig = {
  provider: ImageGenProvider
  /**
   * 生图模型；空 = 让服务端挑默认。
   *
   * 实测同一句 prompt 对比（见 .poster-work/abtest）：`gpt-image-2.6-sunburst` 快（~40s）
   * 但构图模板化、海报字体呆板；`gpt-image-2` 慢（~85s）但书法、质感、层次明显更好。
   * 所以默认给 gpt-image-2，sunburst 留给「先出草稿」的场景。
   */
  model: string
  /** custom 的 OpenAI 兼容根地址，例如 https://host/v1 */
  baseUrl: string
  apiKey: string
  /**
   * 旧的「默认尺寸」。已经不在设置页暴露：每次需求的画幅都不同，交给调用方按需传
   * `size`；留空就是 auto（服务端按内容决定）。保留字段只为兼容已存盘的配置。
   */
  size: ImageGenSize
  /**
   * 默认质量。auto 就是「被降智」最省事的一档（服务端按最低成本出图），
   * 这里默认 high；想要画质优先可以选 xhigh/max（取决于账号权限）。
   */
  quality: ImageGenQuality
  /** 请求身份：web = 模拟 chatgpt.com 网页端（默认），codex = 模拟官方 Codex CLI */
  identity: ImageGenIdentity
  /** 相对工作区的输出目录 */
  outputDir: string
  /**
   * 提示词增强：auto = 描述不够专业时自动补齐维度（见 shared/image-prompt.ts），
   * off = 原样透传。默认 auto：用户往往只给一句话，模型只能按自己的默认审美出图。
   */
  promptEnhance: ImagePromptEnhance
}

export type ImagePromptEnhance = 'auto' | 'off'

export type ImageGenSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536'

export const IMAGE_GEN_SIZES: readonly ImageGenSize[] = ['auto', '1024x1024', '1536x1024', '1024x1536']

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  provider: 'off',
  model: 'gpt-image-2.6',
  baseUrl: '',
  apiKey: '',
  size: 'auto',
  quality: 'high',
  identity: 'web',
  outputDir: 'generated-images',
  promptEnhance: 'auto',
}

/** 订阅侧常见模型；真实列表由 `imageGen.models` 动态拉取，这里只做下拉兜底。按实测画质排序，gpt-image-2 在前（sunburst 快但呆板）。 */
export const CODEX_IMAGE_MODELS = [
  'gpt-image-2.6',
  'gpt-image-2.5',
  'gpt-image-2',
  'gpt-image-2.6-flare',
  'gpt-image-2.6-sunburst',
] as const

export function normalizeImageGenConfig(value: unknown): ImageGenConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ImageGenConfig>
  const provider: ImageGenProvider =
    raw.provider === 'codex' || raw.provider === 'custom' ? raw.provider : 'off'
  const size = IMAGE_GEN_SIZES.includes(raw.size as ImageGenSize) ? (raw.size as ImageGenSize) : 'auto'
  const quality = IMAGE_GEN_QUALITIES.includes(raw.quality as ImageGenQuality) ? (raw.quality as ImageGenQuality) : 'high'
  const identity: ImageGenIdentity = raw.identity === 'codex' ? 'codex' : 'web'
  const dir = typeof raw.outputDir === 'string' ? raw.outputDir.trim().replace(/^[/\\]+/, '') : ''
  return {
    provider,
    model:
      (typeof raw.model === 'string' ? raw.model.trim().slice(0, 120) : '') || DEFAULT_IMAGE_GEN_CONFIG.model,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim().replace(/\/+$/, '').slice(0, 400) : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim().slice(0, 400) : '',
    size,
    quality,
    identity,
    outputDir: (dir || DEFAULT_IMAGE_GEN_CONFIG.outputDir).replace(/[\\/]+$/, ''),
    promptEnhance: raw.promptEnhance === 'off' ? 'off' : 'auto',
  }
}

export function imageGenActive(config: ImageGenConfig): boolean {
  if (config.provider === 'codex') return true
  if (config.provider === 'custom') return !!config.baseUrl
  return false
}

export type ImageGenArgs = {
  prompt: string
  n: number
  size: ImageGenSize
  quality: ImageGenQuality
  background: 'auto' | 'transparent' | 'opaque'
  outputFormat: 'png' | 'jpeg' | 'webp'
  model?: string
  /** false = 本次不补提示词（用户想要原样出图时）；不传则跟随设置里的 promptEnhance */
  optimize?: boolean
}

export function normalizeImageGenArgs(value: unknown): ImageGenArgs | { error: string } {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  if (!prompt) return { error: 'prompt 不能为空' }
  if (prompt.length > 8000) return { error: 'prompt 太长（最多 8000 字符）' }
  const nRaw = typeof raw.n === 'number' ? Math.floor(raw.n) : 1
  const n = Math.min(4, Math.max(1, Number.isFinite(nRaw) ? nRaw : 1))
  const size = IMAGE_GEN_SIZES.includes(raw.size as ImageGenSize) ? (raw.size as ImageGenSize) : 'auto'
  const quality = IMAGE_GEN_QUALITIES.includes(raw.quality as ImageGenQuality) ? (raw.quality as ImageGenQuality) : 'high'
  const background = raw.background === 'transparent' || raw.background === 'opaque' ? raw.background : 'auto'
  const outputFormat = raw.outputFormat === 'jpeg' || raw.outputFormat === 'webp' ? raw.outputFormat : 'png'
  const model = typeof raw.model === 'string' ? raw.model.trim().slice(0, 120) : ''
  const optimize = typeof raw.optimize === 'boolean' ? raw.optimize : undefined
  return { prompt, n, size, quality, background, outputFormat, ...(model ? { model } : {}), ...(optimize === undefined ? {} : { optimize }) }
}

/** 订阅端点返回 b64；按文件头判断真实格式，别信请求参数。 */
export function detectImageExt(bytes: Buffer): 'png' | 'jpeg' | 'webp' | 'gif' | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'gif'
  return null
}

export type PngInfo = { width: number; height: number; /** 有没有 alpha 通道（colorType 4/6） */ hasAlpha: boolean }

/**
 * 读 PNG 的 IHDR：尺寸与 alpha 通道。用来判断「请求了透明但服务端悄悄给了不透明图」，
 * 这是订阅接口被降级分流的典型表现之一。
 */
export function inspectPng(bytes: Buffer): PngInfo | null {
  if (bytes.length < 33) return null
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return null
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const colorType = bytes[25]
  if (!width || !height) return null
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 }
}
