import { describe, expect, it } from 'vitest'
import {
  GOAL_LOOP_STALL_LIMIT,
  decideGoalLoop,
  goalContinuationPrompt,
  goalPromptSection,
  goalRemaining,
  normalizeGoalCriteria,
  parseGoalCriteriaText,
  parseGoalProgress,
  type SessionGoal,
} from './session-goal'

function goal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    sessionFile: 'C:/w/a.jsonl',
    goal: '首页 banner 抽成组件',
    criteria: [
      { text: '背景图已生成', done: false },
      { text: '高度 700px', done: true },
      { text: '移动端不塌陷', done: false },
    ],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe('goalRemaining', () => {
  it('counts unmet criteria and tolerates a missing list', () => {
    expect(goalRemaining(goal().criteria)).toBe(2)
    expect(goalRemaining([])).toBe(0)
    expect(goalRemaining(null)).toBe(0)
  })
})

describe('normalizeGoalCriteria', () => {
  it('trims, drops blank lines, de-duplicates and caps the count', () => {
    expect(normalizeGoalCriteria([' a ', '', '  ', 'b', 'a'])).toEqual(['a', 'b'])
    expect(normalizeGoalCriteria(Array.from({ length: 30 }, (_, i) => `c${i}`))).toHaveLength(12)
  })

  it('truncates an over-long criterion instead of dropping it', () => {
    const long = 'x'.repeat(500)
    expect(normalizeGoalCriteria([long])[0]).toHaveLength(200)
  })

  it('splits the editor textarea one criterion per line', () => {
    expect(parseGoalCriteriaText('一\r\n二\n\n 二 \n三')).toEqual(['一', '二', '三'])
  })
})

describe('goalPromptSection', () => {
  it('renders the goal, the numbered criteria and the progress contract', () => {
    const text = goalPromptSection(goal())
    expect(text).toContain('首页 banner 抽成组件')
    expect(text).toContain('1. [未达成] 背景图已生成')
    expect(text).toContain('2. [已达成] 高度 700px')
    expect(text).toContain('GOAL-PROGRESS:')
  })

  it('returns null without a goal so the section can be removed', () => {
    expect(goalPromptSection(null)).toBeNull()
    expect(goalPromptSection(goal({ goal: '   ' }))).toBeNull()
  })

  it('asks for criteria instead of inventing them when the goal has none', () => {
    const text = goalPromptSection(goal({ criteria: [] }))
    expect(text).toContain('还没有验收标准')
    expect(text).not.toContain('GOAL-PROGRESS')
  })
})

