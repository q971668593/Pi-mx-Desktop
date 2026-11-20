/**
 * 内置生图执行：订阅（codex）与自定义中转（custom）两路，输出落到工作区的 outputDir。
 *
 * 订阅这一路刻意补齐浏览器指纹头（UA / Client Hints / Origin），这是官方对裸脚本
 * 静默降智的已知触发点；不补齐就会出现「出图发灰、丢透明、画质骤降」。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  detectImageExt,
  inspectPng,
  normalizeImageGenArgs,
  type ImageGenArgs,
  type ImageGenConfig,
} from '@shared/image-gen'
import {
  analyzeImagePrompt,
  buildEnhancedPrompt,
  sanitizeImagePrompt,
  shouldEnhanceImagePrompt,
  TRANSPARENT_CONSTRAINT,
  wantsTransparentBackground,
} from '@shared/image-prompt'
import { ensureCodexGrant, readCodexGrant, refreshCodexGrant } from './codex-auth'
import { buildImageHeaders, deviceId } from './identity'
import { imageDeviceDir } from './paths'

const CODEX_IMAGE_ENDPOINT = 'https://chatgpt.com/backend-api/codex/images/generations'
const MAX_RESPONSE = 40 * 1024 * 1024
const MAX_IMAGE = 28 * 1024 * 1024

export type GeneratedImage = {
  path: string
  /** 相对工作区的路径，给模型/时间线用 */
  rel: string
  format: string
  bytes: number
}

export type GenerateResult = {
  ok: true
  provider: ImageGenConfig['provider']
  model: string
  images: GeneratedImage[]
  warnings: string[]
  /** 提示词体检结果：给模型/时间线看「原句多专业、补了什么」 */
  prompt: PromptReport
}

/** 提示词自动优化的记录（未优化时 added 为空、used === original）。 */
export type PromptReport = {
  original: string
  used: string
  score: number
  scoreAfter: number
  added: string[]
  optimized: boolean
  /** 被摘掉的占位符（[主标题] 这类），摘掉后模型才不会把占位符当正文画上去 */
  cleaned: string[]
  /** 实际发出去的背景设置 */
  background: 'auto' | 'transparent' | 'opaque'
}

type FetchLike = typeof fetch

/**
 * 网络层失败的诊断与重试。
 *
 * undici 把 DNS、建连、重定向、TLS 一律包成一句 `fetch failed`，真正的原因塞在
 * `error.cause` 里：不拆开就只能给用户看三个字，等于什么都没说。这里拆出 code/原因，
 * 并且对抖动类错误自动重试——生图一次十几秒，一次瞬断就白等是纯亏。
 */
const RETRYABLE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

type NetError = { message?: string; code?: string; cause?: { code?: string; message?: string } }

/** 把 `fetch failed` 背后的真实原因摊开：`ECONNRESET · read ECONNRESET`。 */
export function networkErrorDetail(error: unknown): string {
  const err = (error ?? {}) as NetError
  const code = String(err.cause?.code || err.code || '')
  const detail = err.cause?.message || err.message || String(error ?? '')
  return [code, detail].filter(Boolean).join(' · ') || '未知网络错误'
}

function isRetryableNetworkError(error: unknown): boolean {
  const err = (error ?? {}) as NetError
  if (RETRYABLE_CODES.has(String(err.cause?.code || err.code || ''))) return true
  // 没有 code 的 fetch failed 多半是 DNS/建连/重定向，一样值得再试一次。
  return error instanceof TypeError && /fetch failed/i.test(err.message || '')
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

async function fetchWithRetry(
  send: FetchLike,
  url: string,
  init: () => RequestInit,
  options: { label: string; timeoutMs?: number; attempts?: number },
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3)
  let tried = 0
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    tried = attempt
    try {
      return await send(url, {
        ...init(),
        ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
      })
    } catch (error) {
      last = error
      if (!isRetryableNetworkError(error) || attempt === attempts) break
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    }
  }
  throw new Error(
    `连不上${options.label}（${networkErrorDetail(last)}，已试 ${tried} 次）：网络或代理在抖，稍后重试或换个出口节点`,
  )
}

