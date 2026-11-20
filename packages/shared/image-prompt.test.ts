import { describe, expect, it } from 'vitest'
import {
  IMAGE_PROMPT_ASPECTS,
  IMAGE_PROMPT_PROFESSIONAL_SCORE,
  analyzeImagePrompt,
  buildEnhancedPrompt,
  sanitizeImagePrompt,
  shouldEnhanceImagePrompt,
  wantsTransparentBackground,
} from './image-prompt'

/** 用户真实会发的那种一句话需求。 */
const VAGUE = '生成一张喜茶的国庆节海报，要有中国元素，并且符合喜茶的品牌风格'

/** 按仓库里那套模板写出来的专业描述（主体/构图/风格/配色/光线/质感/文字/规格/负向）。 */
const PROFESSIONAL =
  '竖版 2:3 品牌海报：米白纸纹底，居中构图、大面积留白，主体是一只水墨仙鹤与举杯剪影；' +
  '当代品牌视觉、克制极简；配色米白打底、黑色文字、单一朱红强调，总色数 4 个以内；柔光均匀、弱对比；' +
  '细腻纸纹与丝网印颗粒；标题「山河有庆」字号层级分明、中文零错字；输出 1024x1536；' +
  '避免水印、拼贴、彩虹渐变、错别字'

describe('analyzeImagePrompt', () => {
  it('scores a one-line request as vague and names what is missing', () => {
    const result = analyzeImagePrompt(VAGUE)
    expect(result.level).toBe('vague')
    expect(result.score).toBeLessThan(IMAGE_PROMPT_PROFESSIONAL_SCORE)
    // 这句话里既没有版式也没有光线/质感/规格/负向约束
    expect(result.missing).toContain('composition')
    expect(result.missing).toContain('lighting')
    expect(result.missing).toContain('constraints')
    expect(result.hint).toContain('缺')
  })

  it('accepts a template-grade description as professional', () => {
    const result = analyzeImagePrompt(PROFESSIONAL)
    expect(result.level).toBe('professional')
    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.missing).toHaveLength(0)
  })

  it('covers all nine aspects, each with a non-empty fill sentence', () => {
    expect(IMAGE_PROMPT_ASPECTS.map((aspect) => aspect.key)).toEqual([
      'subject',
      'composition',
      'style',
      'palette',
      'lighting',
      'material',
      'typography',
      'spec',
      'constraints',
    ])
    for (const aspect of IMAGE_PROMPT_ASPECTS) {
      expect(aspect.fill.length).toBeGreaterThan(6)
      expect(aspect.weight).toBeGreaterThan(0)
    }
  })
})

describe('buildEnhancedPrompt', () => {
  it('keeps the original wording and only appends missing aspects', () => {
    const built = buildEnhancedPrompt(VAGUE, { size: '1024x1536' })
    expect(built.prompt.startsWith(VAGUE)).toBe(true)
    expect(built.added.length).toBeGreaterThan(2)
    expect(built.addedLabels).toContain('版式构图')
    expect(built.scoreAfter).toBeGreaterThan(built.score)
    // 已经写过的维度不重复补（这句话里已经有「配色」之外的品牌风格描述）
    const lines = built.prompt.split('\n')
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('does not touch a prompt that is already professional', () => {
    const built = buildEnhancedPrompt(PROFESSIONAL)
    expect(built.prompt).toContain('水墨仙鹤')
    expect(built.added.length).toBe(0)
    expect(built.scoreAfter).toBeGreaterThanOrEqual(built.score)
  })

  it('uses the brand preset for posters and respects the requested canvas', () => {
    const built = buildEnhancedPrompt('喜茶国庆海报', { preset: 'brand-poster', size: '1024x1536' })
    const text = built.prompt
    expect(text).toContain('品牌海报')
    expect(text).toContain('1024x1536')
    expect(text).toContain('2:3')
  })

  it('can be limited to specific aspects', () => {
    const built = buildEnhancedPrompt(VAGUE, { aspects: ['constraints'] })
    expect(built.added).toEqual(['constraints'])
    expect(built.prompt).toContain('避免')
  })
})

describe('shouldEnhanceImagePrompt', () => {
  it('enhances vague prompts in auto mode only', () => {
    expect(shouldEnhanceImagePrompt(VAGUE, 'auto')).toBe(true)
    expect(shouldEnhanceImagePrompt(VAGUE, 'off')).toBe(false)
    expect(shouldEnhanceImagePrompt(PROFESSIONAL, 'auto')).toBe(false)
  })
})

describe('sanitizeImagePrompt', () => {
  it('strips bracketed placeholders and forbids drawing text', () => {
    const input =
      '一张喜茶海报。版式：左侧竖排标题占位「[主标题]」，右下角品牌署名「[品牌名]」。文字占位符保持空白可替换。风格：极简。'
    const result = sanitizeImagePrompt(input)
    expect(result.placeholders).toEqual(['[主标题]', '[品牌名]'])
    // 占位符绝不能进提示词：模型会把它们当正文印上去
    expect(result.prompt).not.toContain('[主标题]')
    expect(result.prompt).not.toContain('占位符')
    expect(result.prompt).toContain('不生成任何文字')
    // 版式信息要留下，别把整句删掉
    expect(result.prompt).toContain('左侧竖排标题位置')
  })

  it('leaves a clean prompt untouched', () => {
    const clean = '米白纸底，居中构图，大面积留白，单一朱红强调，柔光，细腻纸纹，竖版 2:3，避免水印'
    const result = sanitizeImagePrompt(clean)
    expect(result.changed).toBe(false)
    expect(result.prompt).toBe(clean)
  })
})

describe('wantsTransparentBackground', () => {
  it('detects transparent assets but honours explicit opt-out', () => {
    expect(wantsTransparentBackground('生成一个透明的茶杯图标，PNG')).toBe(true)
    expect(wantsTransparentBackground('一个去背的贴纸')).toBe(true)
    expect(wantsTransparentBackground('不要透明底的海报')).toBe(false)
    expect(wantsTransparentBackground('一张红金国庆海报')).toBe(false)
  })
})
