import { afterEach, describe, expect, it } from 'vitest'
import {
  LESSONS_SECTION_KEY,
  handleSetLessonRules,
  lessonRulesSectionForTest,
  lessonsExtension,
  setLessonRulesSection,
  withLessonRules,
} from './worker-lessons'

afterEach(() => setLessonRulesSection(null))

const event = (sections: Record<string, string> = {}) => ({ systemPrompt: 'base', systemPromptOptions: { sections } })

describe('worker lessons section', () => {
  it('keeps blank input out of the prompt', () => {
    setLessonRulesSection('   ')
    expect(lessonRulesSectionForTest()).toBeNull()
    expect(withLessonRules(event())).toBeUndefined()
  })

  it('writes the rules into structured prompt sections without touching others', () => {
    setLessonRulesSection('1. [不要这样做]别用表格')
    const e = event({ project: 'keep' })
    expect(withLessonRules(e)).toBeUndefined()
    expect(e.systemPromptOptions.sections).toEqual({ project: 'keep', [LESSONS_SECTION_KEY]: '1. [不要这样做]别用表格' })
  })

  it('removes the section when rules are cleared', () => {
    const e = event({ project: 'keep', [LESSONS_SECTION_KEY]: 'old' })
    setLessonRulesSection(null)
    expect(withLessonRules(e)).toBeUndefined()
    expect(e.systemPromptOptions.sections).toEqual({ project: 'keep' })
  })

  it('falls back to appending the section for SDKs without structured sections', () => {
    setLessonRulesSection('rules text')
    const result = withLessonRules({ systemPrompt: 'base' })
    expect(result?.systemPrompt).toBe(`base\n\n<${LESSONS_SECTION_KEY}>\nrules text\n</${LESSONS_SECTION_KEY}>`)
    setLessonRulesSection(null)
    expect(withLessonRules({ systemPrompt: 'base' })).toBeUndefined()
  })

  it('registers a hidden inline extension on before_agent_start', () => {
    const ext = lessonsExtension as unknown as { name: string; hidden?: boolean; factory: (api: unknown) => void }
    expect(ext.name).toBe('pi-desktop-lessons')
    expect(ext.hidden).toBe(true)
    const captured: { handler?: (event: unknown) => unknown } = {}
    ext.factory({ on: (name: string, fn: (event: unknown) => unknown) => { if (name === 'before_agent_start') captured.handler = fn } })
    expect(captured.handler).toBeTypeOf('function')
    setLessonRulesSection('rules text')
    const e = event()
    captured.handler?.(e)
    expect(e.systemPromptOptions.sections).toEqual({ [LESSONS_SECTION_KEY]: 'rules text' })
  })

  it('accepts the rules from the transport message', async () => {
    let payload: Record<string, unknown> = {}
    await handleSetLessonRules({ type: 'setLessonRules', rules: 'rules text' } as never, (reply) => { payload = reply as Record<string, unknown> })
    expect(payload).toEqual({ ok: true, hasRules: true })
    expect(lessonRulesSectionForTest()).toBe('rules text')
    await handleSetLessonRules({ type: 'setLessonRules', rules: null } as never, (reply) => { payload = reply as Record<string, unknown> })
    expect(payload).toEqual({ ok: true, hasRules: false })
  })
})
