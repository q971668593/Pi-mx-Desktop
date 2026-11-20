import { describe, expect, it } from 'vitest'
import { formatAskAnswers } from './worker-ask-tools'

describe('formatAskAnswers', () => {
  it('lists picked options so the model can keep going', () => {
    const text = formatAskAnswers({
      cancelled: false,
      answers: [
        { questionIndex: 0, question: '先做哪一屏？', kind: 'option', answer: '移动端' },
        { questionIndex: 1, question: '要不要保留旧导航？', kind: 'multi', answer: '', selected: ['保留', '加一层'] },
      ],
    })
    expect(text).toContain('1. 先做哪一屏？ → 移动端')
    expect(text).toContain('2. 要不要保留旧导航？ → 保留、加一层')
  })

  it('marks an unanswered question instead of inventing an answer', () => {
    const text = formatAskAnswers({
      cancelled: false,
      answers: [{ questionIndex: 0, question: '配色？', kind: 'custom', answer: null }],
    })
    expect(text).toContain('（未作答）')
  })

  it('tells the model to assume conservatively when the user cancels', () => {
    const text = formatAskAnswers({ cancelled: true, answers: [] })
    expect(text).toContain('取消了这次提问')
    expect(text).toContain('最保守的假设')
  })
})
