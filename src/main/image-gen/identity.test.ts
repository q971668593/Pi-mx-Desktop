import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildImageHeaders, codexUserAgent, deviceId, resetDeviceIdCacheForTests } from './identity'

afterEach(() => {
  resetDeviceIdCacheForTests()
  delete process.env.PI_IMAGE_DEVICE_DIR
})

describe('buildImageHeaders', () => {
  it('web identity looks like the chatgpt.com web app and carries no third-party marker', () => {
    const headers = buildImageHeaders({
      accessToken: 'tok',
      accountId: 'acct',
      identity: 'web',
      deviceId: 'device-1',
      sessionId: 'sess-1',
    })
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['chatgpt-account-id']).toBe('acct')
    expect(headers['user-agent']).toContain('Chrome/')
    expect(headers['sec-ch-ua']).toContain('Chromium')
    expect(headers.origin).toBe('https://chatgpt.com')
    expect(headers['oai-device-id']).toBe('device-1')
    expect(headers['session-id']).toBe('sess-1')
    // 关键：不再出现第三方名字
    expect(headers.originator).toBeUndefined()
    expect(JSON.stringify(headers)).not.toMatch(/pi-desktop|dsh-chatgpt-login/)
  })

  it('codex identity matches the official CLI defaults (originator=codex_cli_rs)', () => {
    const headers = buildImageHeaders({
      accessToken: 'tok',
      accountId: 'acct',
      identity: 'codex',
      deviceId: 'device-1',
      sessionId: 'sess-2',
      codexVersion: '9.8.7',
    })
    expect(headers.originator).toBe('codex_cli_rs')
    expect(headers['user-agent']).toBe(codexUserAgent('9.8.7'))
    expect(headers['user-agent']).toMatch(/^codex_cli_rs\/9\.8\.7 \(.+; .+\) vscode\//)
    expect(headers['session-id']).toBe('sess-2')
    expect(headers['thread-id']).toBe('sess-2')
    // CLI 不是浏览器：不该带 Origin/Referer，否则反而自相矛盾
    expect(headers.origin).toBeUndefined()
    expect(headers.referer).toBeUndefined()
  })
})

describe('deviceId', () => {
  it('persists a stable id per user data dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-device-'))
    try {
      const first = deviceId(dir)
      expect(first).toMatch(/^[0-9a-f-]{16,64}$/i)
      expect(existsSync(join(dir, 'image-gen-device.json'))).toBe(true)
      resetDeviceIdCacheForTests()
      expect(deviceId(dir)).toBe(first)
      expect(JSON.parse(readFileSync(join(dir, 'image-gen-device.json'), 'utf8')).id).toBe(first)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to an in-memory id when it cannot write', () => {
    const spy = vi.spyOn(process, 'cwd')
    spy.mockReturnValue('Z:\\nope')
    const id = deviceId(null)
    expect(id).toMatch(/^[0-9a-f-]{16,64}$/i)
    expect(deviceId(null)).toBe(id)
    spy.mockRestore()
  })
})
