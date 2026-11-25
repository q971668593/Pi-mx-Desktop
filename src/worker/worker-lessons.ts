// 沉淀下来的教训规则：跟着每一轮 prompt 进上下文的 worker 侧扩展。
//
// 和目标栏（worker-goal.ts）同一套机制：主进程在每轮 prompt 前把渲染好的
// 规则文本发过来（'setLessonRules'），这里放进 pi 的结构化 prompt section。
// 文本稳定时 pi 只追加一次 diff，不会每轮都刷屏；规则变了才追加一条 system 消息。
// 关掉（空文本）就删掉这个 section，后面的轮次不再携带。

import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  InlineExtension,
} from '@earendil-works/pi-coding-agent'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'

/** Section key：不能用 `desktop_` 前缀（会被 capabilities 清掉），也不能跟已有键撞名。 */
export const LESSONS_SECTION_KEY = 'user_lessons'

let lessonRulesText: string | null = null

/** `null` / 空白移除 section（开关关了，或者一条规则都没有）。 */
export function setLessonRulesSection(next: unknown): void {
  const text = typeof next === 'string' ? next.trim() : ''
  lessonRulesText = text ? text : null
}

export function lessonRulesSectionForTest(): string | null {
  return lessonRulesText
}

type StartEvent = Pick<BeforeAgentStartEvent, 'systemPrompt'> & {
  systemPromptOptions?: { sections?: Record<string, string> }
}

export function withLessonRules(event: StartEvent): BeforeAgentStartEventResult | undefined {
  const target = event.systemPromptOptions?.sections
  if (target) {
    if (lessonRulesText) target[LESSONS_SECTION_KEY] = lessonRulesText
    else delete target[LESSONS_SECTION_KEY]
    return undefined
  }
  if (!lessonRulesText) return undefined
  return { systemPrompt: `${event.systemPrompt}\n\n<${LESSONS_SECTION_KEY}>\n${lessonRulesText}\n</${LESSONS_SECTION_KEY}>` }
}

export const lessonsExtension: InlineExtension = {
  name: 'pi-desktop-lessons',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event) => withLessonRules(event))
  },
}

export async function handleSetLessonRules(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  setLessonRulesSection((msg as { rules?: unknown }).rules)
  reply({ ok: true, hasRules: lessonRulesText != null })
}
