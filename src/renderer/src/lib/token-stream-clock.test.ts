import { beforeEach, describe, expect, it, vi } from 'vitest'
import { noteStreamProgress, resetStreamClockForTest, takeStreamActiveMs } from './token-stream-clock'

beforeEach(() => {
  resetStreamClockForTest()
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms)
}

describe('token-stream-clock', () => {
  it('counts only intervals where text grows', () => {
    noteStreamProgress('s1', 0)
    advance(500)
    noteStreamProgress('s1', 100) // +500
    advance(2000) // 工具调用：没长，不计
    noteStreamProgress('s1', 100)
    advance(300)
    noteStreamProgress('s1', 200) // +300
    expect(takeStreamActiveMs()).toBe(800)
  })

  it('caps a single stall at 1.5s', () => {
    noteStreamProgress('s1', 0)
    advance(10_000)
    noteStreamProgress('s1', 50)
    expect(takeStreamActiveMs()).toBe(1500)
  })

  it('resets when the stream id changes and take clears the total', () => {
    noteStreamProgress('s1', 0)
    advance(400)
    noteStreamProgress('s1', 10)
    noteStreamProgress('s2', 0) // 新一轮：旧累计保留，锚点重开
    advance(400)
    noteStreamProgress('s2', 10)
    expect(takeStreamActiveMs()).toBe(800)
    expect(takeStreamActiveMs()).toBe(0)
  })

  it('ignores null stream without crashing', () => {
    noteStreamProgress(null, 0)
    advance(500)
    noteStreamProgress(null, 100)
    expect(takeStreamActiveMs()).toBeGreaterThanOrEqual(0)
  })
})
