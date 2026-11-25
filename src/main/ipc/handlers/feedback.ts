import { registerHandler } from '../registry'
import {
  addLesson,
  addLessonRule,
  applyLessonVerdict,
  deleteLesson,
  deleteLessonRule,
  getLessonsInjectIntoContext,
  lessonsForSummary,
  listFeedback,
  pendingLessonCount,
  setLessonStatus,
  setLessonsInjectIntoContext,
} from '../../feedback-lessons-store'
import { judgeLessonWithModel, summarizeLessonsWithModel } from '../../lesson-judge'

/**
 * 教训档案（「负面提示词」）的 IPC。
 *
 * 抓取 → 判断 → 沉淀成规则，全在本地：判断和总结各走一次内置模型的一次性调用，
 * 不占会话、不打断对话。任何判断失败都把条目保留成「待确认」，不吞掉用户的话。
 */
export function registerFeedbackHandlers(): void {
  registerHandler('ipc:feedback.list', async () => ({
    ...listFeedback(),
    counts: pendingLessonCount(),
    injectIntoContext: getLessonsInjectIntoContext(),
  }))

  registerHandler('ipc:feedback.inject.set', async (req: { enabled?: boolean }) => {
    const ok = setLessonsInjectIntoContext(req?.enabled !== false)
    return { ok, injectIntoContext: getLessonsInjectIntoContext() }
  })

  registerHandler('ipc:feedback.report', async (req: {
    text?: string
    source?: 'auto' | 'manual'
    context?: { sessionFile?: string; sessionTitle?: string; workspacePath?: string; model?: string }
  }) => {
    const lesson = addLesson({
      text: String(req?.text || ''),
      source: req?.source === 'manual' ? 'manual' : 'auto',
      context: req?.context,
    })
    if (!lesson) return { ok: false, error: 'empty_text' }
    // 手动记的创建即 kept（见 addLesson），不跑模型判断：
    // 直接落库返回，再跑一次最长 60s 的判断只会把弹窗卡在 busy 上。
    if (lesson.source === 'manual') {
      return { ok: true, lesson, counts: pendingLessonCount() }
    }
    if (lesson.status !== 'pending') {
      // 重复上报（一分钟内的同一句）直接返回已有结论，不再浪费一次判断。
      return { ok: true, lesson, counts: pendingLessonCount() }
    }
    const verdict = await judgeLessonWithModel({
      text: lesson.text,
      context: [
        lesson.context?.sessionTitle ? `对话：${lesson.context.sessionTitle}` : '',
        lesson.context?.workspacePath ? `项目：${lesson.context.workspacePath}` : '',
      ].filter(Boolean).join(' · '),
      model: req?.context?.model,
    })
    const updated = applyLessonVerdict(lesson.id, verdict)
    return { ok: true, lesson: updated ?? lesson, counts: pendingLessonCount() }
  })

  registerHandler('ipc:feedback.setStatus', async (req: { id?: string; status?: string }) => {
    const status = req?.status === 'kept' || req?.status === 'dropped' ? req.status : 'pending'
    const ok = setLessonStatus(String(req?.id || ''), status)
    return { ok, counts: pendingLessonCount() }
  })

  registerHandler('ipc:feedback.delete', async (req: { id?: string }) => {
    const ok = deleteLesson(String(req?.id || ''))
    return { ok, counts: pendingLessonCount() }
  })

  /** 让模型把教训（+ 用户临时补充）归纳成一条规则。 */
  registerHandler('ipc:feedback.summarize', async (req: {
    instruction?: string
    lessonIds?: string[]
    model?: string
    polarity?: 'negative' | 'positive'
    save?: boolean
  }) => {
    const lessons = lessonsForSummary(Array.isArray(req?.lessonIds) ? req.lessonIds : undefined)
    if (!lessons.length && !req?.instruction?.trim()) {
      return { ok: false, error: 'no_material' }
    }
    const summary = await summarizeLessonsWithModel({
      lessons: lessons.map((lesson) => lesson.text),
      instruction: req?.instruction,
      model: req?.model,
    })
    if (!summary.ok) return { ok: false, error: summary.error || 'summarize_failed' }
    const polarity = req?.polarity === 'positive' || req?.polarity === 'negative'
      ? req.polarity
      : summary.polarity
    if (req?.save === false) {
      return { ok: true, rule: null, draft: { title: summary.title, body: summary.body, polarity } }
    }
    const rule = addLessonRule({
      title: summary.title,
      body: summary.body,
      polarity,
      fromLessonIds: lessons.map((lesson) => lesson.id),
    })
    return { ok: true, rule, draft: { title: summary.title, body: summary.body, polarity } }
  })

  registerHandler('ipc:feedback.rule.add', async (req: {
    title?: string
    body?: string
    polarity?: 'negative' | 'positive'
  }) => {
    const body = String(req?.body || '').trim()
    if (!body) return { ok: false, error: 'empty_body' }
    const rule = addLessonRule({
      title: String(req?.title || '手动规则'),
      body,
      polarity: req?.polarity === 'positive' ? 'positive' : 'negative',
      source: 'manual',
    })
    return { ok: true, rule }
  })

  registerHandler('ipc:feedback.rule.delete', async (req: { id?: string }) => ({
    ok: deleteLessonRule(String(req?.id || '')),
  }))
}
