import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LessonVerdict } from './lesson-judge'

/**
 * 教训档案（「负面提示词」的素材库）。
 *
 * 用户批评/驳回时记一条候选 → 让内置模型判断值不值得留 → 值得的进档案。
 * 档案里的东西可以再让模型总结成一条规则（正面/负面提示词），规则也能删。
 * 全部存在用户目录的 feedback-lessons.json，不上传。
 * 生效中的规则默认跟着每一轮 prompt 进上下文（新开对话发第一句话时就带上），
 * 可以在设置 → 教训档案里关掉；关掉后只攒着，不再喂给模型。
 */
export type LessonStatus = 'pending' | 'kept' | 'dropped'

export type Lesson = {
  id: string
  createdAt: number
  /** 用户原话里被记下来的那段（最长 2000 字）。 */
  text: string
  status: LessonStatus
  source: 'auto' | 'manual'
  context?: {
    sessionFile?: string
    sessionTitle?: string
    workspacePath?: string
    model?: string
  }
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

type StoreFile = { lessons: Lesson[]; rules: LessonRule[]; injectIntoContext?: boolean }

const MAX_LESSONS = 400
/** 规则也会无限增长：同样封顶，超了先裁最老的。 */
const MAX_RULES = 200

function storePath(): string {
  try {
    return join(app.getPath('userData'), 'feedback-lessons.json')
  } catch {
    return join(tmpdir(), 'pi-desktop-feedback-lessons.json')
  }
}

let cache: StoreFile | null = null
/** 缓存对应的磁盘 mtime：文件被外部改动时自愈。 */
let cacheMtimeMs = -1

function currentMtimeMs(): number {
  try {
    return statSync(storePath()).mtimeMs
  } catch {
    return -1
  }
}

function parseStore(raw: string): StoreFile {
  const parsed = JSON.parse(raw) as StoreFile
  return {
    lessons: Array.isArray(parsed?.lessons) ? parsed.lessons.filter((row) => !!row?.id) : [],
    rules: Array.isArray(parsed?.rules) ? parsed.rules.filter((row) => !!row?.id) : [],
    ...(parsed?.injectIntoContext === false ? { injectIntoContext: false as const } : null),
  }
}

/**
 * 读档案。解析失败时保留上一次缓存，绝不把「半截文件」当空档案：
 * 否则紧接着的一次写入就会把用户攒了很久的教训与规则整份覆盖掉。
 */
function read(): StoreFile {
  const mtime = currentMtimeMs()
  if (cache && mtime === cacheMtimeMs) return cache
  if (mtime === -1) {
    cache = { lessons: [], rules: [] }
    cacheMtimeMs = -1
    return cache
  }
  try {
    cache = parseStore(readFileSync(storePath(), 'utf8'))
    cacheMtimeMs = mtime
    return cache
  } catch {
    return cache ?? { lessons: [], rules: [] }
  }
}

/** 沉淀的规则要不要跟着每一轮 prompt 进上下文：默认进，设置里可关。 */
export function getLessonsInjectIntoContext(): boolean {
  return read().injectIntoContext !== false
}

export function setLessonsInjectIntoContext(enabled: boolean): boolean {
  const data = read()
  const next: StoreFile = { ...data, ...(enabled ? {} : { injectIntoContext: false as const }) }
  if (enabled) delete next.injectIntoContext
  return write(next)
}

/** 原子写：先写 .tmp 再 rename，进程被杀也不会留下半截 JSON。 */
function write(next: StoreFile): boolean {
  const file = storePath()
  const tmp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, file)
    cache = next
    cacheMtimeMs = currentMtimeMs()
    return true
  } catch {
    // 落盘失败时不能把内存里的缓存换成「没保存成功」的内容，否则界面会显示假数据。
    return false
  }
}

/**
 * 条数上限裁剪：以前直接从尾部砍，会先砍掉最早 kept（恰恰是最有价值的那批），
 * 还会让规则里的 fromLessonIds 变成悬空引用。
 * 现在按 dropped → pending → kept 的优先级裁剪，kept 只在数量仍然超限时才按最早截断。
 */