describe('parseGoalProgress', () => {
  it('reads the reported indices as 1-based criteria numbers', () => {
    expect(parseGoalProgress('干活\nGOAL-PROGRESS: 1,3', 3)).toEqual([1, 3])
    expect(parseGoalProgress('GOAL-PROGRESS: 3 1 1', 3)).toEqual([1, 3])
  })

  it('treats none as "no new progress" and a bare prefix as no report at all', () => {
    expect(parseGoalProgress('GOAL-PROGRESS: none', 3)).toEqual([])
    expect(parseGoalProgress('GOAL-PROGRESS:', 3)).toBeNull()
  })

  it('ignores the contract being quoted inside prose or an example bullet', () => {
    expect(parseGoalProgress('我会按约定输出 GOAL-PROGRESS: 1', 3)).toBeNull()
    expect(parseGoalProgress('- `GOAL-PROGRESS: 1,3`（本轮完成后达到的标准编号）', 3)).toBeNull()
    expect(parseGoalProgress('- 每轮回复的最后单独一行输出进度：`GOAL-PROGRESS: 2`', 3)).toBeNull()
  })

  it('ignores missing lines and out-of-range indices', () => {
    expect(parseGoalProgress('nothing here', 3)).toBeNull()
    expect(parseGoalProgress('GOAL-PROGRESS: 4,0,2', 3)).toEqual([2])
    expect(parseGoalProgress('GOAL-PROGRESS: 1', 0)).toBeNull()
  })

  it('uses the last reported line (the model may draft one first)', () => {
    expect(parseGoalProgress('GOAL-PROGRESS: 1\n…\nGOAL-PROGRESS: 2', 3)).toEqual([2])
  })

  it('reads the indices when the model annotates the line (a bare-number report is the rare case)', () => {
    // 真实模型几乎总会加说明；只认纯数字会丢掉真进度 → 误判「连亏 3 轮」停机。
    expect(parseGoalProgress('GOAL-PROGRESS: 1,3（背景图已生成，高度待调）', 3)).toEqual([1, 3])
    expect(parseGoalProgress('GOAL-PROGRESS: 2 — 移动端不塌陷已验证', 3)).toEqual([2])
    expect(parseGoalProgress('GOAL-PROGRESS: none（本轮只做了调研）', 3)).toEqual([])
    // 但仍不能拿复述指令往自己脸上贴金：注解里出现我们自己的规则片段就算复述
    expect(parseGoalProgress('GOAL-PROGRESS: 1,3（本轮完成后达到的标准编号）', 3)).toBeNull()
  })

  it('tolerates markdown decoration and trailing punctuation around the value', () => {
    expect(parseGoalProgress('**GOAL-PROGRESS:** `1`', 3)).toEqual([1])
    expect(parseGoalProgress('GOAL-PROGRESS: 1, 3.', 3)).toEqual([1, 3])
  })
})

describe('decideGoalLoop (brake)', () => {
  it('stops when nothing is left, without touching the round counter', () => {
    const result = decideGoalLoop({ remaining: 0, previous: { stalledRounds: 2, lastRemaining: 1, rounds: 4 } })
    expect(result.decision).toBe('done')
    expect(result.next.rounds).toBe(4)
  })

  it('continues the first round and records the baseline', () => {
    const result = decideGoalLoop({ remaining: 2, previous: null })
    expect(result.decision).toBe('continue')
    expect(result.next).toEqual({ stalledRounds: 0, lastRemaining: 2, rounds: 1 })
  })

  it('resets the stall counter when remaining drops', () => {
    const result = decideGoalLoop({ remaining: 1, previous: { stalledRounds: 2, lastRemaining: 2, rounds: 3 } })
    expect(result.decision).toBe('continue')
    expect(result.next).toMatchObject({ stalledRounds: 0, rounds: 4 })
  })

  it(`stops after ${GOAL_LOOP_STALL_LIMIT} rounds without a drop`, () => {
    let previous = decideGoalLoop({ remaining: 2, previous: null }).next
    const decisions: string[] = []
    for (let i = 0; i < GOAL_LOOP_STALL_LIMIT; i += 1) {
      const result = decideGoalLoop({ remaining: 2, previous })
      decisions.push(result.decision)
      previous = result.next
    }
    expect(decisions).toEqual(['continue', 'continue', 'stalled'])
  })

  it('caps a loop that keeps making tiny progress', () => {
    let previous = decideGoalLoop({ remaining: 40, previous: null }).next
    let decision = 'continue'
    for (let i = 0; i < 30 && decision === 'continue'; i += 1) {
      const result = decideGoalLoop({ remaining: 39 - i, previous, maxRounds: 5 })
      decision = result.decision
      previous = result.next
    }
    expect(decision).toBe('capped')
  })

  it('uses the explicit baseline when the caller tracked the round start', () => {
    const result = decideGoalLoop({
      remaining: 1,
      previous: { stalledRounds: 0, lastRemaining: 5, rounds: 1 },
      baselineRemaining: 1,
    })
    expect(result.next.stalledRounds).toBe(1)
  })
})

describe('goalContinuationPrompt', () => {
  it('names the remaining count and the progress contract', () => {
    const text = goalContinuationPrompt(0)
    expect(text).toContain('还剩 1 项')
    expect(text).toContain('GOAL-PROGRESS')
  })
})
