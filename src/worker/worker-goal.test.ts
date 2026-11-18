import { afterEach, describe, expect, it } from 'vitest'
import {
  goalExtension,
  goalSectionForTest,
  setGoalSection,
  withGoal,
  handleSetGoal,
} from './worker-goal'

afterEach(() => setGoalSection(null))

const event = (sections: Record<string, string> = {}) => ({ systemPrompt: 'base', systemPromptOptions: { sections } })

describe('worker goal section', () => {
  it('keeps blank input out of the prompt', () => {
    setGoalSection('   ')
    expect(goalSectionForTest()).toBeNull()
    expect(withGoal(event())).toBeUndefined()
  })

  it('writes the goal into structured prompt sections (no prompt replacement)', () => {
    setGoalSection('目标 A\n1. [未达成] 验收一')
    const e = event({ project: 'keep' })
    expect(withGoal(e)).toBeUndefined()
    expect(e.systemPromptOptions.sections).toEqual({ project: 'keep', goal: '目标 A\n1. [未达成] 验收一' })
  })

  it('removes the section when the goal is cleared, leaving capability sections alone', () => {
    setGoalSection('目标 A')
    const e = event({ project: 'keep', desktop_browser: '# browser', goal: '目标 A' })
    setGoalSection(null)
    expect(withGoal(e)).toBeUndefined()
    expect(e.systemPromptOptions.sections).toEqual({ project: 'keep', desktop_browser: '# browser' })
  })

  it('falls back to appending the section for SDKs without structured sections', () => {
    setGoalSection('目标 B')
    const result = withGoal({ systemPrompt: 'base' })
    expect(result?.systemPrompt).toBe('base\n\n<goal>\n目标 B\n</goal>')
    setGoalSection(null)
    expect(withGoal({ systemPrompt: 'base' })).toBeUndefined()
  })

  it('registers a hidden inline extension on before_agent_start', () => {
    const ext = goalExtension as unknown as { name: string; hidden?: boolean; factory: (api: unknown) => void }
    expect(ext.name).toBe('pi-desktop-goal')
    expect(ext.hidden).toBe(true)
    const captured: { handler?: (event: unknown) => unknown } = {}
    ext.factory({ on: (name: string, fn: (event: unknown) => unknown) => { if (name === 'before_agent_start') captured.handler = fn } })
    expect(captured.handler).toBeTypeOf('function')
    setGoalSection('目标 C')
    const e = event()
    captured.handler?.(e)
    expect(e.systemPromptOptions.sections).toEqual({ goal: '目标 C' })
  })

  it('accepts the goal from the transport message', async () => {
    let payload: Record<string, unknown> = {}
    await handleSetGoal({ type: 'setGoal', goal: '目标 D' }, (reply) => { payload = reply as Record<string, unknown> })
    expect(payload).toEqual({ ok: true, hasGoal: true })
    expect(goalSectionForTest()).toBe('目标 D')
    await handleSetGoal({ type: 'setGoal', goal: null }, (reply) => { payload = reply as Record<string, unknown> })
    expect(payload).toEqual({ ok: true, hasGoal: false })
  })
})
