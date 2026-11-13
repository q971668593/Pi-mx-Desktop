import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPortableDataDirs, resolvePortableDataRoot } from './portable-data-dir'

const tempRoots: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-portable-data-'))
  tempRoots.push(dir)
  return dir
}

afterEach(() => {
  delete process.env.PORTABLE_EXECUTABLE_DIR
  delete process.env.PI_CODING_AGENT_DIR
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('portable data directory', () => {
  it('returns null when unpackaged and no portable dir is set', () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, 'data'))
    expect(
      resolvePortableDataRoot({
        isPackaged: false,
        execPath: join(dir, 'Pi mx.exe'),
      }),
    ).toBeNull()
  })

  it('uses data directory next to packaged executable when present', () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, 'data'))
    const setPath = vi.fn()
    const origExec = process.execPath
    Object.defineProperty(process, 'execPath', { value: join(dir, 'Pi mx.exe'), configurable: true })
    try {
      const resolved = applyPortableDataDirs({ isPackaged: true, setPath })
      expect(resolved).toBe(join(dir, 'data'))
      expect(setPath).toHaveBeenCalledWith('userData', join(dir, 'data', 'userData'))
      expect(setPath).toHaveBeenCalledWith('sessionData', join(dir, 'data', 'sessionData'))
      expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined()
    } finally {
      Object.defineProperty(process, 'execPath', { value: origExec, configurable: true })
    }
  })

  it('keeps PI_CODING_AGENT_DIR unchanged even when data/agent exists', () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, 'data', 'agent'), { recursive: true })
    process.env.PORTABLE_EXECUTABLE_DIR = dir
    const setPath = vi.fn()
    const resolved = applyPortableDataDirs({ isPackaged: true, setPath })
    expect(resolved).toBe(join(dir, 'data'))
    expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined()
  })
})
