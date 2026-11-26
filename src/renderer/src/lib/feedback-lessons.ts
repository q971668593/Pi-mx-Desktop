import { ipcClient } from '@renderer/lib/ipc-client'

/**
 * 教训档案（负面提示词）的前端入口。
 *
 * 自动抓取：用户发出去的话里带明显的批评/驳回信号时，交给主进程让内置模型判断值不值得记；
 * 半自动：面板里可以手动记一条，也可以让模型把攒下的教训归纳成一条规则。
 * 抓不到（模型不可用、超时）不会丢，条目会留在「待确认」里。
 */
export type LessonStatus = 'pending' | 'kept' | 'dropped'

export type LessonVerdict = {
  worth: boolean
  polarity: 'negative' | 'positive'
  category: string
  reason: string
  rule: string
  model?: string
  judgedAt: number
  error?: string
}

export type Lesson = {
  id: string
  createdAt: number
  text: string
  status: LessonStatus
  source: 'auto' | 'manual'
  context?: { sessionFile?: string; sessionTitle?: string; workspacePath?: string; model?: string }
  verdict?: LessonVerdict
}

export type LessonRule = {
  id: string
  createdAt: number
  title: string
  body: string
  polarity: 'negative' | 'positive'
  fromLessonIds: string[]
  source: 'model' | 'manual'
}

export type FeedbackSnapshot = {
  lessons: Lesson[]
  rules: LessonRule[]
  counts: { pending: number; kept: number; rules: number }
  injectIntoContext: boolean
}

export const EMPTY_FEEDBACK: FeedbackSnapshot = {
  lessons: [],
  rules: [],
  counts: { pending: 0, kept: 0, rules: 0 },
  injectIntoContext: true,
}

export async function loadFeedback(): Promise<FeedbackSnapshot> {
  const res = await ipcClient.invoke('feedback.list', {})
  return {
    lessons: Array.isArray(res?.lessons) ? (res.lessons as Lesson[]) : [],
    rules: Array.isArray(res?.rules) ? (res.rules as LessonRule[]) : [],
    counts: {
      pending: Number(res?.counts?.pending ?? 0) || 0,
      kept: Number(res?.counts?.kept ?? 0) || 0,
      rules: Number(res?.counts?.rules ?? 0) || 0,
    },
    injectIntoContext: res?.injectIntoContext !== false,
  }
}

export async function setLessonsInjectIntoContext(enabled: boolean): Promise<boolean> {
  const res = await ipcClient.invoke('feedback.inject.set', { enabled })
  return res?.injectIntoContext !== false
}

export async function addLessonRule(input: {
  title?: string
  body: string
  polarity?: 'negative' | 'positive'
}): Promise<{ ok: boolean; rule?: LessonRule; error?: string }> {
  return (await ipcClient.invoke('feedback.rule.add', input)) as {
    ok: boolean
    rule?: LessonRule
    error?: string
  }
}

export async function reportLesson(input: {
  text: string
  source?: 'auto' | 'manual'
  context?: Lesson['context']
}): Promise<{ ok: boolean; lesson?: Lesson; error?: string }> {
  return (await ipcClient.invoke('feedback.report', input)) as { ok: boolean; lesson?: Lesson; error?: string }
}

export async function setLessonStatus(id: string, status: LessonStatus): Promise<void> {
  await ipcClient.invoke('feedback.setStatus', { id, status })
}

export async function deleteLesson(id: string): Promise<void> {
  await ipcClient.invoke('feedback.delete', { id })
}

export async function summarizeLessons(input: {
  instruction?: string
  lessonIds?: string[]
  material?: string[]
  polarity?: 'negative' | 'positive'
  model?: string
  save?: boolean
}): Promise<{ ok: boolean; rule?: LessonRule | null; draft?: { title: string; body: string; polarity: 'negative' | 'positive' }; error?: string }> {
  return (await ipcClient.invoke('feedback.summarize', input)) as {
    ok: boolean
    rule?: LessonRule | null
    draft?: { title: string; body: string; polarity: 'negative' | 'positive' }
    error?: string
  }
}

