import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { locateWorkspaceFile, pickLocatedFile } from './workspace-file-locate'

// fd 索引会拉起 electron-store：测试里当作不可用，正好验证无 fd 时的工作区遍历兜底。
vi.mock('./workspace-file-search', () => ({ primeWorkspaceFileSearchIndex: vi.fn(async () => null) }))

describe('pickLocatedFile', () => {
  it('prefers an exact match', () => {
    expect(pickLocatedFile('a/honor.webp', ['a/honor.webp'])).toBe('a/honor.webp')
  })

  it('matches on the multi-segment tail of a short ref', () => {
    const candidates = ['web/public/images/honors/honor-1.webp', 'web/public/images/team/group.webp']
    expect(pickLocatedFile('honors/honor-1.webp', candidates)).toBe('web/public/images/honors/honor-1.webp')
    expect(pickLocatedFile('./team/group.webp', candidates)).toBe('web/public/images/team/group.webp')
  })

  it('matches a bare file name against candidates', () => {
    expect(pickLocatedFile('group.webp', ['a/team/group.webp'])).toBe('a/team/group.webp')
  })

  it('refuses to guess between two same-named files', () => {
    expect(pickLocatedFile('honors/a.webp', ['a/honors/a.webp', 'b/honors/a.webp'])).toBeNull()
  })
})

describe('locateWorkspaceFile', () => {
  const root = join(tmpdir(), `pi-locate-${process.pid}`)

  beforeEach(() => {
    mkdirSync(join(root, 'web', 'public', 'images', 'honors'), { recursive: true })
    writeFileSync(join(root, 'web', 'public', 'images', 'honors', 'honor-1.webp'), 'x')
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'honor-1.webp'), 'x')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('returns a direct workspace-relative path when it exists', async () => {
    expect(await locateWorkspaceFile(root, 'web/public/images/honors/honor-1.webp')).toContain('honor-1.webp')
  })

  it('finds a short ref by its tail and skips node_modules', async () => {
    const found = await locateWorkspaceFile(root, 'honors/honor-1.webp', { preferSuffix: true })
    expect(found?.replace(/\\/g, '/')).toMatch(/web\/public\/images\/honors\/honor-1\.webp$/)
  })

  it('passes an existing absolute path through but never suffix-searches outside the workspace', async () => {
    expect(await locateWorkspaceFile(root, process.execPath, { preferSuffix: true })).toBe(process.execPath)
    expect(await locateWorkspaceFile(root, '../outside/honor-1.webp', { preferSuffix: true })).toBeNull()
  })

  it('returns null when nothing matches', async () => {
    expect(await locateWorkspaceFile(root, 'honors/missing.webp', { preferSuffix: true })).toBeNull()
  })
})
