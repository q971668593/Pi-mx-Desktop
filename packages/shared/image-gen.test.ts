import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_GEN_CONFIG,
  detectImageExt,
  imageGenActive,
  inspectPng,
  normalizeImageGenArgs,
  normalizeImageGenConfig,
} from './image-gen'

describe('normalizeImageGenConfig', () => {
  it('falls back to the default when nothing is stored', () => {
    expect(normalizeImageGenConfig(undefined)).toEqual(DEFAULT_IMAGE_GEN_CONFIG)
    expect(normalizeImageGenConfig({ provider: 'nope' }).provider).toBe('off')
    // 默认画质不是 auto、身份默认网页端
    expect(normalizeImageGenConfig({}).quality).toBe('high')
    expect(normalizeImageGenConfig({}).identity).toBe('web')
  })

  it('keeps a valid config and trims the endpoint', () => {
    const config = normalizeImageGenConfig({
      provider: 'custom',
      model: ' gpt-image-1 ',
      baseUrl: 'https://host/v1///',
      apiKey: ' sk-1 ',
      size: '1536x1024',
      quality: 'max',
      identity: 'codex',
      outputDir: '/generated-images/',
    })
    expect(config).toEqual({
      provider: 'custom',
      model: 'gpt-image-1',
      baseUrl: 'https://host/v1',
      apiKey: 'sk-1',
      size: '1536x1024',
      quality: 'max',
      identity: 'codex',
      outputDir: 'generated-images',
      promptEnhance: 'auto',
    })
  })

  it('keeps prompt enhancement on by default and only turns it off explicitly', () => {
    expect(normalizeImageGenConfig({}).promptEnhance).toBe('auto')
    expect(normalizeImageGenConfig({ promptEnhance: 'off' }).promptEnhance).toBe('off')
    expect(normalizeImageGenConfig({ promptEnhance: 'nonsense' }).promptEnhance).toBe('auto')
  })

  it('flags which providers can actually run', () => {
    expect(imageGenActive(normalizeImageGenConfig({ provider: 'codex' }))).toBe(true)
    expect(imageGenActive(normalizeImageGenConfig({ provider: 'custom', baseUrl: '' }))).toBe(false)
    expect(imageGenActive(normalizeImageGenConfig({ provider: 'off' }))).toBe(false)
  })
})

describe('normalizeImageGenArgs', () => {
  it('requires a prompt and clamps n', () => {
    expect(normalizeImageGenArgs({})).toEqual({ error: 'prompt 不能为空' })
    expect(normalizeImageGenArgs({ prompt: 'a', n: 99 })).toMatchObject({ prompt: 'a', n: 4 })
  })

  it('normalizes transparent + format', () => {
    expect(normalizeImageGenArgs({ prompt: '图标', background: 'transparent', outputFormat: 'webp', size: '1024x1024' })).toEqual({
      prompt: '图标',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      background: 'transparent',
      outputFormat: 'webp',
    })
  })
})

describe('detectImageExt', () => {
  it('sniffs real bytes instead of trusting the requested format', () => {
    expect(detectImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('png')
    expect(detectImageExt(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpeg')
    expect(detectImageExt(Buffer.from('RIFF0000WEBPVP8 ', 'ascii'))).toBe('webp')
    expect(detectImageExt(Buffer.from('not an image at all', 'ascii'))).toBeNull()
  })
})

describe('inspectPng', () => {
  function pngHeader(width: number, height: number, colorType: number): Buffer {
    const buf = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
    buf.writeUInt32BE(width, 16)
    buf.writeUInt32BE(height, 20)
    buf[24] = 8
    buf[25] = colorType
    return buf
  }

  it('reads size and alpha-channel presence', () => {
    expect(inspectPng(pngHeader(1024, 1536, 6))).toEqual({ width: 1024, height: 1536, hasAlpha: true })
    expect(inspectPng(pngHeader(1024, 1024, 2))).toEqual({ width: 1024, height: 1024, hasAlpha: false })
    expect(inspectPng(Buffer.from('not a png at all, really not', 'ascii'))).toBeNull()
  })
})