export async function updateLessonRule(id: string, patch: { title?: string; body?: string }): Promise<LessonRule> {
  const res = (await ipcClient.invoke('feedback.rule.update', { id, ...patch })) as { ok: boolean; rule?: LessonRule; error?: string }
  if (!res.ok || !res.rule) throw new Error(res.error || 'update_failed')
  return res.rule
}

export async function deleteLessonRule(id: string): Promise<void> {
  await ipcClient.invoke('feedback.rule.delete', { id })
}

/**
 * 批评/驳回信号。
 *
 * 早些版本用的是 /不对|错了|乱/ 这种裸词，结果「不对，这里应该是 X」「为什么没有输出」
 * 这类正常对话也会被当成批评记下来，档案很快被噪声灌满。
 * 现在要求：必须带第二人称 / 祈使指令 / 明确的返工要求，且纯疑问句豁免。
 */
const COMPLAINT_PATTERNS: RegExp[] = [
  // 直接指着我说：你在…/你给我…/你上次…
  /你(怎么|又|老是|总是|根本|压根|到底)/,
  /你(给我|别再|不要|不能|不该)/,
  // 「我要求过报销流程」是业务陈述：必须带出「对你说过 + 别/不」才算翻旧账。
  /(我|咱)(跟你说|和你说|对你说|说|讲|强调|要求)过(你|别|不|要)/,
  // 最直接的批评之前漏掉了：「你写错了」「你改得不对」
  /你(写|做|改|说|讲|回|给|搞).{0,6}(错|不对|有问题|不行)/,
  // 摊牌式的返工指令
  /重(新)?(做|写|改|来)一?[下遍]?/,
  /(全部|整个|都)?(回滚|撤销|还原)(掉|到|一下)?/,
  // 「别再乱改」中间多个「再」之前就失配：允许再/又/老是插在中间。
  /(别|不要)(再|又|老是|总是)?(自作主张|擅自|乱改|乱动|动|改|碰)/,
  /(白干|白做|又白|浪费时间|返工)/,
  // 明确的能力批评（带程度词，避免「这版不对」这种中性反馈误伤）
  /(太|很|真)(丑|难看|潦草|糟糕|粗糙|不用心)/,
  /(根本|完全)不(对|行|能用|符合)/,
  /(根本|完全|压根)(用不了|不行|没法用|没反应)/,
  /(离谱|服了|受不了|气死|无语|火大)/,
  /(不专业|不动脑子|没动脑子|没在听|有没有在听|没听我说)/,
]

/** 纯疑问句（问为什么 / 问怎么）不算批评：「为什么没有输出」是提问，不是骂人。 */
const QUESTION_ONLY = /[?？]\s*$/
const QUESTION_LEAD = /^(为什么|为啥|怎么会|怎么|是不是|能不能|可不可以|能否)/

const MIN_COMPLAINT_LENGTH = 4

export function looksLikeComplaint(text: string): boolean {
  const value = String(text || '').trim()
  if (value.length < MIN_COMPLAINT_LENGTH) return false
  // 代码块里的东西不算（用户贴日志时容易误伤）。
  // 没闭合的 fence（贴了一半日志）也要从第一个 ``` 起整段去掉，否则日志里的气话会被当正文抓。
  let prose = value.replace(/```[\s\S]*?```/g, '').trim()
  const fence = prose.indexOf('```')
  if (fence >= 0) prose = prose.slice(0, fence).trim()
  if (!prose) return false
  // 纯提问不算批评；带「你」的祈使句即使问号结尾也照抓。
  if (QUESTION_ONLY.test(prose) && QUESTION_LEAD.test(prose) && !/你/.test(prose)) return false
  return COMPLAINT_PATTERNS.some((pattern) => pattern.test(prose))
}

/**
 * 发消息时调用：命中批评信号就上报一条候选，让主进程的模型来判断要不要留。
 * 失败静默——这是后台的事，不能影响发消息。
 */
export function captureLessonFromUserText(
  text: string,
  context?: Lesson['context'],
): void {
  if (!looksLikeComplaint(text)) return
  void reportLesson({ text: text.trim().slice(0, 2000), source: 'auto', context }).catch(() => {})
}