/** 请求头走「第一方身份」：绝不发第三方 originator（旧实现发的是 pi-desktop）。 */
function headersFor(grant: { access: string; accountId: string }, config: ImageGenConfig): Record<string, string> {
  return buildImageHeaders({
    accessToken: grant.access,
    accountId: grant.accountId,
    identity: config.identity,
    deviceId: deviceId(imageDeviceDir()),
  })
}

function bodyFor(args: ImageGenArgs, model: string): Record<string, unknown> {
  return {
    ...(model ? { model } : {}),
    prompt: args.prompt,
    n: 1,
    ...(args.size !== 'auto' ? { size: args.size } : {}),
    // quality 是画质的关键：不传就是服务端默认（最省成本的那档，也就是「降智感」来源）。
    ...(args.quality !== 'auto' ? { quality: args.quality } : {}),
    background: args.background,
    output_format: args.outputFormat,
  }
}

function decodeBase64(data: unknown): Buffer {
  const encoded = typeof data === 'string' ? data.trim() : ''
  if (!encoded || encoded.length > MAX_RESPONSE || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('生图服务没有返回有效的图片数据')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length < 24 || bytes.length > MAX_IMAGE) throw new Error('生图服务返回的图片大小异常')
  return bytes
}

type ImagePayload = { data?: Array<{ b64_json?: string; url?: string }> }

async function readPayload(response: Response): Promise<ImagePayload> {
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_RESPONSE) throw new Error('生图响应过大')
  return (await response.json()) as ImagePayload
}

async function saveImages(
  workspaceRoot: string,
  outputDir: string,
  images: Buffer[],
): Promise<GeneratedImage[]> {
  const dir = join(workspaceRoot, outputDir)
  await mkdir(dir, { recursive: true })
  const stamp = Date.now()
  const out: GeneratedImage[] = []
  for (const [index, bytes] of images.entries()) {
    const ext = detectImageExt(bytes)
    if (!ext) throw new Error('生图服务返回的内容不是可识别的图片')
    const name = `image-${stamp}-${index + 1}-${randomUUID().slice(0, 8)}.${ext}`
    await writeFile(join(dir, name), bytes)
    out.push({
      path: join(dir, name),
      rel: `${outputDir.replace(/[\\/]+$/, '')}/${name}`.replace(/\\/g, '/'),
      format: ext,
      bytes: bytes.length,
    })
  }
  return out
}

async function generateViaCodex(
  args: ImageGenArgs,
  config: ImageGenConfig,
  send: FetchLike,
): Promise<{ images: Buffer[]; warnings: string[]; model: string }> {
  const initial = await readCodexGrant()
  if (!initial) throw new Error('没有找到 ChatGPT 订阅授权（~/.codex/auth.json）；先在 Codex 或 DSH 的 ChatGPT 登录插件里登录')
  let grant = await ensureCodexGrant(initial, send)
  const model = args.model || config.model

  const post = () =>
    fetchWithRetry(
      send,
      CODEX_IMAGE_ENDPOINT,
      () => ({
        method: 'POST',
        redirect: 'error',
        headers: headersFor(grant, config),
        body: JSON.stringify(bodyFor(args, model)),
      }),
      { label: `订阅图片服务 ${hostOf(CODEX_IMAGE_ENDPOINT)}`, timeoutMs: 240_000 },
    )

  let response = await post()
  if (response.status === 401 && grant.refresh) {
    await response.body?.cancel().catch(() => {})
    grant = await refreshCodexGrant(grant, send)
    response = await post()
  }
  const requestId = response.headers.get('x-request-id') || response.headers.get('x-codex-imagegen-request-id') || ''
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    const hint =
      response.status === 401 ? '请重新登录 ChatGPT 订阅'
        : response.status === 403 ? '当前账号或请求被图片服务拒绝'
          : response.status === 429 ? '额度或频率已达上限，稍后再试'
            : response.status === 400 || response.status === 422 ? '订阅接口拒绝了这组参数/格式'
              : '图片服务暂不可用'
    throw new Error(`生图失败（HTTP ${response.status}）：${hint}${requestId ? ` · 请求编号 ${requestId.slice(0, 64)}` : ''}`)
  }
  const payload = await readPayload(response)
  const warnings: string[] = []
  const returnedModel = response.headers.get('x-model') || response.headers.get('x-openai-selected-model')
  if (returnedModel && model && !returnedModel.toLowerCase().includes(model.toLowerCase())) {
    warnings.push(`服务端实际使用 ${returnedModel}，与所选的 ${model} 不一致`)
  }
  const entries = Array.isArray(payload.data) ? payload.data : []
  if (!entries.length) throw new Error('生图服务没有返回图片')
  const images: Buffer[] = []
  for (const entry of entries) {
    if (entry.b64_json) images.push(decodeBase64(entry.b64_json))
    else if (entry.url) {
      // 少数通道返回 URL：下载到本地，避免链接过期后时间线里只剩死链。
      const file = await fetchWithRetry(
        send,
        entry.url,
        () => ({ redirect: 'follow' }),
        { label: `结果下载地址 ${hostOf(entry.url)}`, timeoutMs: 60_000 },
      )
      if (!file.ok) throw new Error(`下载生成结果失败（HTTP ${file.status}）`)
      const bytes = Buffer.from(await file.arrayBuffer())
      if (bytes.length > MAX_IMAGE) throw new Error('生成结果过大')
      images.push(bytes)
    }
  }
  return { images, warnings, model: model || 'gpt-image' }
}

