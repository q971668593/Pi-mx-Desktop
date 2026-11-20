import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeImageGenConfig } from '@shared/image-gen'

import { generateImages, networkErrorDetail } from './generate'

const PIXEL = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)])

function fetchFailed(code: string): TypeError {
  const error = new TypeError('fetch failed')
  ;(error as TypeError & { cause?: unknown }).cause = Object.assign(new Error(`read ${code}`), { code })
  return error
}

function imageResponse(): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: PIXEL.toString('base64') }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const dirs: string[] = []
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-image-gen-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const customConfig = normalizeImageGenConfig({
  provider: 'custom',
  baseUrl: 'http://127.0.0.1:3425/v1',
  model: 'codex/gpt-image-2',
  outputDir: 'generated-images',
})

describe('networkErrorDetail', () => {
  it('unpacks the cause undici hides behind "fetch failed"', () => {
    expect(networkErrorDetail(fetchFailed('ECONNRESET'))).toBe('ECONNRESET · read ECONNRESET')
  })

  it('falls back to the raw message when there is no cause', () => {
    expect(networkErrorDetail(new Error('boom'))).toBe('boom')
  })
})

describe('generateImages network resilience', () => {
  it('retries a transient fetch failure instead of giving up', async () => {
    let calls = 0
    const send = (async () => {
      calls += 1
      if (calls < 3) throw fetchFailed('ECONNRESET')
      return imageResponse()
    }) as unknown as typeof fetch

    const root = workspace()
    const result = await generateImages({ args: { prompt: '茶杯海报' }, config: customConfig, workspaceRoot: root, send })
    expect(calls).toBe(3)
    expect(result.images).toHaveLength(1)
    expect(readdirSync(join(root, 'generated-images'))).toHaveLength(1)
  })

  it('reports why the channel is unreachable when retries run out', async () => {
    const send = (async () => {
      throw fetchFailed('ENOTFOUND')
    }) as unknown as typeof fetch

    await expect(
      generateImages({ args: { prompt: '茶杯海报' }, config: customConfig, workspaceRoot: workspace(), send }),
    ).rejects.toThrow(/连不上生图通道 127\.0\.0\.1:3425（ENOTFOUND · read ENOTFOUND，已试 3 次）/)
  })

  it('completes a vague prompt before hitting the model and reports what was added', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const send = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return imageResponse()
    }) as unknown as typeof fetch

    const result = await generateImages({
      args: { prompt: '画一只杯子' },
      config: customConfig,
      workspaceRoot: workspace(),
      send,
    })
    const sent = String(bodies[0].prompt)
    expect(sent.startsWith('画一只杯子')).toBe(true)
    expect(sent.length).toBeGreaterThan('画一只杯子'.length)
    expect(result.prompt.optimized).toBe(true)
    expect(result.prompt.added.length).toBeGreaterThan(0)
    expect(result.prompt.scoreAfter).toBeGreaterThan(result.prompt.score)
  })

  it('leaves the prompt alone when optimize=false or the channel is switched off', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const send = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return imageResponse()
    }) as unknown as typeof fetch

    const off = normalizeImageGenConfig({ ...customConfig, promptEnhance: 'off' })
    const result = await generateImages({
      args: { prompt: '画一只杯子' },
      config: off,
      workspaceRoot: workspace(),
      send,
    })
    expect(bodies[0].prompt).toBe('画一只杯子')
    expect(result.prompt.optimized).toBe(false)

    await generateImages({ args: { prompt: '画一只杯子', optimize: false }, config: customConfig, workspaceRoot: workspace(), send })
    expect(bodies[1].prompt).toBe('画一只杯子')
  })

  it('strips placeholders before sending and reports them', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const send = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return imageResponse()
    }) as unknown as typeof fetch

    const result = await generateImages({
      args: { prompt: '海报。标题占位「[主标题]」，副标题「[副标题]」。文字占位符保持空白可替换。极简。' },
      config: customConfig,
      workspaceRoot: workspace(),
      send,
    })
    const sent = String(bodies[0].prompt)
    expect(sent).not.toContain('[主标题]')
    expect(sent).not.toContain('占位符')
    expect(result.prompt.cleaned).toEqual(['[主标题]', '[副标题]'])
  })

  it('switches to transparent png when the request is a transparent asset', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const send = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return imageResponse()
    }) as unknown as typeof fetch

    const result = await generateImages({
      args: { prompt: '一个透明的茶杯图标，线条简洁' },
      config: customConfig,
      workspaceRoot: workspace(),
      send,
    })
    expect(bodies[0].background).toBe('transparent')
    // png 是默认格式，自定义通道只在非 png 时才显式带 output_format
    expect(bodies[0].output_format ?? 'png').toBe('png')
    expect(result.prompt.background).toBe('transparent')
  })

  it('does not retry a plain HTTP error — that answer will not change', async () => {
    let calls = 0
    const send = (async () => {
      calls += 1
      return new Response('model not found', { status: 404 })
    }) as unknown as typeof fetch

    await expect(
      generateImages({ args: { prompt: 'x' }, config: customConfig, workspaceRoot: workspace(), send }),
    ).rejects.toThrow(/HTTP 404/)
    expect(calls).toBe(1)
  })
})
