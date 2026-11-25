import { normalizeGrowQuestionFormat, type GrowQuestionFormat } from '@shared/grow-question'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { GROW_KICKOFF_HEADING } from './grow-kickoff'

/** 聊天区澄清轮次：智能体按协议输出 ```grow-round 代码块，前端解析成卡片 */

export interface GrowRoundQuestion extends GrowQuestionFormat {
  id: string
  q: string
  why?: string
}

export interface GrowRound {
  session: string
  round: number
  questions: GrowRoundQuestion[]
}

const FENCE_RE = /```grow-round\s*([\s\S]*?)```/g

function normalizeRound(raw: unknown): GrowRound | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<GrowRound> & { questions?: unknown }
  if (typeof r.session !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.session)) return null
  if (!Array.isArray(r.questions)) return null
  const questions: GrowRoundQuestion[] = []
  for (const q of r.questions as Array<Partial<GrowRoundQuestion>>) {
    if (!q || typeof q.id !== 'string' || typeof q.q !== 'string') continue
    if (!q.id.trim() || !q.q.trim()) continue
    questions.push({
      ...normalizeGrowQuestionFormat(q.kind, q.options),
      id: q.id.trim().slice(0, 64),
      q: q.q.trim().slice(0, 500),
      why: typeof q.why === 'string' ? q.why.trim().slice(0, 500) || undefined : undefined,
    })
  }
  if (questions.length === 0) return null
  return {
    session: r.session,
    round: typeof r.round === 'number' ? r.round : 1,
    questions: questions.slice(0, 8),
  }
}

/** 从 assistant 文本里抠出所有 grow-round 块，并返回去掉代码块后的正文 */
export function extractGrowRounds(text: string): { cleanText: string; rounds: GrowRound[] } {
  const rounds: GrowRound[] = []
  FENCE_RE.lastIndex = 0
  const cleanText = String(text ?? '').replace(FENCE_RE, (_m, body: string) => {
    try {
      const round = normalizeRound(JSON.parse(body))
      if (!round) return _m
      rounds.push(round)
      return ''
    } catch {
      return _m
    }
  })
  return { cleanText, rounds }
}

/** 最新一次 /澄清 的目录由开场消息确定。历史只加载到一半时，可以从已完成的问答卡片恢复。 */
export function findGrowSessionId(items: readonly TimelineItem[]): string | undefined {
  let roundSession: string | undefined
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    const text = item.text ?? ''
    if (item.type === 'user-message' && text.startsWith(GROW_KICKOFF_HEADING)) {
      const protocol = text.split('流程约定（必须遵守）：').at(-1) ?? ''
      const kickoff = /^\r?\n1\. 本轮会话 id 是 ([A-Za-z0-9_-]{1,64})，数据文件是 \.文档\/grow-me\/\1\/tree\.json/.exec(protocol)
      if (kickoff) return kickoff[1]
    }
    if (!roundSession && item.type === 'assistant-message' && text.includes('```grow-round')) {
      roundSession = extractGrowRounds(text).rounds.at(-1)?.session
    }
  }
  return roundSession
}

/** 通知右侧需求树面板刷新（GrowPanel 会监听） */
export function notifyGrowChanged(): void {
  window.dispatchEvent(new CustomEvent('grow:state-changed'))
}
