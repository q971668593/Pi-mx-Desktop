import { describe, expect, it } from 'vitest'
import { deriveSessionTitle, pickSessionListTitle } from './session-list-title'

describe('deriveSessionTitle', () => {
  it('uses the first non-empty line', () => {
    expect(deriveSessionTitle('\n\n修一下登录超时\n第二条不参与')).toBe('修一下登录超时')
  })

  it('drops @file references', () => {
    expect(deriveSessionTitle('看看 @src/main/index.ts 这段')).toBe('看看 这段')
  })

  it('drops quoted @path references with spaces', () => {
    expect(deriveSessionTitle('检查 @"F:/my dir/a.ts" 的导出')).toBe('检查 的导出')
  })

  it('falls back to the raw line when it is only references', () => {
    expect(deriveSessionTitle('@src/a.ts')).toBe('@src/a.ts')
  })

  it('truncates long titles', () => {
    const title = deriveSessionTitle('一'.repeat(80), 10)
    expect(title).toBe(`${'一'.repeat(10)}…`)
  })

  it('returns an empty string for blank input', () => {
    expect(deriveSessionTitle('   \n\t ')).toBe('')
  })
})

describe('pickSessionListTitle', () => {
  it('prefers the pi name, then the overlay', () => {
    expect(pickSessionListTitle('title', 'name', 'overlay')).toBe('name')
    expect(pickSessionListTitle('title', '', 'overlay')).toBe('overlay')
    expect(pickSessionListTitle('title', '', '')).toBe('title')
  })
})
