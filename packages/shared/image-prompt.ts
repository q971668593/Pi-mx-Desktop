/**
 * 生图提示词的「体检 + 补齐」。
 *
 * 背景：用户说「生成一张喜茶国庆海报，要有中国元素，符合品牌风格」时，模型只能按
 * 自己的默认审美出图——于是得到红金国潮模板。这不是模型降智，是描述里没有设计约束。
 *
 * 维度划分参考 GitHub 上的开源提示词工程（2026-11 实查）：
 *   - freestylefly/awesome-gpt-image-2 的 docs/templates.md（"Prompt as Code"，
 *     21 套工业级模板：任务 → 主视觉 → 版式 → 风格 → 色彩 → 光线 → 文字 → 输出 → 约束）
 *   - YouMind-OpenLab/awesome-gpt-image-2、Evolink-AI/awesome-gpt-image-2-API-Prompts
 *     （同类模板库，用来校验维度是否齐）
 *   - wuyoscar/GPT-Image2-Skill（agentic skill 形态，强调把提示词写成可复用模板）
 *
 * 这里不依赖网络、不调用大模型：纯规则打分 + 模板补齐，离线可用、可测、可控。
 */

export type ImagePromptAspectKey =
  | 'subject'
  | 'composition'
  | 'style'
  | 'palette'
  | 'lighting'
  | 'material'
  | 'typography'
  | 'spec'
  | 'constraints'

export type ImagePromptAspect = {
  key: ImagePromptAspectKey
  label: string
  /** 命中即认为这一维已经交代过 */
  detect: RegExp
  /** 缺失时补上的那句话（可含 {主色} 之类的占位，由调用方替换） */
  fill: string
  /** 打分权重：越「决定观感」的维度分越高 */
  weight: number
}

/**
 * 九个维度按「对成图的影响」排序：主体与构图最容易缺，也最影响观感。
 * 检测用词表而非模型，宁可漏判也别误判——误判会把用户的意图覆盖掉。
 */
