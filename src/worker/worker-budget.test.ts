import { describe, expect, it } from 'vitest'
import {
  BUDGET_SECTION_KEY,
  budgetView,
  buildBudgetSection,
  countCompactions,
  formatWindow,
  runtimeBudgetExtension,
  snapshotFromContext,
  withRuntimeBudget,
} from './worker-budget'

const event = (sections: Record<string, string> = {}) => ({ systemPrompt: 'base', systemPromptOptions: { sections } })

const ctx = (tokens: number | null, contextWindow: number, compactions = 0) => ({
  getContextUsage: () => ({ tokens, contextWindow, percent: null }),
  sessionManager: {
    getEntries: () => Array.from({ length: compactions }, () => ({ type: 'compaction' })),
  },
})

describe('worker runtime budget', () => {
  it('reports the measured remainder, bucketed so the section text rarely changes', () => {
    // 真实现场：100,501 / 1,048,000 → 剩 90.4%，模型却自称「余量已经不够」
    expect(budgetView({ tokens: 100501, contextWindow: 1048000 })).toEqual({
      contextWindow: 1048000,
      leftPercentBucket: 90,
      known: true,
    })
    // 同一档位内的两个已用量必须产出同一段文本，否则每轮都会往 transcript 追加 system 消息
    const a = buildBudgetSection({ tokens: 100501, contextWindow: 1048000, compactions: 1 })
    const b = buildBudgetSection({ tokens: 95000, contextWindow: 1048000, compactions: 1 })
    expect(a).toBe(b)
    const c = buildBudgetSection({ tokens: 150000, contextWindow: 1048000, compactions: 1 })
    expect(c).not.toBe(a)
  })

  it('keeps "unknown" distinct from "empty": a null token count still ships the section', () => {
    expect(budgetView({ tokens: null, contextWindow: 1048000 })).toEqual({
      contextWindow: 1048000,
      leftPercentBucket: null,
      known: false,
    })
    expect(buildBudgetSection({ tokens: null, contextWindow: 1048000 })).toContain('已用量暂时未知')
    // 连窗口都没有时也不能静默消失，否则模型又只能靠猜
    expect(buildBudgetSection({ tokens: null, contextWindow: 0 })).toContain('未知')
  })

  it('formats the window in a size a model can compare against', () => {
    expect(formatWindow(1048000)).toBe('1.05M')
    expect(formatWindow(200000)).toBe('200k')
    expect(formatWindow(8000)).toBe('8k')
    expect(formatWindow(512)).toBe('512')
  })

  it('enumerates the only allowed reasons to stop, and refuses "not enough budget"', () => {
    const text = buildBudgetSection({ tokens: 100501, contextWindow: 1048000, compactions: 2 })
    expect(text).toContain('≈90%')
    expect(text).toContain('已压缩 2 次')
    expect(text).toContain('产品决策')
    expect(text).toContain('硬阻塞')
    expect(text).toContain('已全部达成')
    expect(text).toContain('都不是停工理由')
    expect(text).toContain('剩余 ≥ 15%')
    expect(text).toContain('最小可验证切片')
    expect(text).toContain('压缩次数多 ≠ 余量少')
  })

  it('writes only its own section, leaving capability and project sections untouched', () => {
    const e = event({ project: 'keep', desktop_pi_ui: '# pi-ui' })
    expect(withRuntimeBudget(e, ctx(100501, 1048000, 1))).toBeUndefined()
    expect(e.systemPromptOptions.sections.project).toBe('keep')
    expect(e.systemPromptOptions.sections.desktop_pi_ui).toBe('# pi-ui')
    expect(e.systemPromptOptions.sections[BUDGET_SECTION_KEY]).toContain('≈90%')
  })

  it('falls back to appending for runtimes without structured sections', () => {
    const result = withRuntimeBudget({ systemPrompt: 'base' }, ctx(100501, 1048000, 1))
    expect(result?.systemPrompt?.startsWith('base\n\n## 运行预算')).toBe(true)
  })

  it('survives a context whose usage or entries are unavailable', () => {
    expect(snapshotFromContext(undefined)).toEqual({ tokens: null, contextWindow: 0, compactions: 0 })
    expect(countCompactions({ sessionManager: { getEntries: () => { throw new Error('boom') } } })).toBe(0)
    expect(withRuntimeBudget(event(), undefined)).toBeUndefined()
  })

  it('registers a before_agent_start hook that reads the live usage each turn', async () => {
    const handlers: Record<string, (event: unknown, ctx?: unknown) => unknown> = {}
    const pi = { on: (name: string, fn: (event: unknown, ctx?: unknown) => unknown) => (handlers[name] = fn) }
    const ext = runtimeBudgetExtension as { name: string; hidden?: boolean; factory: (api: unknown) => void }
    expect(ext.hidden).toBe(true)
    await ext.factory(pi)
    expect(Object.keys(handlers)).toEqual(['before_agent_start'])

    const fresh = event()
    handlers.before_agent_start(fresh, ctx(100501, 1048000, 0))
    expect(fresh.systemPromptOptions.sections[BUDGET_SECTION_KEY]).toContain('≈90%')

    // 下一轮数字变了，同一段原地更新（不是再追加一段）
    const later = event()
    handlers.before_agent_start(later, ctx(600000, 1048000, 1))
    expect(later.systemPromptOptions.sections[BUDGET_SECTION_KEY]).toContain('≈40%')
    expect(Object.keys(later.systemPromptOptions.sections)).toEqual([BUDGET_SECTION_KEY])
  })
})
