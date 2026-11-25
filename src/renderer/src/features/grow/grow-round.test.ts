import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { buildGrowKickoff } from './grow-kickoff'
import { extractGrowRounds, findGrowSessionId } from './grow-round'

const BLOCK = '```grow-round\n{"session": "g-1", "round": 2, "questions": [{"id": "q1", "q": "给谁用？", "why": "定用户群"}]}\n```'

describe('extractGrowRounds', () => {
  it('parses a fence and strips it from the display text', () => {
    const { cleanText, rounds } = extractGrowRounds(`先聊两句\n${BLOCK}\n后记`)
    expect(rounds).toHaveLength(1)
    expect(rounds[0].session).toBe('g-1')
    expect(rounds[0].round).toBe(2)
    expect(rounds[0].questions[0].q).toBe('给谁用？')
    expect(cleanText).not.toContain('grow-round')
    expect(cleanText).toContain('先聊两句')
  })

  it('returns empty rounds for plain text', () => {
    const { cleanText, rounds } = extractGrowRounds('普通回复，没有代码块')
    expect(rounds).toHaveLength(0)
    expect(cleanText).toBe('普通回复，没有代码块')
  })

  it('keeps a broken fence untouched so nothing is swallowed', () => {
    const broken = '```grow-round\n{not json\n```'
    const { cleanText, rounds } = extractGrowRounds(broken)
    expect(rounds).toHaveLength(0)
    expect(cleanText).toContain('{not json')
  })

  it('reads valid question formats and keeps invalid choices available for repair', () => {
    const questions = [
      { id: 'q1', q: '哪些人群？', kind: 'multiple', options: ['应届生', '在职人群'] },
      { id: 'q2', q: '选几个？', kind: 'single', options: ['一个', '三个'] },
      { id: 'q3', q: '还有什么？', kind: 'text' },
      { id: 'q4', q: '想选什么？', kind: 'single', options: ['同一项', ' 同一项 '] },
    ]
    const { rounds } = extractGrowRounds('```grow-round\n' + JSON.stringify({ session: 'g-1', round: 1, questions }) + '\n```')
    expect(rounds[0].questions.slice(0, 3)).toMatchObject(questions.slice(0, 3))
    expect(rounds[0].questions[3]).toMatchObject({ id: 'q4', q: '想选什么？' })
    expect(rounds[0].questions[3].kind).toBeUndefined()
  })

  it('supports multiple rounds in one message', () => {
    const second = BLOCK.replace('"round": 2', '"round": 3')
    const { rounds } = extractGrowRounds(`${BLOCK}\n${second}`)
    expect(rounds.map((r) => r.round)).toEqual([2, 3])
  })

  it('matches a single-line fence', () => {
    const { rounds, cleanText } = extractGrowRounds('看这题 ```grow-round {"session": "g-1", "round": 1, "questions": [{"id": "q1", "q": "给谁用？"}]}``` 就行')
    expect(rounds).toHaveLength(1)
    expect(cleanText).not.toContain('grow-round')
  })
})

describe('findGrowSessionId', () => {
  const message = (id: string, type: TimelineItem['type'], text: string): TimelineItem => ({ id, type, text, timestamp: 1 })

  it('switches to the new kickoff before its first round is generated', () => {
    expect(findGrowSessionId([
      message('1', 'user-message', buildGrowKickoff('g-old', '旧需求')),
      message('2', 'assistant-message', BLOCK.replace('g-1', 'g-old')),
      message('3', 'user-message', buildGrowKickoff('g-new', '新需求')),
    ])).toBe('g-new')
  })

  it('can identify a session from a card in partially loaded history', () => {
    expect(findGrowSessionId([message('1', 'assistant-message', BLOCK)])).toBe('g-1')
    expect(findGrowSessionId([message('1', 'user-message', '你好')])).toBeUndefined()
  })
})