function pruneLessons(lessons: Lesson[], rules: LessonRule[]): { lessons: Lesson[]; rules: LessonRule[] } {
  let nextLessons = lessons
  let nextRules = rules
  if (nextLessons.length > MAX_LESSONS) {
    const order: Record<LessonStatus, number> = { dropped: 0, pending: 1, kept: 2 }
    // 第三键 id：同毫秒批量写入时不吃输入顺序，保证每次裁掉的都是同一批。
    const sorted = [...nextLessons].sort((a, b) => order[a.status] - order[b.status] || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const drop = new Set(sorted.slice(0, nextLessons.length - MAX_LESSONS).map((row) => row.id))
    nextLessons = nextLessons.filter((row) => !drop.has(row.id))
    // 被裁掉的 lesson 不能在规则里留悬空引用：只清理引用，不删规则本身。
    if (drop.size > 0) {
      nextRules = nextRules.map((rule) => ({
        ...rule,
        fromLessonIds: rule.fromLessonIds.filter((id) => !drop.has(id)),
      }))
    }
  }
  if (nextRules.length > MAX_RULES) {
    nextRules = [...nextRules]
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, MAX_RULES)
  }
  return { lessons: nextLessons, rules: nextRules }
}

export function listFeedback(): { lessons: Lesson[]; rules: LessonRule[] } {
  const data = read()
  return {
    lessons: [...data.lessons].sort((a, b) => b.createdAt - a.createdAt),
    rules: [...data.rules].sort((a, b) => b.createdAt - a.createdAt),
  }
}

/** 状态栏角标要的数字：留下来了但还没归纳成规则的条数。 */
export function pendingLessonCount(): { pending: number; kept: number; rules: number } {
  const data = read()
  return {
    pending: data.lessons.filter((row) => row.status === 'pending').length,
    kept: data.lessons.filter((row) => row.status === 'kept').length,
    rules: data.rules.length,
  }
}

export function addLesson(input: {
  text: string
  source?: 'auto' | 'manual'
  context?: Lesson['context']
}): Lesson | null {
  const text = String(input.text || '').trim().slice(0, 2000)
  if (!text) return null
  const data = read()
  // 同一句话一分钟内不重复记（自动抓取容易重复触发）
  const duplicate = data.lessons.find(
    (row) => row.text === text && Date.now() - row.createdAt < 60_000,
  )
  if (duplicate) {
    // 同一句话先被自动抓过（可能模型判成 dropped），用户后来又手动记了：
    // 手动意图必须升格，否则界面点了「记一条」却看不到任何变化。
    // 旧 verdict 必须清空：留着「不值得/失败」的结论会和 kept 打架，前端展示理由时自相矛盾。
    if (input.source === 'manual' && duplicate.source !== 'manual') {
      const { verdict: _dropped, ...rest } = duplicate
      const upgraded: Lesson = { ...rest, source: 'manual', status: 'kept' }
      write({ ...data, lessons: data.lessons.map((row) => (row.id === duplicate.id ? upgraded : row)) })
      return upgraded
    }
    return duplicate
  }
  // 手动记的从创建起就是「已留存」：不跑模型判断（feedback.ts 里 manual 直接落库），
  // 状态必须与 60s 内重复上报走升格路径的结果一致，否则新记的掉进「待确认」还选不进总结材料。
  const isManual = input.source === 'manual'
  const lesson: Lesson = {
    id: randomUUID(),
    createdAt: Date.now(),
    text,
    status: isManual ? 'kept' : 'pending',
    source: isManual ? 'manual' : 'auto',
    context: input.context,
  }
  const pruned = pruneLessons([lesson, ...data.lessons], data.rules)
  write({ ...data, lessons: pruned.lessons, rules: pruned.rules })
  return lesson
}

