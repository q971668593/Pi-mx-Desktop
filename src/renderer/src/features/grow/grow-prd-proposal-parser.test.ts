import { describe, expect, it } from 'vitest'
import { parseGrowPrdProposals } from './grow-prd-proposal-parser'

const proposal = {
  basePrdHash: 'a'.repeat(64),
  treeSessionId: 'session_1',
  baseTreeRevision: 0,
  reason: '调整需求',
  proposedPrd: '# PRD\n内容',
  nodeChanges: [],
  newQuestions: [],
}
const block = (value: unknown, newline = '\n') =>
  `\`\`\`grow-prd-proposal${newline}${JSON.stringify(value)}${newline}\`\`\``

describe('parseGrowPrdProposals', () => {
  it('提取经过共享 schema 校验的对象，并保留前后原文和原始片段', () => {
    const raw = block(proposal)
    expect(parseGrowPrdProposals(`前文\n${raw}\n后文`)).toEqual([
      { type: 'text', text: '前文\n' },
      { type: 'proposal', proposal, raw },
      { type: 'text', text: '\n后文' },
    ])
  })

  it('按顺序保留多个有效和无效片段，包括 CRLF', () => {
    const first = block(proposal, '\r\n')
    const bad = block({ ...proposal, baseTreeRevision: -1 })
    const secondValue = { ...proposal, reason: '另一个提案' }
    const second = block(secondValue)
    expect(parseGrowPrdProposals(`${first}\r\n${bad}\n${second}`)).toEqual([
      { type: 'proposal', proposal, raw: first },
      { type: 'text', text: `\r\n${bad}\n` },
      { type: 'proposal', proposal: secondValue, raw: second },
    ])
  })

  it.each([
    '```grow-prd-proposal\n{broken}\n```',
    block({ ...proposal, extra: true }),
    block([proposal]),
    block({ ...proposal, nodeChanges: [{ nodeId: 'x', expectedOldAnswer: null, newAnswer: '' }] }),
    '```grow-prd-proposal json\n{}\n```',
    '行内 ```grow-prd-proposal\n{}\n```',
  ])('非法格式原样保留：%s', (message) => {
    expect(parseGrowPrdProposals(message)).toEqual([{ type: 'text', text: message }])
  })

  it('流式快照中的不完整围栏和 JSON 保持原文，完成后才解析', () => {
    const full = `开始\n${block(proposal)}`
    for (const partial of ['开始\n```grow-prd', full.slice(0, -3), full.slice(0, -1)]) {
      expect(parseGrowPrdProposals(partial)).toEqual([{ type: 'text', text: partial }])
    }
    expect(parseGrowPrdProposals(full)).toEqual([
      { type: 'text', text: '开始\n' },
      { type: 'proposal', proposal, raw: block(proposal) },
    ])
  })

  it('忽略其他代码围栏中的示例，保留空消息和普通文本', () => {
    const example = `\`\`\`\`markdown\n${block(proposal)}\n\`\`\`\``
    expect(parseGrowPrdProposals(example)).toEqual([{ type: 'text', text: example }])
    expect(parseGrowPrdProposals('plain')).toEqual([{ type: 'text', text: 'plain' }])
    expect(parseGrowPrdProposals('')).toEqual([])
  })
})
