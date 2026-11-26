import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 教训规则进上下文：开关默认开、渲染稳定、关掉后不再携带。
 *
 * 这里只钉「喂给模型的文本长什么样」：通道推送（worker-manager）和
 * worker 侧 section（worker-lessons）各有自己的测试，这里只保证源头。
 */
const dirs = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? dirs.userData : dirs.userData) },
}))

import {
  addLessonRule,
  buildLessonRulesSection,
  clearFeedbackCacheForTests,
  deleteLessonRule,
  getLessonsInjectIntoContext,
  setLessonsInjectIntoContext,
  updateLessonRule,
} from './feedback-lessons-store'

beforeEach(async () => {
  dirs.userData = await mkdtemp(join(tmpdir(), 'pi-lessons-'))
  clearFeedbackCacheForTests()
})

afterEach(async () => {
  await rm(dirs.userData, { recursive: true, force: true })
})

describe('lesson rules section', () => {
  it('defaults to injecting, and renders nothing when there are no rules', () => {
    expect(getLessonsInjectIntoContext()).toBe(true)
    expect(buildLessonRulesSection()).toBeNull()
  })

  it('renders active rules oldest-first with polarity marks', () => {
    const first = addLessonRule({ title: '表格', body: '报销别用表格', polarity: 'negative' })
    const second = addLessonRule({ title: '列表', body: '用列表', polarity: 'positive' })
    const section = buildLessonRulesSection()
    expect(section).toContain('以下是用户沉淀下来的规则')
    expect(section).toContain('[不要这样做]（表格）报销别用表格')
    expect(section).toContain('[要这样做]（列表）用列表')
    // 最早沉淀的排前面：文本稳定才不会每轮都追加 system 消息。
    expect(section!.indexOf('报销别用表格')).toBeLessThan(section!.indexOf('用列表'))
    expect(first.createdAt).toBeLessThanOrEqual(second.createdAt)
  })

  it('calibrates polarity to how the rule text is actually written', () => {
    // AI 落笔是“应该式”正文却带着纠错来源的负标签：进上下文会变成反话，必须翻正。
    const flipped = addLessonRule({ title: '交付目录', body: '交付前先清理中间文件只保留可覆盖代码', polarity: 'negative' })
    expect(flipped.polarity).toBe('positive')
    // 正文真是禁令的不动。
    const kept = addLessonRule({ title: '表格', body: '报销别用表格', polarity: 'negative' })
    expect(kept.polarity).toBe('negative')
    const section = buildLessonRulesSection()
    expect(section).toContain('[要这样做]（交付目录）')
    expect(section).toContain('[不要这样做]（表格）')
  })

  it('stops injecting when switched off, resumes when switched back on', () => {
    addLessonRule({ title: '表格', body: '报销别用表格', polarity: 'negative' })
    expect(buildLessonRulesSection()).not.toBeNull()
    expect(setLessonsInjectIntoContext(false)).toBe(true)
    expect(getLessonsInjectIntoContext()).toBe(false)
    expect(buildLessonRulesSection()).toBeNull()
    expect(setLessonsInjectIntoContext(true)).toBe(true)
    expect(buildLessonRulesSection()).not.toBeNull()
  })

  it('deleting the last rule removes the section', () => {
    const rule = addLessonRule({ title: '表格', body: '报销别用表格', polarity: 'negative' })
    expect(buildLessonRulesSection()).not.toBeNull()
    expect(deleteLessonRule(rule.id)).toBe(true)
    expect(buildLessonRulesSection()).toBeNull()
  })

  it('updates a settled rule and recalibrates polarity from the new body', () => {
    const rule = addLessonRule({ title: '交付', body: '交付前不要带中间文件', polarity: 'negative' })
    expect(rule.polarity).toBe('negative')
    const updated = updateLessonRule(rule.id, { body: '交付前先清理中间文件只保留可覆盖代码' })
    expect(updated?.polarity).toBe('positive')
    expect(buildLessonRulesSection()).toContain('[要这样做]（交付）')
    expect(updateLessonRule('no-such-id', { body: 'x' })).toBeNull()
    expect(updateLessonRule(rule.id, { body: '   ' })).toBeNull()
  })
})