/**
 * 出图后的降智自检：透明通道、尺寸、格式。参数被服务端悄悄改掉时给出可读告警，
 * 而不是让用户拿到一张「看起来就是烂」的图还不知道为什么。
 */
export function inspectGeneratedImages(
  images: Buffer[],
  requested: Pick<ImageGenArgs, 'background' | 'size' | 'outputFormat'>,
): string[] {
  const warnings = new Set<string>()
  const wanted = requested.size !== 'auto' ? requested.size.split('x').map(Number) : null
  for (const bytes of images) {
    const ext = detectImageExt(bytes)
    if (requested.background === 'transparent' && ext === 'jpeg') {
      warnings.add('请求了透明背景，服务端返回 JPEG（没有 alpha 通道）—— 建议改用 PNG 或 WebP 重试')
    }
    const png = ext === 'png' ? inspectPng(bytes) : null
    if (requested.background === 'transparent' && png && !png.hasAlpha) {
      warnings.add('请求了透明背景，但返回的 PNG 没有 alpha 通道（疑似被降级到旧管线，建议换更干净的出口节点）')
    }
    if (png && wanted && (Math.abs(png.width - wanted[0]) > 8 || Math.abs(png.height - wanted[1]) > 8)) {
      warnings.add(`请求尺寸 ${requested.size}，实际返回 ${png.width}×${png.height}（服务端按权限/风控调整了尺寸）`)
    }
  }
  return [...warnings]
}

async function generateViaCustom(
  args: ImageGenArgs,
  config: ImageGenConfig,
  send: FetchLike,
): Promise<{ images: Buffer[]; warnings: string[]; model: string }> {
  if (!config.baseUrl) throw new Error('自定义生图通道还没填 baseURL（设置 → 模型 → 生图）')
  const url = `${config.baseUrl.replace(/\/+$/, '')}/images/generations`
  const model = args.model || config.model
  if (!model) throw new Error('自定义生图通道还没填模型名（设置 → 模型 → 生图）')
  const response = await fetchWithRetry(
    send,
    url,
    () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        prompt: args.prompt,
        n: Math.min(4, Math.max(1, args.n)),
        ...(args.size !== 'auto' ? { size: args.size } : {}),
        ...(args.quality !== 'auto' ? { quality: args.quality } : {}),
        ...(args.background === 'transparent' ? { background: 'transparent' } : {}),
        ...(args.outputFormat !== 'png' ? { output_format: args.outputFormat } : {}),
        response_format: 'b64_json',
      }),
    }),
    { label: `生图通道 ${hostOf(url)}`, timeoutMs: 240_000 },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`生图失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`)
  }
  const payload = (await response.json()) as ImagePayload
  const entries = Array.isArray(payload.data) ? payload.data : []
  if (!entries.length) throw new Error('生图服务没有返回图片')
  const images: Buffer[] = []
  for (const entry of entries) {
    if (entry.b64_json) images.push(decodeBase64(entry.b64_json))
    else if (entry.url) {
      const file = await fetchWithRetry(
        send,
        entry.url,
        () => ({ redirect: 'follow' }),
        { label: `结果下载地址 ${hostOf(entry.url)}`, timeoutMs: 60_000 },
      )
      if (!file.ok) throw new Error(`下载生成结果失败（HTTP ${file.status}）`)
      images.push(Buffer.from(await file.arrayBuffer()))
    }
  }
  return { images, warnings: [], model }
}

