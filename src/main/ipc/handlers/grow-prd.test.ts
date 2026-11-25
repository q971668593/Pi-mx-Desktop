import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
vi.mock('../../trusted-workspace', () => ({ authorizeProjectCwd: mocks.authorize, authorizeTrustedSessionFile: vi.fn() }))

import { invokeHandler } from '../registry'
import { registerGrowPrdHandlers } from './grow-prd'

let workspace: string
let prd: string
const invoke = (operation: string, request: Record<string, unknown>) =>
  invokeHandler<{ ok: boolean; data: { hash: string; id: string; content: string; state: string }; error?: string; message?: string }>(`ipc:grow-prd:${operation}`, request)

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'grow-prd-ipc-'))
  prd = join(workspace, '.文档', '开发规范', 'PRD.md')
  await mkdir(join(workspace, '.文档', '开发规范'), { recursive: true })
  await writeFile(prd, 'original')
  mocks.authorize.mockReset().mockReturnValue({ ok: true, cwd: workspace })
  registerGrowPrdHandlers()
})
afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

describe('grow PRD IPC', () => {
  it('reads, drafts and commits only with explicit confirmation', async () => {
    const original = await invoke('read', { workspaceId: workspace })
    expect(original).toMatchObject({ ok: true, data: { content: 'original' } })
    const draft = await invoke('createChange', { workspaceId: workspace, baseHash: original.data.hash, content: 'updated', reason: 'reviewed' })
    expect(draft.ok).toBe(true)
    expect(await invoke('commit', { workspaceId: workspace, id: draft.data.id })).toMatchObject({ ok: false, error: 'INVALID_INPUT' })
    expect(await readFile(prd, 'utf8')).toBe('original')
    expect(await invoke('listIncomplete', { workspaceId: workspace })).toEqual({ ok: true, data: [] })
    expect(await invoke('commit', { workspaceId: workspace, id: draft.data.id, confirmed: true })).toMatchObject({ ok: true, data: { state: 'committed' } })
    expect(await readFile(prd, 'utf8')).toBe('updated')
  })

  it('validates strict schemas before authorization', async () => {
    for (const [operation, request] of [
      ['read', { workspaceId: workspace, extra: true }],
      ['commit', { workspaceId: workspace, id: '../PRD', confirmed: true }],
      ['createChange', { workspaceId: workspace, baseHash: 'a'.repeat(64), content: 'x', reason: ' ' }],
      ['createChange', { workspaceId: workspace, baseHash: 'a'.repeat(64), content: '\ud800', reason: 'x' }],
    ] as const) {
      expect(await invoke(operation, request)).toMatchObject({ ok: false, error: 'INVALID_INPUT' })
    }
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('serves PRD hash and tree revisions for proposal baselines', async () => {
    await mkdir(join(workspace, '.文档', 'grow-me', 's1'), { recursive: true })
    await writeFile(join(workspace, '.文档', 'grow-me', 's1', 'tree.json'), JSON.stringify({ session_id: 's1', revision: 3, nodes: [] }))
    await mkdir(join(workspace, '.文档', 'grow-me', 'broken'), { recursive: true })
    await writeFile(join(workspace, '.文档', 'grow-me', 'broken', 'tree.json'), '{oops')
    const original = await invoke('read', { workspaceId: workspace })
    const context = await invokeHandler<{ ok: boolean; data: { prdHash: string; prdExists: boolean; trees: Array<{ sessionId: string; revision: number }> } }>('ipc:grow-prd:projectContext', { workspaceId: workspace })
    expect(context).toEqual({ ok: true, data: { prdHash: original.data.hash, prdExists: true, trees: [{ sessionId: 's1', revision: 3 }] } })
  })

  it('denies untrusted workspaces and uses the authorized path', async () => {
    mocks.authorize.mockReturnValueOnce({ ok: false, error: 'private detail' })
    expect(await invoke('read', { workspaceId: '/untrusted' })).toEqual({ ok: false, error: 'UNAUTHORIZED', message: 'Workspace access denied.' })
    expect(await invoke('read', { workspaceId: '/alias' })).toMatchObject({ ok: true, data: { content: 'original' } })
  })

  it('returns safe errors for conflicts and missing files', async () => {
    const original = await invoke('read', { workspaceId: workspace })
    const draft = await invoke('createChange', { workspaceId: workspace, baseHash: original.data.hash, content: 'new', reason: 'reason' })
    await writeFile(prd, 'external edit')
    expect(await invoke('commit', { workspaceId: workspace, id: draft.data.id, confirmed: true })).toMatchObject({ ok: false, error: 'CONFLICT' })
    expect(await readFile(prd, 'utf8')).toBe('external edit')
    await rm(prd)
    const result = await invoke('read', { workspaceId: workspace })
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    expect(JSON.stringify(result)).not.toContain(workspace)
  })
})