export const IMAGE_PROMPT_ASPECTS: readonly ImagePromptAspect[] = [
  {
    key: 'subject',
    label: '主体',
    detect: /(人物|模特|剪影|手|杯|茶|瓶|产品|礼盒|动物|鹤|鸟|山|水|云|花|树|建筑|塔|门|城|街|房间|海报|图标|logo|界面|截图|插画|角色|主体|person|model|silhouette|cup|bottle|product|animal|crane|mountain|cloud|flower|building|poster|icon|ui|screenshot|character)/i,
    fill: '主视觉：一个明确的主体占据画面中心区域，周围留出呼吸空间',
    weight: 18,
  },
  {
    key: 'composition',
    label: '版式构图',
    detect: /(居中|左对齐|右对齐|对角线|对称|三分|网格|留白|满版|通栏|近景|特写|全景|俯拍|平视|仰拍|构图|版式|布局|栅格|单张|三联|centered|left-aligned|diagonal|symmetr|grid|whitespace|negative space|close-up|wide shot|composition|layout)/i,
    fill: '版式：单张主视觉、居中构图、大面积留白，信息层级清晰，元素不堆叠',
    weight: 14,
  },
  {
    key: 'style',
    label: '风格',
    detect: /(极简|简约|复古|未来|科技|国潮|水墨|手绘|插画|矢量|扁平|写实|摄影|胶片|拍立得|丝网|risograph|版画|磨砂|玻璃拟态|3d|渲染|波普|赛博|工业设计|品牌视觉|杂志|编辑|minimal|retro|futuristic|ink|hand-drawn|illustration|vector|flat|realistic|photo|film|risograph|editorial|brand)/i,
    fill: '风格：当代品牌视觉，克制、干净、编辑感强，避免廉价模板感',
    weight: 16,
  },
  {
    key: 'palette',
    label: '配色',
    detect: /(色|配色|主色|辅色|强调色|黑白|灰|米白|朱红|大红|藏青|莫兰迪|低饱和|撞色|单色|渐变|color|palette|monochrome|black and white|pastel|muted|accent|#\d{3,6})/i,
    fill: '配色：以米白/浅灰为底，黑色为主体色，全图只用一个强调色，总色数不超过 4 个',
    weight: 14,
  },
  {
    key: 'lighting',
    label: '光线',
    detect: /(光|逆光|侧光|顺光|顶光|柔光|硬光|高光|阴影|棚拍|自然光|霓虹|明暗|冷调|暖调|打光|lighting|backlit|rim light|soft light|hard light|shadow|studio|neon|warm|cool)/i,
    fill: '光线：柔和均匀的主光，弱对比、无彩色光斑，阴影干净',
    weight: 10,
  },
  {
    key: 'material',
    label: '材质质感',
    detect: /(质感|纹理|纸|宣纸|牛皮纸|金属|玻璃|陶瓷|布|木|水泥|颗粒|噪点|磨砂|油墨|颗粒感|texture|paper|metal|glass|ceramic|fabric|wood|grain|noise|matte)/i,
    fill: '质感：细腻纸纹与轻微颗粒，印刷质感，不要塑料高光',
    weight: 8,
  },
  {
    key: 'typography',
    label: '文字与排版',
    detect: /(文字|字体|标题|副标题|文案|字号|排版|手写|书法|黑体|宋体|衬线|无衬线|中文|英文|wordmark|typography|title|headline|serif|sans|caption)/i,
    fill: '文字：只排给定的确切文案，逐字照抄、不增不减；没给文案就不要生成任何文字，留白交给后期排版',
    weight: 10,
  },
  {
    key: 'spec',
    label: '输出规格',
    detect: /(竖版|横版|方图|比例|\d+\s*[:：]\s*\d+|1:1|4:5|3:4|16:9|9:16|2:3|1024|1536|分辨率|高清|高分辨率|portrait|landscape|square|aspect ratio|resolution|4k|8k)/i,
    fill: '输出：竖版 2:3（1024×1536），高分辨率，主体清晰锐利',
    weight: 8,
  },
  {
    key: 'constraints',
    label: '负向约束',
    detect: /(不要|禁止|避免|勿|别|排除|去掉|no |avoid|without|exclude|not include|negative)/i,
    fill: '避免：水印、签名、多余文字、拼贴感、廉价渐变、错别字、重复元素',
    weight: 12,
  },
] as const

export type ImagePromptAnalysis = {
  score: number
  level: 'vague' | 'ok' | 'professional'
  present: ImagePromptAspectKey[]
  missing: ImagePromptAspectKey[]
  missingLabels: string[]
  /** 给 agent 看的一句话结论 */
  hint: string
}

/** 60 分以下视为「不够专业」：大约缺三到四个维度。 */
export const IMAGE_PROMPT_PROFESSIONAL_SCORE = 60

export function analyzeImagePrompt(prompt: string): ImagePromptAnalysis {
  const text = String(prompt || '').trim()
  const total = IMAGE_PROMPT_ASPECTS.reduce((sum, aspect) => sum + aspect.weight, 0)
  const present: ImagePromptAspectKey[] = []
  const missing: ImagePromptAspectKey[] = []
  let earned = 0
  for (const aspect of IMAGE_PROMPT_ASPECTS) {
    if (aspect.detect.test(text)) {
      present.push(aspect.key)
      earned += aspect.weight
    } else {
      missing.push(aspect.key)
    }
  }
  // 太短的描述几乎一定没交代细节，额外扣分，避免「一句话里恰好有『色』字」就满分。
  const shortPenalty = text.length < 30 ? 12 : text.length < 60 ? 6 : 0
  const score = Math.max(0, Math.min(100, Math.round((earned / total) * 100) - shortPenalty))
  const level = score >= 80 ? 'professional' : score >= IMAGE_PROMPT_PROFESSIONAL_SCORE ? 'ok' : 'vague'
  const missingLabels = missing.map((key) => IMAGE_PROMPT_ASPECTS.find((aspect) => aspect.key === key)?.label || key)
  const hint =
    level === 'professional'
      ? '描述已经够专业，直接出图'
      : `描述缺 ${missingLabels.length} 个维度（${missingLabels.join('、')}），按模板补齐后再出图`
  return { score, level, present, missing, missingLabels, hint }
}

export type ImagePromptPreset = 'auto' | 'brand-poster' | 'product' | 'ui' | 'illustration'

export type BuildEnhancedPromptOptions = {
  /** 只补这些维度；不传就补分析出的缺失项 */
  aspects?: ImagePromptAspectKey[]
  /** 预设：给不同题材换一套默认补齐句 */
  preset?: ImagePromptPreset
  /** 输出比例，例如 1024x1536 */
  size?: string
  /** 品牌锚点，例如「喜茶 HEYTEA」；有值时会强化风格与配色建议 */
  brand?: string
}

export type EnhancedPrompt = {
  prompt: string
  /** 补了哪些维度 */
  added: ImagePromptAspectKey[]
  addedLabels: string[]
  /** 原有描述（原样保留在最前面，不覆盖用户意图） */
  original: string
  score: number
  scoreAfter: number
}

const PRESET_FILLS: Record<Exclude<ImagePromptPreset, 'auto'>, Partial<Record<ImagePromptAspectKey, string>>> = {
  'brand-poster': {
    composition: '版式：单张主视觉、居中或对角线构图、大面积留白（不少于 35%），只留一处视觉焦点',
    style: '风格：当代品牌海报，克制、编辑感强，像品牌 campaign 而不是促销图',
    palette: '配色：米白/浅灰打底，黑色文字为主，全图只用一个强调色（推荐朱红），总色数不超过 4 个',
    lighting: '光线：均匀柔光，弱对比，无彩色光斑',
    material: '质感：细腻纸纹、轻微丝网印颗粒，避免塑料高光与廉价渐变',
    typography: '文字：只排给定的确切文案，逐字照抄；没给文案就不生成文字，避免错字与事实错误',
    constraints: '避免：水印、多余文案、拼贴、彩虹渐变、实物产品堆叠、错别字',
  },
  product: {
    composition: '版式：产品居中或略偏一侧，干净台面，留白充足，不堆道具',
    style: '风格：商业静物摄影，真实材质，干净布光',
    lighting: '光线：大面积柔光箱 + 一侧轮廓光，阴影干净有方向',
    material: '质感：真实材质细节（玻璃、金属、纸），不要塑料感',
    constraints: '避免：变形、多余手指、文字乱码、品牌 logo 错误、过曝',
  },
  ui: {
    composition: '版式：顶部导航 + 卡片流，栅格对齐，间距统一',
    style: '风格：现代极简界面设计，扁平，克制',
    typography: '文字：界面文案清晰可读、层级分明，中文零错字',
    constraints: '避免：重叠元素、错位、模糊文字、多余装饰',
  },
  illustration: {
    style: '风格：手绘插画，线条干净，构图有意留白',
    material: '质感：纸面颗粒与水性颜料边缘',
    constraints: '避免：3D 渲染感、照片纹理、杂乱背景',
  },
}

function sizeToRatio(size?: string): string {
  const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(size || '').trim())
  if (!match) return ''
  const width = Number(match[1])
  const height = Number(match[2])
  if (!width || !height) return ''
  const divisor = (a: number, b: number): number => (b === 0 ? a : divisor(b, a % b))
  const d = divisor(width, height)
  return `${Math.round(width / d)}:${Math.round(height / d)}`
}

