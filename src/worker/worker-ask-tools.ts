import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { getDesktopUIBridge, type ExtensionUIQuestion } from './desktop-ui-bridge.js'
import type { ExtensionUIQuestionAnswer, ExtensionUIQuestionnaireResult } from './questionnaire-types.js'

/**
 * `ask_user_question`：让模型在对话里弹一个小卡片，把几个选项摆给用户点。
 *
 * 走的是桌面端已有的问卷通道（extension-ui-request → 渲染进程 → extension.respondUI），
 * 所以等待、取消、跨会话、后台提醒这些行为与插件自带的问卷完全一致；区别只是渲染成
 * 时间线里的行内小卡，而不是全屏弹窗。
 */
export function formatAskAnswers(result: ExtensionUIQuestionnaireResult): string {
  if (result.cancelled) {
    return '用户取消了这次提问（没有作答）。不要重复追问；按最保守的假设继续，并在回复里写清你假设了什么。'
  }
  const lines = result.answers.map((answer: ExtensionUIQuestionAnswer, index) => {
    const value =
      answer.kind === 'multi' ? (answer.selected || []).join('、') : answer.answer
    return `${index + 1}. ${answer.question || `问题 ${index + 1}`} → ${value || '（未作答）'}`
  })
  return ['用户的回答：', ...lines].join('\n')
}

export const askToolsExtension: InlineExtension = {
  name: 'pi-desktop-ask-tools',
  hidden: true,
  factory: (api: ExtensionAPI) => {
    api.registerTool({
      name: 'ask_user_question',
      label: 'Ask the user',
      description:
        'Ask the user to pick from a few options when a decision changes what you do next (scope, approach, risk, which file to touch, whether to run a destructive step). Renders a small inline card in the conversation with the options; the answer comes back as text. Use it instead of guessing, and instead of asking a long free-form question in chat. Do not use it for things you can verify yourself.',
      promptSnippet: 'Ask the user a multi-choice question inline with ask_user_question.',
      promptGuidelines: [
        'When a decision is genuinely the user’s (scope, destructive actions, visual direction), call ask_user_question with 2–4 concrete options instead of writing a long question in the reply.',
        'Keep it short: one question, options that are actionable and mutually exclusive; add descriptions only when they change the choice.',
        'If the user cancels, do not ask again — pick the most conservative option and say which assumption you made.',
      ],
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'One short sentence.' },
                header: { type: 'string', description: 'Optional 2–6 字 label shown above the question.' },
                multiSelect: { type: 'boolean', description: 'Allow picking several options.' },
                options: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 6,
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'What the user clicks.' },
                      description: { type: 'string', description: 'One line of trade-off detail.' },
                    },
                    required: ['label'],
                  },
                },
              },
              required: ['question', 'options'],
            },
          },
        },
        required: ['questions'],
        additionalProperties: false,
      } as unknown as ToolDefinition['parameters'],
      async execute(toolCallId, args, signal, _onUpdate, context) {
        const bridge = getDesktopUIBridge((context as { ui?: unknown } | undefined)?.ui)
        const questions = ((args as { questions?: ExtensionUIQuestion[] }).questions || []).filter(
          (question) => question?.question && Array.isArray(question.options) && question.options.length > 0,
        )
        if (!bridge) {
          throw new Error('ask_user_question 只在桌面端可用；请直接在回复里问用户。')
        }
        const result = await bridge.requestQuestionnaire(toolCallId, questions, signal)
        return { content: [{ type: 'text', text: formatAskAnswers(result) }], details: { ...result } }
      },
    })
  },
}
