import { describe, expect, it } from 'vitest'
import { looksLikeComplaint } from './feedback-lessons'
import { formatTokenSpeed } from './token-speed-stats'

/**
 * 「负面提示词」的第一道闸门：什么算用户不满意。
 * 这里钉的是「宁可漏也不要滥杀」——正常的提问与业务陈述不能被记成批评，
 * 否则档案会被噪声灌满，用户也不会再愿意看它。
 */
describe('looksLikeComplaint', () => {
  it('catches the ways the user actually corrects me', () => {
    for (const text of [
      '你怎么又把测试跳过了',
      '你又自作主张改了我的配置',
      '我说过不要动 schema',
      '重写一遍，别用行话了',
      '全部回滚，这版不行',
      '太丑了，这个按钮看不清',
      '根本用不了，点了没反应',
      '服了，我又白等半小时',
      '你没在听我说话吧？',
    ]) {
      expect(looksLikeComplaint(text), text).toBe(true)
    }
  })

  it('leaves normal questions and business talk alone', () => {
    for (const text of [
      '为什么没有输出？',
      '这个接口怎么调？',
      '不对，这里应该是 X 才对',
      '把登录页改成两栏',
      '重命名这个项目',
      '能不能加一个导出按钮？',
    ]) {
      expect(looksLikeComplaint(text), text).toBe(false)
    }
  })

  it('does not mistake knowledge statements for complaints', () => {
    for (const text of [
      '你应该知道这个接口的用法',
      '我要求过报销流程要走OA',
    ]) {
      expect(looksLikeComplaint(text), text).toBe(false)
    }
  })

  it('catches direct corrections and spaced-out commands', () => {
    for (const text of [
      '你写错了',
      '别再乱改我的文件',
      '你能不能别再乱改了',
    ]) {
      expect(looksLikeComplaint(text), text).toBe(true)
    }
  })

  it('ignores pasted logs inside code fences', () => {
    const text = '看下这个日志\n```\nERROR 你怎么又错了\n```'
    expect(looksLikeComplaint(text)).toBe(false)
  })

  it('ignores unclosed fences too', () => {
    expect(looksLikeComplaint('看下这个日志\n```\n你怎么又错了')).toBe(false)
  })
})

describe('formatTokenSpeed', () => {
  it('never shows a bare dash when a real rate is known', () => {
    expect(formatTokenSpeed(85.3)).toBe('85.3 tok/s')
    expect(formatTokenSpeed(142.6)).toBe('143 tok/s')
    expect(formatTokenSpeed(85, '~')).toBe('~85 tok/s')
    expect(formatTokenSpeed(85.34, '~')).toBe('~85.3 tok/s')
  })

  it('falls back to a dash only when there is no data at all', () => {
    expect(formatTokenSpeed(null)).toBe('—')
    expect(formatTokenSpeed(0)).toBe('—')
  })
})
