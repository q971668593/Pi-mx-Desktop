/**
 * `image_gen` 工具的主进程侧桥：与设置页「试一张」走同一套 generateImages。
 */
import { normalizeImageGenConfig } from '@shared/image-gen'
import { configStore } from '../config-store'
import { authorizeProjectCwd } from '../trusted-workspace'
import { generateImages } from './generate'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

const NEWLINE = String.fromCharCode(10)

export async function handleImageToolRequest(
  data: Record<string, unknown>,
  slot: { cwd: string },
  post: (message: Record<string, unknown>) => void,
): Promise<void> {
  const callId = String(data.callId || '')
  if (!callId) return
  const reply = (payload: unknown, isError = false) =>
    post({
      type: 'image-tool-response',
      callId,
      result: {
        content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
        ...(isError ? { isError: true } : {}),
      } satisfies ToolResult,
    })

  try {
    const project = authorizeProjectCwd(slot.cwd)
    if (!project.ok) return reply(`工作区不可用（${project.error}），先让主人在侧栏打开这个项目`, true)
    const config = normalizeImageGenConfig(configStore.get('imageGen'))
    if (config.provider === 'off') {
      return reply('内置生图未开启：让主人到「设置 → 模型 → 生图」选择 ChatGPT 订阅或自定义中转后再试', true)
    }
    const result = await generateImages({ args: data.args, config, workspaceRoot: project.cwd })
    // 第一行给人看（也进时间线的工具摘要）：路径 + 降智自检告警，别把告警埋在 JSON 里。
    const headline = `已生成 ${result.images.length} 张：${result.images.map((image) => image.rel).join('、')}`
    const warnLines = result.warnings.map((warning) => `⚠ ${warning}`)
    // 提示词被补过就明说：模型要能把「我按哪几维改了描述」告诉用户，而不是默默换掉。
    const promptBits: string[] = []
    if (result.prompt.optimized) {
      promptBits.push(
        `补全 ${result.prompt.added.length} 个维度（${result.prompt.added.join('、')}，专业度 ${result.prompt.score}→${result.prompt.scoreAfter}）`,
      )
    }
    if (result.prompt.cleaned.length) {
      promptBits.push(`摘掉占位符 ${result.prompt.cleaned.join(' ')}（避免被画成正文）`)
    }
    if (result.prompt.background === 'transparent') promptBits.push('按透明素材出图（PNG + alpha）')
    const promptLine = promptBits.length ? `提示词处理：${promptBits.join('；')}` : ''
    return reply(
      [headline, ...(promptLine ? [promptLine] : []), ...warnLines, '', JSON.stringify({
        ok: true,
        provider: result.provider,
        model: result.model,
        images: result.images.map((image) => ({ path: image.path, rel: image.rel, format: image.format, bytes: image.bytes })),
        prompt: result.prompt,
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
        note: '图片已保存到项目里；回复里带上 rel 路径，时间线会自动显示缩略图。prompt.added 非空时，用一句话告诉主人你补了哪些维度',
      }, null, 2)].join(NEWLINE),
    )
  } catch (error) {
    return reply(String((error as Error)?.message || error), true)
  }
}