function brandHints(brand: string): Partial<Record<ImagePromptAspectKey, string>> {
  const name = brand.trim()
  if (!name) return {}
  return {
    style: `风格：贴合 ${name} 的品牌语言，克制、极简、留白充分，不要通用国潮模板`,
    palette: `配色：遵循 ${name} 的品牌色，黑白灰为主、单一强调色，总色数不超过 4 个`,
  }
}

/**
 * 把「一句话需求」补成可用的生图提示词：原句一字不改放在最前面，后面按缺失维度追加。
 * 已经交代过的维度不再重复，避免把提示词写成同义反复。
 */
export function buildEnhancedPrompt(prompt: string, options: BuildEnhancedPromptOptions = {}): EnhancedPrompt {
  const original = String(prompt || '').trim()
  const analysis = analyzeImagePrompt(original)
  const preset = options.preset && options.preset !== 'auto' ? PRESET_FILLS[options.preset] : {}
  const brand = options.brand ? brandHints(options.brand) : {}
  const wanted = options.aspects?.length ? options.aspects : analysis.missing

  const added: ImagePromptAspectKey[] = []
  const lines: string[] = []
  for (const key of wanted) {
    const aspect = IMAGE_PROMPT_ASPECTS.find((item) => item.key === key)
    if (!aspect) continue
    let fill = brand[key] || preset[key] || aspect.fill
    if (key === 'spec' && options.size) {
      const ratio = sizeToRatio(options.size)
      fill = `输出：${ratio ? `${ratio} ` : ''}${options.size}，高分辨率，主体清晰锐利`
    }
    if (lines.includes(fill)) continue
    lines.push(fill)
    added.push(key)
  }

  const text = [original, ...lines].filter(Boolean).join('\n')
  return {
    prompt: text,
    added,
    addedLabels: added.map((key) => IMAGE_PROMPT_ASPECTS.find((aspect) => aspect.key === key)?.label || key),
    original,
    score: analysis.score,
    scoreAfter: analyzeImagePrompt(text).score,
  }
}

