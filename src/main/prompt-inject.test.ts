import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/pi-desktop-test' } }))
vi.mock('./config-store', () => ({
  configStore: { get: () => ({ enabled: false, text: '', scope: 'global' }) },
}))
vi.mock('./agent-dir', () => ({ resolveActiveAgentDir: () => '/tmp/agent' }))

const { composeInjectFile, hasInjectBlock, stripInjectBlock, promptInjectTarget } = await import('./prompt-inject')

const userText = '# 我的风格\n- 中文回答\n- 先给结论'

describe('stripInjectBlock', () => {
  it('leaves files without a block untouched', () => {
    expect(stripInjectBlock('- keep me\n')).toBe('- keep me')
  })

  it('removes only the marked block and keeps surrounding text', () => {
    const file = `手写内容\n\n${composeInjectFile('', userText, true)}`
    expect(hasInjectBlock(file)).toBe(true)
    const stripped = stripInjectBlock(file)
    expect(stripped).toBe('手写内容')
    expect(hasInjectBlock(stripped)).toBe(false)
  })
})

describe('composeInjectFile', () => {
  it('returns empty content when disabled and there is nothing else', () => {
    expect(composeInjectFile('', userText, false)).toBe('')
  })

  it('writes a block when enabled', () => {
    const out = composeInjectFile('', userText, true)
    expect(out.startsWith('<!-- pi-desktop:prompt-inject:start -->')).toBe(true)
    expect(out).toContain(userText)
    expect(out.trimEnd().endsWith('<!-- pi-desktop:prompt-inject:end -->')).toBe(true)
  })

  it('keeps existing content and appends the block', () => {
    const out = composeInjectFile('手写内容\n', userText, true)
    expect(out.startsWith('手写内容')).toBe(true)
    expect(out).toContain(userText)
  })

  it('replaces the block instead of duplicating it', () => {
    const first = composeInjectFile('手写内容\n', userText, true)
    const second = composeInjectFile(first, '新版提示词', true)
    expect(second.match(/pi-desktop:prompt-inject:start/g)).toHaveLength(1)
    expect(second).toContain('新版提示词')
    expect(second).not.toContain(userText)
    expect(second.startsWith('手写内容')).toBe(true)
  })

  it('strips the block when the user turns it off', () => {
    const on = composeInjectFile('手写内容\n', userText, true)
    expect(composeInjectFile(on, userText, false)).toBe('手写内容\n')
  })

  it('ignores blank text', () => {
    expect(composeInjectFile('手写内容\n', '   \n ', true)).toBe('手写内容\n')
  })
})

describe('promptInjectTarget', () => {
  it('writes to the agent dir for the global scope', () => {
    expect(promptInjectTarget('global', 'F:/proj').replace(/\\/g, '/')).toBe('/tmp/agent/APPEND_SYSTEM.md')
  })

  it('writes to the project .pi dir for the project scope', () => {
    expect(promptInjectTarget('project', 'F:/proj').replace(/\\/g, '/')).toBe('F:/proj/.pi/APPEND_SYSTEM.md')
  })

  it('falls back to global when no project is open', () => {
    expect(promptInjectTarget('project', '').replace(/\\/g, '/')).toBe('/tmp/agent/APPEND_SYSTEM.md')
  })
})