export function applyLessonVerdict(id: string, verdict: LessonVerdict): Lesson | null {
  const data = read()
  const target = data.lessons.find((row) => row.id === id)
  if (!target) return null
  // 用户手动记的一律留下；自动抓的要模型说值得才留。
  const failSoft = !!verdict.error
  const status: LessonStatus = verdict.worth || target.source === 'manual'
    ? 'kept'
    : failSoft
      ? 'pending'
      : 'dropped'
  const lessons = data.lessons.map((row) => (row.id === id ? { ...row, status, verdict } : row))
  write({ ...data, lessons })
  return lessons.find((row) => row.id === id) ?? null
}

export function deleteLesson(id: string): boolean {
  const data = read()
  const lessons = data.lessons.filter((row) => row.id !== id)
  if (lessons.length === data.lessons.length) return false
  write({ ...data, lessons })
  return true
}

export function setLessonStatus(id: string, status: LessonStatus): boolean {
  const data = read()
  let changed = false
  const lessons = data.lessons.map((row) => {
    if (row.id !== id) return row
    changed = true
    return { ...row, status }
  })
  if (changed) write({ ...data, lessons })
  return changed
}

export function addLessonRule(input: {
  title: string
  body: string
  polarity: 'negative' | 'positive'
  fromLessonIds?: string[]
  source?: 'model' | 'manual'
}): LessonRule {
  const data = read()
  const rule: LessonRule = {
    id: randomUUID(),
    createdAt: Date.now(),
    title: String(input.title || '未命名规则').slice(0, 120),
    body: String(input.body || '').slice(0, 4000),
    polarity: input.polarity === 'positive' ? 'positive' : 'negative',
    fromLessonIds: Array.isArray(input.fromLessonIds) ? input.fromLessonIds : [],
    source: input.source === 'manual' ? 'manual' : 'model',
  }
  const pruned = pruneLessons(data.lessons, [rule, ...data.rules])
  write({ ...data, lessons: pruned.lessons, rules: pruned.rules })
  return rule
}

export function deleteLessonRule(id: string): boolean {
  const data = read()
  const rules = data.rules.filter((row) => row.id !== id)
  if (rules.length === data.rules.length) return false
  write({ ...data, rules })
  return true
}

/**
 * 把生效中的教训规则渲染成进上下文的文本：开关关了、一条规则没有都返回 null
 * （worker 侧收到 null 就删掉这个 section，后面的轮次不再携带）。
 * 按 createdAt + id 排序保证文本稳定：规则不变时 pi 不会重复追加 system 消息。
 */
export function buildLessonRulesSection(): string | null {
  if (getLessonsInjectIntoContext()) {
    const rules = [...listFeedback().rules].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (rules.length > 0) {
      const lines = rules.map((rule, index) => {
        const mark = rule.polarity === 'positive' ? '要这样做' : '不要这样做'
        const title = rule.title?.trim() ? `（${rule.title.trim()}）` : ''
        return `${index + 1}. [${mark}]${title}${rule.body.trim()}`
      })
      return `以下是用户在历史对话里批评、驳回、纠正后沉淀下来的教训请严格遵守：\n${lines.join('\n')}`
    }
  }
  return null
}

/** 供「让 AI 总结成规则」用：把留下的教训拼成一段材料。 */
export function lessonsForSummary(ids?: string[]): Lesson[] {
  const data = read()
  const picked = ids && ids.length
    ? data.lessons.filter((row) => ids.includes(row.id))
    : data.lessons.filter((row) => row.status === 'kept')
  return picked.sort((a, b) => a.createdAt - b.createdAt)
}

export function feedbackStoreExists(): boolean {
  return existsSync(storePath())
}

export function clearFeedbackCacheForTests(): void {
  cache = null
  cacheMtimeMs = -1
}

/** 测试/诊断用：损坏时的兜底备份。 */
export function backupFeedbackStore(suffix = 'bak'): string | null {
  const file = storePath()
  if (!existsSync(file)) return null
  try {
    copyFileSync(file, `${file}.${suffix}`)
    return `${file}.${suffix}`
  } catch {
    return null
  }
}
