import { describe, expect, it } from 'vitest'
import { modelThinkingLevels } from '@shared/model-thinking-levels'
import { projectModelForPreview } from './model-preview-projection'

describe('projectModelForPreview', () => {
  it('keeps the fields the composer derives thinking levels from', () => {
    const projected = projectModelForPreview({
      id: 'deepseek-v4.1-flash',
      provider: 'magpie',
      name: 'DeepSeek V4.1 Flash',
      contextWindow: 1048000,
      maxTokens: 328000,
      reasoning: true,
      thinkingLevelMap: { high: 'high', low: 'low', max: 'max', medium: null, minimal: null, off: null, xhigh: null },
      available: true,
      managedBy: 'active-sdk',
    })

    // 现场：投影丢了 reasoning/thinkingLevelMap → 每个模型都被当成不可推理 → 只有 off
    expect(projected.reasoning).toBe(true)
    expect(projected.thinkingLevelMap).toEqual({
      high: 'high',
      low: 'low',
      max: 'max',
      medium: null,
      minimal: null,
      off: null,
      xhigh: null,
    })
    expect(projected.contextWindow).toBe(1048000)
    expect(projected.maxTokens).toBe(328000)
    // 模拟 ipc:model.list 的推导：投影后仍能算出真正可用的思考程度，而不是只有 off。
    // 该模型把 off/medium/minimal/xhigh 显式映成 null → 与 SDK getSupportedThinkingLevels 一致，只剩三档
    expect(modelThinkingLevels(projected)).toEqual(['low', 'high', 'max'])
  })

  it('copies the thinking map so mutating the projection cannot touch the runtime model', () => {
    const map = { high: 'high' }
    const projected = projectModelForPreview({ id: 'm', provider: 'p', reasoning: true, thinkingLevelMap: map })
    projected.thinkingLevelMap!.high = 'changed'
    expect(map.high).toBe('high')
  })

  it('stays plain data: no host objects, non-reasoning models keep off only', () => {
    const projected = projectModelForPreview({ id: 'm', provider: 'p', auth: { supported: true, configured: true } })
    expect(projected.reasoning).toBeUndefined()
    expect(projected.auth).toEqual({ supported: true, configured: true })
    // 非推理模型确实只支持 off（和 SDK 一致），不能被当成缺字段
    expect(modelThinkingLevels(projected)).toEqual(['off'])
    // 复制而不是引用，避免把带方法的对象传过进程边界
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected)
  })
})