export async function generateImages(input: {
  args: unknown
  config: ImageGenConfig
  workspaceRoot: string
  send?: FetchLike
}): Promise<GenerateResult> {
  const parsed = normalizeImageGenArgs(input.args)
  if ('error' in parsed) throw new Error(parsed.error)
  const { config, workspaceRoot } = input
  if (config.provider === 'off') {
    throw new Error('内置生图还没开启：设置 → 模型 → 生图，选「ChatGPT 订阅」或「自定义中转」')
  }

  // 一句话需求直接上模型，得到的基本是模型自己的默认审美（红金国潮、模板字）。
  // 先体检测缺哪几维，再按模板补齐；用户显式关掉或传 optimize=false 就原样透传。
  //
  // 顺序很关键：先洗掉占位符（否则模型会把「[主标题]」当正文印在海报上），
  // 再判断是不是透明素材（影响 background/outputFormat），最后才做九维补齐。
  const sanitized = sanitizeImagePrompt(parsed.prompt)
  const wantsAlpha = parsed.background === 'auto' && wantsTransparentBackground(sanitized.prompt)
  const background: PromptReport['background'] = wantsAlpha ? 'transparent' : parsed.background
  const outputFormat = wantsAlpha ? 'png' : parsed.outputFormat

  const analysis = analyzeImagePrompt(sanitized.prompt)
  const enhance =
    parsed.optimize !== false && shouldEnhanceImagePrompt(sanitized.prompt, config.promptEnhance)
  const enhanced = enhance
    ? buildEnhancedPrompt(sanitized.prompt, { size: parsed.size !== 'auto' ? parsed.size : undefined })
    : null
  let finalPrompt = enhanced ? enhanced.prompt : sanitized.prompt
  // 透明素材必须显式说清背景，否则模型会给个白底图，抠图时边缘全是白边。
  if (wantsAlpha && !/透明|alpha|transparent/i.test(finalPrompt)) {
    finalPrompt = `${finalPrompt}\n${TRANSPARENT_CONSTRAINT}`
  }
  const args = { ...parsed, prompt: finalPrompt, background, outputFormat }
  const promptReport: PromptReport = {
    original: parsed.prompt,
    used: args.prompt,
    score: analysis.score,
    scoreAfter: enhanced ? enhanced.scoreAfter : analysis.score,
    added: enhanced?.addedLabels ?? [],
    optimized: Boolean(enhanced && enhanced.added.length),
    cleaned: sanitized.placeholders,
    background,
  }

  const send = input.send ?? fetch
  const produced = config.provider === 'codex'
    ? await generateViaCodex(args, config, send)
    : await generateViaCustom(args, config, send)
  const images = await saveImages(workspaceRoot, config.outputDir, produced.images)
  const warnings = [...new Set([...produced.warnings, ...inspectGeneratedImages(produced.images, args)])]
  return { ok: true, provider: config.provider, model: produced.model, images, warnings, prompt: promptReport }
}

/** 订阅侧可用模型：拉不到就退回内置清单，不阻塞使用。 */
export async function listCodexImageModels(send: FetchLike = fetch): Promise<string[]> {
  const grant = await readCodexGrant()
  if (!grant) return []
  const usable = await ensureCodexGrant(grant).catch(() => grant)
  try {
    // /codex/models 缺 client_version 会直接 400——之前没带，于是永远拉不到列表、只能吃兜底。
    const response = await send('https://chatgpt.com/backend-api/codex/models?client_version=0.0.0', {
      headers: buildImageHeaders({
        accessToken: usable.access,
        accountId: usable.accountId,
        identity: 'codex',
        deviceId: deviceId(imageDeviceDir()),
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return []
    const payload = (await response.json()) as {
      models?: Array<{ slug?: string; id?: string; model?: string }>
      data?: Array<{ slug?: string; id?: string; model?: string }>
    }
    const rows: Array<{ slug?: string; id?: string; model?: string }> = payload.models || payload.data || []
    const ids = rows
      .map((row) => String(row?.slug || row?.id || row?.model || ''))
      .filter((id) => /image/i.test(id))
    return [...new Set(ids)]
  } catch {
    return []
  }
}