/** 是否需要自动增强：描述不够专业且用户没关掉这条通道。 */
export function shouldEnhanceImagePrompt(prompt: string, mode: 'auto' | 'off' | undefined): boolean {
  if (mode === 'off') return false
  return analyzeImagePrompt(prompt).score < IMAGE_PROMPT_PROFESSIONAL_SCORE
}

// ───────────────────────── 发送前的清洗 ─────────────────────────

/**
 * 占位符是给人看的，不是给模型看的。
 *
 * 实测：agent 写了「标题占位【主标题】/【副标题】」这种模板，生图模型会把它当正文，
 * 于是海报上印着「[主标题]」三个方块字——用户看到的第一眼就是"这什么垃圾"。
 * 这里在发送前把带占位符的句子换成"不生成文字"，并把"占位符保持空白可替换"
 * 这类只说给后期排版听的句子一起摘掉。
 */
const PLACEHOLDER = /(?:[[［【{｛<＜][^\]］】}｝>＞\n]{1,12}[\]］】}｝>＞])/g
const META_TEXT_SENTENCE =
  /(占位符|占位|文字.{0,6}空白|空白.{0,6}可替换|可替换.{0,4}文字|后期.{0,4}排版|留给后期|排版占位)/

export type SanitizeResult = {
  prompt: string
  /** 被摘掉的占位符原文，例如 ['[主标题]', '【副标题】'] */
  placeholders: string[]
  /** 有几句话被替换成「不生成文字」 */
  replaced: number
  /** 是否真的改过 */
  changed: boolean
}

export const NO_TEXT_INSTRUCTION = '画面内不生成任何文字，留出干净留白'

export function sanitizeImagePrompt(prompt: string): SanitizeResult {
  const source = String(prompt || '')
  const placeholders = [...new Set(source.match(PLACEHOLDER) || [])]
  if (!placeholders.length && !META_TEXT_SENTENCE.test(source)) {
    return { prompt: source, placeholders: [], replaced: 0, changed: false }
  }
  const sentences = source.split(/(?<=[。！？；\n])/)
  const kept: string[] = []
  let replaced = 0
  let injected = false
  for (const sentence of sentences) {
    const hitPlaceholder = PLACEHOLDER.test(sentence)
    PLACEHOLDER.lastIndex = 0
    const hitMeta = META_TEXT_SENTENCE.test(sentence)
    if (!hitPlaceholder && !hitMeta) {
      kept.push(sentence)
      continue
    }
    replaced += 1
    if (!injected) {
      kept.push(NO_TEXT_INSTRUCTION + '。')
      injected = true
    }
    // 含占位符的句子往往还带着版式信息（「左侧竖排标题占位」）：摘掉占位符后保留；
    // 只剩元描述（「文字占位符保持空白可替换」）的句子直接丢。
    if (!hitPlaceholder) continue
    const stripped = sentence
      .replace(PLACEHOLDER, '')
      .replace(/[「」『』“”"'（）()【】［］]/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^(标题|副标题|品牌名|文字|文案)[:：]?\s*$/, '')
      .replace(/占位/g, '位置')
      .trim()
    if (stripped.replace(/[。！？；\s]/g, '').length >= 4) {
      kept.push(/[。！？；]$/.test(stripped) ? stripped : stripped + '。')
    }
  }
  const cleaned = kept.join('').replace(/\n{3,}/g, '\n\n').trim()
  return { prompt: cleaned || source, placeholders, replaced, changed: cleaned !== source }
}

// ───────────────────────── 透明素材 ─────────────────────────

/**
 * 「透明」是内容层面的诉求，不该靠用户去设置页找开关。
 * 命中这些词就按透明素材处理（PNG + transparent），并让模型知道背景要留空。
 */
const TRANSPARENT_WANTED =
  /(透明|去背|去底|抠图|抠出|无背景|背景透明|transparent|cut[\s-]?out|no background|isolated)/i
const TRANSPARENT_DENIED = /(不要透明|不需要透明|不透明|non[-\s]?transparent|不透明背景)/i

export function wantsTransparentBackground(prompt: string): boolean {
  const text = String(prompt || '')
  if (TRANSPARENT_DENIED.test(text)) return false
  return TRANSPARENT_WANTED.test(text)
}

/** 透明素材的补充约束：别在透明区画白色底、别做投影白边。 */
export const TRANSPARENT_CONSTRAINT =
  '背景必须是完全透明的 alpha 通道（PNG），主体边缘干净，不要白色底、不要投影底纹、不要棋盘格占位图'
