import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { sendToMain } from './worker-transport.js'
import type { WorkerIncomingMessage } from './worker-port-types.js'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const pending = new Map<string, { resolve: (value: ToolResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
let sequence = 0

export async function handleImageToolResponse(message: WorkerIncomingMessage): Promise<void> {
  const key = String(message.callId || '')
  const entry = pending.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(key)
  entry.resolve(message.result as ToolResult)
}

function callMain(args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const callId = `image-${process.pid}-${++sequence}`
  return new Promise((resolve, reject) => {
    // 生图是慢请求（订阅接口常见 30-90s，批量更久）：给足 5 分钟。
    const timer = setTimeout(() => {
      pending.delete(callId)
      reject(new Error('image_gen request timed out'))
    }, 300_000)
    pending.set(callId, { resolve, reject, timer })
    signal?.addEventListener('abort', () => {
      const entry = pending.get(callId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(callId)
      reject(new Error('aborted'))
    }, { once: true })
    sendToMain({ type: 'image-tool-request', callId, args })
  })
}

/**
 * `image_gen`：应用内置生图。
 *
 * 不走 MCP 的 magpie 之类的第三方工具链，直接用设置里配好的通道（ChatGPT 订阅授权
 * 或自定义中转）出图，结果落在工作区（默认 `generated-images/`），时间线自动出缩略图。
 * 未配置时工具会返回一句明确的提示，而不是让模型反复试 MCP。
 */
export const imageToolsExtension: InlineExtension = {
  name: 'pi-desktop-image-tools',
  hidden: true,
  factory: (api: ExtensionAPI) => {
    api.registerTool({
      name: 'image_gen',
      label: 'Generate image',
      description:
        'Generate an image with the image model configured in Settings → Models → Image generation (ChatGPT subscription auth or a custom OpenAI-compatible endpoint) and save it into the project (default generated-images/). The prompt is checked against nine visual aspects and auto-completed when it is too vague (subject, composition, style, palette, lighting, texture, typography, output spec, negative constraints); the result reports `prompt.score`, `prompt.scoreAfter` and `prompt.added`. Returns the file paths; the desktop timeline shows thumbnails automatically. Transparent backgrounds need outputFormat=png or webp. If it reports that image generation is not configured, tell the user to enable it in Settings instead of retrying other tools.',
      promptSnippet: 'Generate images with the built-in image model (image_gen) and save them into the project.',
      promptGuidelines: [
        'When the user asks for an image/icon/banner, call image_gen instead of wiring up an external MCP image tool.',
        'Before calling: check the request against the nine aspects (subject, composition/layout, style, palette, lighting, material/texture, typography, output spec, negative constraints). If the user only gave a one-liner, do not hand it to the model as-is — write the missing aspects into the prompt yourself, keeping the user intent intact.',
        'image_gen also auto-completes missing aspects when the prompt scores below 60. Its result contains `prompt.added` — mention in one short sentence which aspects you filled in, so the user knows the description was rewritten.',
        'If the user explicitly wants their wording used verbatim, pass optimize=false.',
        'Never put bracketed placeholders such as [Main title] or 【副标题】 in the prompt: image models render them as literal text. If a layout needs empty space for later typography, write “no text in the image, leave clean whitespace”.',
        'Do not pass a model name — the model comes from Settings; the call has no model override. For transparent assets pass background=transparent with outputFormat=png (auto-detected when the request says 透明/去背/logo/icon).',
        'Ask for transparent backgrounds via background=transparent plus outputFormat=png when the asset needs alpha.',
        'After generating, reference the returned relative path in your reply so the timeline can show the picture.',
      ],
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to draw. Be concrete about subject, style, palette and composition.' },
          n: { type: 'integer', minimum: 1, maximum: 4, description: 'Kept for compatibility: one image per call. Call again for another direction.' },
          size: { type: 'string', enum: ['auto', '1024x1024', '1536x1024', '1024x1536'], description: 'Canvas size; auto lets the service decide.' },
          quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], description: 'Rendering quality; the configured default is high. auto is the cheapest tier and looks noticeably worse.' },
          background: { type: 'string', enum: ['auto', 'transparent', 'opaque'], description: 'transparent requires png/webp output.' },
          outputFormat: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'File format (default png).' },

          optimize: { type: 'boolean', description: 'Default true: auto-complete missing prompt aspects (subject/composition/style/palette/lighting/texture/typography/spec/constraints) before generating. Pass false to send the prompt exactly as written.' },
        },
        required: ['prompt'],
        additionalProperties: false,
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, args, signal) {
        const result = await callMain(args, signal)
        if (result.isError) throw new Error(result.content.map((item) => item.text).join('\n'))
        return { content: result.content, details: {} }
      },
    })
  },
}
