import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_IMAGE_GEN_CONFIG, normalizeImageGenConfig } from '@shared/image-gen'

const mocks = vi.hoisted(() => ({ cwd: '/proj', config: {} as Record<string, unknown> }))
vi.mock('../trusted-workspace', () => ({ authorizeProjectCwd: () => ({ ok: true, cwd: mocks.cwd }) }))
vi.mock('../config-store', () => ({ configStore: { get: (key: string) => (key === 'imageGen' ? mocks.config : undefined) } }))

const PIXEL = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)])

vi.mock('./generate', async () => {
  const actual = await vi.importActual<typeof import('./generate')>('./generate')
  return {
    ...actual,
    generateImages: vi.fn(async () => ({
      ok: true as const,
      provider: 'codex' as const,
      model: 'gpt-image-2.6-sunburst',
      images: [{ path: '/proj/generated-images/a.png', rel: 'generated-images/a.png', format: 'png', bytes: 12 }],
      warnings: [],
      prompt: { original: 'x', used: 'x', score: 80, scoreAfter: 80, added: [], optimized: false, cleaned: [], background: 'auto' },
    })),
  }
})

import { handleImageToolRequest } from './tool-bridge'
import { generateImages } from './generate'

function call(args: Record<string, unknown>) {
  const posted: Array<Record<string, unknown>> = []
  return handleImageToolRequest({ callId: 'c1', args }, { cwd: '/proj' }, (message) => posted.push(message)).then(
    () => posted[0] as { type: string; result: { content: Array<{ text: string }>; isError?: boolean } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.config = normalizeImageGenConfig({ provider: 'codex' })
})

describe('image_gen tool bridge', () => {
  it('generates through the configured channel and reports rel paths', async () => {
    const posted = await call({ prompt: '透明茶杯图标', background: 'transparent' })
    expect(generateImages).toHaveBeenCalledWith({
      args: { prompt: '透明茶杯图标', background: 'transparent' },
      config: expect.objectContaining({ provider: 'codex' }),
      workspaceRoot: '/proj',
    })
    expect(posted.result.isError).toBeUndefined()
    const text = posted.result.content[0].text
    // 第一行是给人看的摘要（含相对路径），后面才是 JSON 明细
    expect(text.split(String.fromCharCode(10))[0]).toContain('generated-images/a.png')
    const payload = JSON.parse(text.slice(text.indexOf('{')))
    expect(payload.images[0].rel).toBe('generated-images/a.png')
  })

  it('tells the model to enable the setting instead of retrying other tools', async () => {
    mocks.config = DEFAULT_IMAGE_GEN_CONFIG
    const posted = await call({ prompt: 'x' })
    expect(posted.result.isError).toBe(true)
    expect(posted.result.content[0].text).toContain('内置生图未开启')
    expect(generateImages).not.toHaveBeenCalled()
  })

  it('surfaces generation errors as tool errors', async () => {
    vi.mocked(generateImages).mockRejectedValueOnce(new Error('生图失败（HTTP 429）：额度或频率已达上限'))
    const posted = await call({ prompt: 'x' })
    expect(posted.result.isError).toBe(true)
    expect(posted.result.content[0].text).toContain('HTTP 429')
  })
})

describe('generateImages (codex channel)', () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-imagegen-'))
  const project = join(home, 'proj')

  beforeEach(() => {
    mkdirSync(join(home, '.codex'), { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(
      join(home, '.codex', 'auth.json'),
      JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'access', refresh_token: 'refresh', account_id: 'acct-1' } }),
    )
    process.env.CODEX_HOME = join(home, '.codex')
  })

  afterEach(() => {
    delete process.env.CODEX_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('posts to the subscription endpoint with browser headers and saves the png', async () => {
    const actual = await vi.importActual<typeof import('./generate')>('./generate')
    const send = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: PIXEL.toString('base64') }] }), {
        status: 200,
        headers: { 'x-model': 'gpt-image-2.6-sunburst' },
      }),
    )
    const result = await actual.generateImages({
      args: { prompt: '茶杯', background: 'transparent', outputFormat: 'png' },
      config: normalizeImageGenConfig({ provider: 'codex', model: 'gpt-image-2.6-sunburst', promptEnhance: 'off' }),
      workspaceRoot: project,
      send: send as unknown as typeof fetch,
    })
    expect(result.images[0].rel).toMatch(/^generated-images\/image-.+\.png$/)
    expect(readFileSync(result.images[0].path).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/generations')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer access')
    expect(headers['chatgpt-account-id']).toBe('acct-1')
    expect(headers['user-agent']).toContain('Chrome')
    // 第一方身份：网页端会带设备/会话标识，且绝不发第三方 originator
    expect(headers['oai-device-id']).toBeTruthy()
    expect(headers['session-id']).toBeTruthy()
    expect(headers.originator).toBeUndefined()
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      prompt: '茶杯',
      model: 'gpt-image-2.6-sunburst',
      // 画质必须显式传：不传就是服务端最省成本的那档
      quality: 'high',
      background: 'transparent',
      output_format: 'png',
    })
  })

  it('refreshes the token once on 401 and retries', async () => {
    const actual = await vi.importActual<typeof import('./generate')>('./generate')
    let calls = 0
    const send = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('auth.openai.com')) {
        return new Response(JSON.stringify({ access_token: 'access2', refresh_token: 'refresh2', expires_in: 3600 }), { status: 200 })
      }
      calls += 1
      if (calls === 1) return new Response('expired', { status: 401 })
      return new Response(JSON.stringify({ data: [{ b64_json: PIXEL.toString('base64') }] }), { status: 200 })
    })
    const result = await actual.generateImages({
      args: { prompt: '茶杯' },
      config: normalizeImageGenConfig({ provider: 'codex' }),
      workspaceRoot: project,
      send: send as unknown as typeof fetch,
    })
    expect(result.images).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it('fails with a clear message when there is no subscription auth', async () => {
    const actual = await vi.importActual<typeof import('./generate')>('./generate')
    rmSync(join(home, '.codex'), { recursive: true, force: true })
    await expect(
      actual.generateImages({
        args: { prompt: 'x' },
        config: normalizeImageGenConfig({ provider: 'codex' }),
        workspaceRoot: project,
        send: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/ChatGPT 订阅授权/)
  })
})
