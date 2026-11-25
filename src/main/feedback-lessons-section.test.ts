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
    expect(section).toContain('以下是用户在历史对话里')
    expect(section).toContain('[不要这样做]（表格）报销别用表格')
    expect(section).toContain('[要这样做]（列表）用列表')
    // 最早沉淀的排前面：文本稳定才不会每轮都追加 system 消息。
    expect(section!.indexOf('报销别用表格')).toBeLessThan(section!.indexOf('用列表'))
    expect(first.createdAt).toBeLessThanOrEqual(second.createdAt)
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
})
