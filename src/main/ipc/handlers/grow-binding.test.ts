import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const auth = vi.hoisted(() => ({ cwd: '', deny: false }))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
vi.mock('../../trusted-workspace', () => ({
  authorizeProjectCwd: (cwd: string) => cwd === auth.cwd ? { ok: true, cwd } : { ok: false, error: 'unauthorized' },
  authorizeTrustedSessionFile: async (cwd: string, file: string) => !auth.deny && cwd === auth.cwd && file.startsWith(cwd)
    ? { ok: true, cwd, sessionFile: file } : { ok: false, error: 'session_workspace_mismatch' },
}))
vi.mock('../../team-board', () => ({}))
import { registerGrowHandlers } from './grow'
import { invokeHandler } from '../registry'

describe('grow binding IPC', () => {
  it('authorizes each session, isolates bindings and rejects foreign or missing trees', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'grow-ipc-'))
    auth.cwd = ws
    try {
      registerGrowHandlers()
      const tree = await invokeHandler<{ sessionId: string }>('ipc:grow:startSession', { workspaceId: ws })
      const request = (action: string, sessionFile: string, sessionId?: string) => invokeHandler<any>('ipc:grow:listSessions', { workspaceId: ws, action, sessionFile, ...(sessionId && { sessionId }) })
      const a = join(ws, 'a.jsonl'), b = join(ws, 'b.jsonl')
      expect(await request('getBinding', a)).toEqual({ ok: true, sessionId: null })
      expect(await request('setBinding', a, tree.sessionId)).toEqual({ ok: true, sessionId: tree.sessionId })
      expect(await request('getBinding', a)).toEqual({ ok: true, sessionId: tree.sessionId })
      expect(await request('getBinding', b)).toEqual({ ok: true, sessionId: null })
      expect(await request('setBinding', b, 'missing')).toMatchObject({ ok: false, error: 'no_session' })
      expect(await request('getBinding', '/foreign/session')).toMatchObject({ ok: false, error: 'session_workspace_mismatch' })
      auth.deny = true
      expect(await request('setBinding', a, tree.sessionId)).toMatchObject({ ok: false })
    } finally { auth.deny = false; await rm(ws, { recursive: true, force: true }) }
  })
})
