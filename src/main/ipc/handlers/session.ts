import { app } from 'electron'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { deriveSessionTitle } from '@shared/session-list-title'
import { configStore } from '../../config-store'
import { normalizeSessionKey } from '../../worker-session-key'
import { readTurnSnapshot, restoreTurnSnapshotFile } from '../../turn-file-snapshot-store'
import { workerManager } from '../../worker-manager'
import { listRewindCheckpoints } from '../../pi-rewind-read'
import { listMessageAnchorsFromSessionFile } from '../../session-branch-anchors'
import { readSessionIdFromFile } from '../../session-file-meta'
import { resolvePreparedSessionFile } from '../../session-prepare'
import { clearSessionDisplayName, resolveSessionListTitle } from '../../session-display-names'
import { renamePiSessionOnDisk } from '../../rename-pi-session'
import {
  bindSandboxSession,
  isSandboxWorkspacePath,
  renameSandboxWorkspace,
} from '../../sandbox-workspaces'
import {
  ensureWorkerSessionBound,
  getPendingWorkerSessionFile,
  setPendingEphemeralSandboxDraft,
  setPendingWorkerSessionFile,
} from '../../session-bind-state'
import { setVisibleSessionFile } from '../../completion-notification-events'
import { sessionPreviewProcess } from '../../session-preview-process'
import { listForkCandidatesFromSessionFile } from '../../session-fork-candidates'
import { getSessionLeafOverride, setSessionLeafOverride } from '../../session-leaf-override'
import type { SessionOnDiskRow } from '../sdk-session'
import { sessionPreviewText } from '@shared/session-preview-text'
import type { PiSessionMessage } from '@shared/worker-message'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  projectHideSchema,
  projectPathSchema,
  projectRemoveRecentSchema,
  projectRenameSchema,
  rewindCheckpointsSchema,
  rewindRunCommandSchema,
  sessionBindSchema,
  sessionBranchAnchorsSchema,
  sessionCloneSchema,
  sessionEphemeralDraftSchema,
  sessionFileOnlySchema,
  sessionForkSchema,
  sessionListSchema,
  sessionOpenSchema,
  sessionVisibleSchema,
  sessionCompactSchema,
  sessionDeleteSchema,
  sessionExportSchema,
  sessionGetMessagesSchema,
  sessionNavigateTreeSchema,
  sessionNewSchema,
  sessionPrepareSchema,
  sessionTreeSchema,
} from '../schemas'
import { authorizeTrustedSessionFile } from '../../trusted-workspace'
import { readTeamState, teamSpecPath } from '../../team-board'
import { errorMessage } from '@shared/error-message'
import { workspacePathsEqual } from '@shared/workspace-path'
import { wslPathToWindows } from '@shared/wsl-path'
import { getAgentRuntimeConfig } from '../../wsl/runtime-config'

/** Rows from the WSL preview arrive over JSON stdio, so dates may be ISO strings (or numbers). */
function timeMs(value: unknown): number {
  if (value instanceof Date) return value.getTime() || 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Date.parse(value) || 0
  return 0
}

/** 撤销副本目录：测试里 electron.app 可能没有 getPath，退回临时目录。 */
function sessionUndoDir(): string {
  try {
    return join(app.getPath('userData'), 'session-undo')
  } catch {
    return join(tmpdir(), 'pi-session-undo')
  }
}
const SESSION_UNDO_TTL_MS = 10 * 60_000

/** Copy a session file aside so the delete can be undone; returns the handle used by `ipc:session.restore`. */
function stashSessionForUndo(sessionFile: string): string | null {
  try {
    mkdirSync(sessionUndoDir(), { recursive: true })
    const id = randomUUID()
    copyFileSync(sessionFile, join(sessionUndoDir(), `${id}.jsonl`))
    writeFileSync(join(sessionUndoDir(), `${id}.json`), JSON.stringify({ sessionFile, at: Date.now() }), 'utf8')
    // 顺手清掉过期副本，别无限长
    for (const name of readdirSync(sessionUndoDir())) {
      if (!name.endsWith('.json')) continue
      const metaPath = join(sessionUndoDir(), name)
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { at?: number }
        if (Date.now() - (meta.at ?? 0) > SESSION_UNDO_TTL_MS) {
          rmSync(metaPath, { force: true })
          rmSync(metaPath.replace(/\.json$/, '.jsonl'), { force: true })
        }
      } catch {
        /* ignore a corrupt sidecar */
      }
    }
    return id
  } catch {
    return null
  }
}

function dropSessionUndo(trashId: string): void {
  rmSync(join(sessionUndoDir(), `${trashId}.json`), { force: true })
  rmSync(join(sessionUndoDir(), `${trashId}.jsonl`), { force: true })
}

function restoreSessionFromUndo(trashId: string): { sessionFile: string; workspaceId: string } | null {
  try {
    const metaPath = join(sessionUndoDir(), `${trashId}.json`)
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { sessionFile?: string; at?: number }
    if (!meta.sessionFile || Date.now() - (meta.at ?? 0) > SESSION_UNDO_TTL_MS) return null
    mkdirSync(dirname(meta.sessionFile), { recursive: true })
    copyFileSync(join(sessionUndoDir(), `${trashId}.jsonl`), meta.sessionFile)
    dropSessionUndo(trashId)
    return { sessionFile: meta.sessionFile, workspaceId: dirname(meta.sessionFile) }
  } catch {
    return null
  }
}

export function registerSessionHandlers(): void {
  registerHandlerWithSchema('ipc:session.list', sessionListSchema, async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    if (workspaceId && req.refresh === true) {
      await sessionPreviewProcess.invalidateListSessions(workspaceId)
    }
    const sessions = workspaceId ? await sessionPreviewProcess.listSessions(workspaceId) : []
    const runtime = getAgentRuntimeConfig()
    const ownedSessions = sessions.filter((s) => {
      if (!s.cwd || workspacePathsEqual(s.cwd, workspaceId)) return true
      return runtime.mode === 'wsl' && !!runtime.distro
        && workspacePathsEqual(wslPathToWindows(runtime.distro, s.cwd), workspaceId)
    })
    const interrupted = new Map(workerManager.listInterruptedRuns().map((row) => [row.sessionFile, row.orphanedAt]))
    // 侧栏要知道哪些会话是工作团队开出来的（角色会话 / 派发会话），好加个小标记。
    const teamRoles = new Map<string, { role: string; kind: 'role' | 'run' }>()
    if (workspaceId) {
      try {
        const state = readTeamState(teamSpecPath(workspaceId))
        const remember = (file: string, role: string, kind: 'role' | 'run') => {
          const key = normalizeSessionKey(file)
          if (key && !teamRoles.has(key)) teamRoles.set(key, { role, kind })
        }
        for (const [role, session] of Object.entries(state.sessions)) {
          if (session?.sessionFile) remember(session.sessionFile, role, 'role')
        }
        for (const run of state.runs) remember(run.sessionFile, run.role, 'run')
      } catch {
        /* 看板还没建立或读不了：不加标记即可 */
      }
    }
    const formatted = ownedSessions.map((s: SessionOnDiskRow) => {
      const preview = sessionPreviewText(s.firstMessage || '')
      return {
        sessionId: s.id,
        sessionFile: s.path,
        // Forks list flat with a "forked from" note; only subagent children nest under a parent.
        parentSessionFile: s.forked ? undefined : s.parentSessionPath,
        forkedFromSessionFile: s.forked ? s.parentSessionPath : undefined,
        workspaceId,
        title: resolveSessionListTitle(
          s.path,
          deriveSessionTitle(s.firstMessage || '', 60) || s.id.slice(0, 8),
          s.name,
        ),
        firstMessage: preview.slice(0, 120),
        createdAt: timeMs(s.created),
        updatedAt: timeMs(s.modified),
        // 用户最后按下发送的时间（侧栏"几分钟前"与项目内排序都以它为准）；SDK 回退行没有这个字段。
        lastUserMessageAt: s.lastUserMessageAt ? timeMs(s.lastUserMessageAt) : undefined,
        messageCount: s.messageCount || 0,
        modelId: '',
        status: 'idle' as const,
        interruptedAt: interrupted.get(normalizeSessionKey(s.path)),
        ...(teamRoles.get(normalizeSessionKey(s.path))
          ? { team: teamRoles.get(normalizeSessionKey(s.path)) }
          : {}),
      }
    })
    return { sessions: formatted }
  })

  registerHandlerWithSchema('ipc:session.interrupted', z.object({
    workspaceId: z.string().min(1),
    sessionFile: z.string().min(1),
  }).strict(), async ({ workspaceId, sessionFile }) => {
    const authorized = await authorizeTrustedSessionFile(workspaceId, sessionFile)
    if (!authorized.ok) return { run: null }
    const key = normalizeSessionKey(authorized.sessionFile)
    const run = workerManager.listInterruptedRuns().find((row) => row.sessionFile === key)
    return { run: run ? { interruptedAt: run.orphanedAt, runId: run.runId } : null }
  })

  const turnSnapshotRequest = z.object({
    workspaceId: z.string().min(1),
    sessionFile: z.string().min(1),
    runId: z.string().min(1).max(200),
  })

  registerHandlerWithSchema('ipc:session.turnSnapshot', turnSnapshotRequest.strict(), async (req) => {
    const authorized = await authorizeTrustedSessionFile(req.workspaceId, req.sessionFile)
    if (!authorized.ok) return { snapshot: null }
    const snapshot = await readTurnSnapshot(authorized.sessionFile, req.runId)
    return { snapshot: snapshot ? { runId: snapshot.runId, files: snapshot.files } : null }
  })

  registerHandlerWithSchema('ipc:session.restoreTurnFile', turnSnapshotRequest.extend({
    path: z.string().min(1).max(2048),
  }).strict(), async (req) => {
    const authorized = await authorizeTrustedSessionFile(req.workspaceId, req.sessionFile)
    if (!authorized.ok) return authorized
    return restoreTurnSnapshotFile(authorized.cwd, authorized.sessionFile, req.runId, req.path,
      () => workerManager.isWorkspaceRunning(authorized.cwd))
  })

  registerHandlerWithSchema('ipc:session.open', sessionOpenSchema, async (req) => {
    const sessionId = req.sessionId
    if (req.sessionFile) {
      setPendingWorkerSessionFile(req.sessionFile)
      workerManager.focusExistingSession(req.sessionFile)
    }
    return {
      session: {
        sessionId,
        workspaceId: workerManager.cwd || '',
        title: '',
        createdAt: 0,
        updatedAt: 0,
        modelId: '',
        status: 'idle' as const,
      },
    }
  })

  registerHandlerWithSchema('ipc:session.setPendingBind', sessionBindSchema, async (req) => {
    const sessionFile = req.sessionFile ?? null
    setPendingWorkerSessionFile(sessionFile)
    if (sessionFile) {
      const hasLiveSlot = workerManager.focusExistingSession(sessionFile)
      // Eagerly load only when the session already has a live worker slot so the
      // composer model/context refresh from the correct runtime state after switching.
      // Otherwise defer to first-prompt lazy load — never block UI switching on a
      // WSL worker fork (which takes seconds).
      if (hasLiveSlot && workerManager.isRunning && workerManager.cwd) {
        try {
          await workerManager.loadSession(sessionFile)
        } catch (e) {
          console.warn('[session.setPendingBind] loadSession failed:', e)
        }
      }
    }
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:session.setVisible', sessionVisibleSchema, async (req) => {
    setVisibleSessionFile(typeof req.sessionFile === 'string' ? req.sessionFile : null)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:session.prepare', sessionPrepareSchema, async (req) => {
    const sessionFile = req.sessionFile
    if (!sessionFile) {
      if (req.bind !== false) setPendingWorkerSessionFile(null)
      return { bound: false, sessionId: null as string | null }
    }
    if (req.bind !== false) setPendingWorkerSessionFile(sessionFile)
    const prepared = await resolvePreparedSessionFile(sessionFile, (workspaceId) =>
      sessionPreviewProcess.listSessions(workspaceId),
    )
    if (req.bind !== false && prepared?.sessionFile && prepared.sessionFile !== sessionFile) {
      setPendingWorkerSessionFile(prepared.sessionFile)
    }
    const runtime = getAgentRuntimeConfig()
    return {
      bound: false,
      sessionId: prepared?.sessionId ?? null,
      sessionFile: prepared?.sessionFile ?? sessionFile,
      workspaceId: prepared?.cwd
        ? (runtime.mode === 'wsl'
          ? wslPathToWindows(runtime.distro, prepared.cwd)
          : prepared.cwd)
        : null,
    }
  })

  registerHandlerWithSchema('ipc:session.setEphemeralDraft', sessionEphemeralDraftSchema, async (req) => {
    setPendingEphemeralSandboxDraft(!!req.active)
    if (req.active) setPendingWorkerSessionFile(null)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:session.tree', sessionTreeSchema, async (req) => {
    const requestedSessionFile = req.sessionFile
    const authorized = requestedSessionFile
      ? await authorizeTrustedSessionFile(req.workspaceId, requestedSessionFile)
      : null
    if (authorized && !authorized.ok) {
      // 还没落盘的会话（新建但未发第一条消息）就是一棵空树，不当作错误。
      if (authorized.error === 'session_file_missing') return { nodes: [], leafId: null, pending: true }
      return { nodes: [], leafId: null, error: authorized.error }
    }
    const cwd = authorized?.cwd || workerManager.cwd || configStore.get('currentProject') || process.cwd()
    let sessionFile = authorized?.sessionFile
    let workerSessionFile: string | undefined
    let leafOverride: string | null | undefined
    if (sessionFile) leafOverride = getSessionLeafOverride(sessionFile)
    if (workerManager.isRunning) {
      try {
        const st = sessionFile
          ? await workerManager.getState(sessionFile).catch(() => null)
          : await workerManager.getState().catch(() => null)
        workerSessionFile = (st as { sessionFile?: string } | null)?.sessionFile
        if (!sessionFile) sessionFile = workerSessionFile
        if (leafOverride === undefined && st && 'leafId' in (st || {})) {
          leafOverride = ((st as { leafId?: string | null }).leafId) ?? null
        }
      } catch {
        /* disk tree still works */
      }
    }
    if (sessionFile) {
      try {
        const r = await sessionPreviewProcess.getTree({
          sessionFile,
          cwd,
          leafId: leafOverride,
        })
        return { nodes: r.nodes, leafId: r.leafId, workerBound: workerSessionFile === sessionFile }
      } catch (e: unknown) {
        return { nodes: [], leafId: null, error: errorMessage(e) }
      }
    }
    try {
      const p = workerManager.getSessionTree()
      const timeout = new Promise<{ nodes: []; leafId: null; error: string }>((resolve) =>
        setTimeout(() => resolve({ nodes: [], leafId: null, error: 'timeout' }), 15000),
      )
      return await Promise.race([p, timeout])
    } catch (e: unknown) {
      return { nodes: [], leafId: null, error: errorMessage(e) }
    }
  })

  registerHandlerWithSchema('ipc:session.navigateTree', sessionNavigateTreeSchema, async (req) => {
    try {
      // Bind the *requested* session worker, then navigate on that same slot.
      // Passing sessionFile through avoids foreground-fallback / wrong-worker races.
      // Pass explicit cwd so rewind works after cold open without a pre-started Worker.
      await ensureWorkerSessionBound(
        (f, o) =>
          workerManager.loadSession(f, {
            force: o?.force,
            cwd: workerManager.resolveWorkspaceCwd() || undefined,
          }),
        { sessionFile: req.sessionFile },
      )
      const result = await workerManager.navigateTree(req.targetId, {
        summarize: req.summarize === true,
        label: req.label,
        sessionFile: req.sessionFile,
      })
      // Persist leaf tip for disk getMessages / next loadSession (pi does not write leaf to JSONL).
      if (!result.cancelled && req.sessionFile) {
        const leaf = result.leafId !== undefined ? result.leafId : req.targetId
        setSessionLeafOverride(req.sessionFile, leaf)
      }
      return result
    } catch (e: unknown) {
      return { cancelled: true, error: errorMessage(e) }
    }
  })

  registerHandlerWithSchema('ipc:session.branchAnchors', sessionBranchAnchorsSchema, async (req) => {
    const file =
      req.sessionFile ||
      ((await workerManager.getState().catch(() => null)) as { sessionFile?: string } | null)?.sessionFile
    if (!file) return { anchors: [] }
    return { anchors: listMessageAnchorsFromSessionFile(file) }
  })

  registerHandlerWithSchema('ipc:rewind.checkpoints', rewindCheckpointsSchema, async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || ''
    if (!cwd) return { checkpoints: [] }
    let sessionId = req.sessionId as string | undefined
    if (!sessionId) {
      const state = await workerManager.getState().catch(() => null)
      sessionId = (state as { sessionId?: string } | null)?.sessionId
    }
    if (!sessionId && req.sessionFile) sessionId = (await readSessionIdFromFile(req.sessionFile)) || undefined
    return { checkpoints: listRewindCheckpoints(cwd, sessionId || undefined) }
  })

  registerHandlerWithSchema('ipc:rewind.runCommand', rewindRunCommandSchema, async (req) => {
    await workerManager.runExtensionCommand(String(req.text || '/rewind').trim())
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:session.getMessages', sessionGetMessagesSchema, async (req) => {
    const authorized = await authorizeTrustedSessionFile(req.workspaceId, req.sessionFile)
    if (!authorized.ok) {
      // 同上：新会话文件尚未创建时返回空历史，不把 invalid_session 丢给时间线。
      if (authorized.error === 'session_file_missing') return { items: [], totalCount: 0, pending: true }
      return { items: [], totalCount: 0, error: authorized.error }
    }
    const offset = req.offset ?? 0
    const limit = req.limit ?? 0
    // Disk-first timeline preview. NEVER spawn/ensure a worker just to read history —
    // that was the main cause of slow session switches (loadSession + dispose thrash).
    try {
      let leafId: string | null | undefined =
        typeof req.leafId === 'string'
          ? req.leafId
          : req.leafId === null
            ? null
            : getSessionLeafOverride(authorized.sessionFile)

      // If a live worker already has this session, prefer its leaf when no override.
      if (leafId === undefined) {
        try {
          const st = await workerManager.getState(authorized.sessionFile)
          if (st && 'leafId' in st && (st as { leafId?: string | null }).leafId != null) {
            leafId = (st as { leafId?: string | null }).leafId ?? null
          }
        } catch {
          /* ignore — disk path below */
        }
      }

      const disk = await sessionPreviewProcess.getMessages({
        sessionFile: authorized.sessionFile,
        cwd: authorized.cwd,
        offset,
        limit: limit || undefined,
        leafId,
      })
      return {
        items: disk.items,
        sourceCount: disk.items.length,
        totalCount: disk.totalCount,
        sessionMeta: disk.sessionMeta,
      }
    } catch (e: unknown) {
      console.error('[IPC] session.getMessages failed:', e)
      return { items: [], totalCount: 0, error: errorMessage(e) || 'get_messages_failed' }
    }
  })

  registerHandlerWithSchema('ipc:session.new', sessionNewSchema, async (req) => {
    const workspaceId = req.workspaceId
    if (!workerManager.isRunning || workerManager.cwd !== workspaceId) {
      await workerManager.start(workspaceId)
    }
    setPendingWorkerSessionFile(null)
    const result = await workerManager.newSession(workspaceId)
    await sessionPreviewProcess.invalidateListSessions(workspaceId)
    const state = await workerManager.getState().catch(() => ({}))
    const sessionFile =
      result.sessionFile || (state as { sessionFile?: string })?.sessionFile
    if (isSandboxWorkspacePath(workspaceId)) {
      bindSandboxSession(workspaceId, result.sessionId, sessionFile)
    }
    return {
      session: {
        sessionId: result.sessionId,
        sessionFile,
        workspaceId,
        title: '新会话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        modelId: '',
        status: 'idle' as const,
      },
    }
  })

  registerHandlerWithSchema('ipc:session.fork', sessionForkSchema, async (req) => {
    const title = String(req?.title || '')
    const entryId = String(req?.entryId || req?.fromMessageId || '').trim()
    const sessionFile = String(req?.sessionFile || '').trim()
    const workspaceId = String(req?.workspaceId || workerManager.cwd || configStore.get('currentProject') || '')
    try {
      if (!entryId) {
        return {
          cancelled: false,
          error: 'missing entryId',
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Fork',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'missing entryId',
          },
        }
      }
      if (!sessionFile) {
        return {
          cancelled: false,
          error: 'missing sessionFile',
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Fork',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'missing sessionFile',
          },
        }
      }
      const result = await workerManager.forkSession({
        sessionFile,
        entryId,
        position: req?.position === 'at' ? 'at' : 'before',
      })
      if (result.error) {
        return {
          cancelled: false,
          error: result.error,
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Fork',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: result.error,
          },
        }
      }
      if (result.cancelled) {
        return {
          cancelled: true,
          session: {
            sessionId: result.sessionId || '',
            sessionFile: result.sessionFile,
            workspaceId,
            title: title || 'Fork',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            modelId: '',
            status: 'idle' as const,
          },
        }
      }
      setPendingWorkerSessionFile(null)
      await sessionPreviewProcess.invalidateListSessions(workspaceId)
      return {
        cancelled: false,
        editorText: result.editorText,
        sessionId: result.sessionId,
        sessionFile: result.sessionFile,
        workspaceId,
        session: {
          sessionId: result.sessionId || '',
          sessionFile: result.sessionFile,
          workspaceId,
          title: title || 'Fork',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modelId: result.model || '',
          status: 'idle' as const,
        },
      }
    } catch (e: unknown) {
      return {
        cancelled: false,
        error: errorMessage(e),
        session: {
          sessionId: '',
          workspaceId,
          title: title || 'Fork',
          createdAt: 0,
          updatedAt: 0,
          modelId: '',
          status: 'idle' as const,
          error: errorMessage(e),
        },
      }
    }
  })

  registerHandlerWithSchema('ipc:session.clone', sessionCloneSchema, async (req) => {
    const title = String(req?.title || '')
    const sessionFile = String(req?.sessionFile || '').trim()
    const workspaceId = String(req?.workspaceId || workerManager.cwd || configStore.get('currentProject') || '')
    try {
      if (!sessionFile) {
        return {
          cancelled: false,
          error: 'missing sessionFile',
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Clone',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'missing sessionFile',
          },
        }
      }
      const result = await workerManager.cloneSession({ sessionFile })
      if (result.error) {
        return {
          cancelled: false,
          error: result.error,
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Clone',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: result.error,
          },
        }
      }
      if (result.cancelled) {
        return {
          cancelled: true,
          session: {
            sessionId: result.sessionId || '',
            sessionFile: result.sessionFile,
            workspaceId,
            title: title || 'Clone',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            modelId: '',
            status: 'idle' as const,
          },
        }
      }
      setPendingWorkerSessionFile(null)
      await sessionPreviewProcess.invalidateListSessions(workspaceId)
      return {
        cancelled: false,
        sessionId: result.sessionId,
        sessionFile: result.sessionFile,
        workspaceId,
        session: {
          sessionId: result.sessionId || '',
          sessionFile: result.sessionFile,
          workspaceId,
          title: title || 'Clone',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modelId: result.model || '',
          status: 'idle' as const,
        },
      }
    } catch (e: unknown) {
      return {
        cancelled: false,
        error: errorMessage(e),
        session: {
          sessionId: '',
          workspaceId,
          title: title || 'Clone',
          createdAt: 0,
          updatedAt: 0,
          modelId: '',
          status: 'idle' as const,
          error: errorMessage(e),
        },
      }
    }
  })

  registerHandlerWithSchema('ipc:session.forkCandidates', sessionFileOnlySchema, async (req) => {
    const sessionFile = String(req?.sessionFile || '').trim()
    try {
      if (!sessionFile) return { messages: [] }
      const leafId = getSessionLeafOverride(sessionFile)
      return { messages: listForkCandidatesFromSessionFile(sessionFile, leafId) }
    } catch (e: unknown) {
      return { messages: [], error: errorMessage(e) }
    }
  })

  registerHandler('ipc:session.rename', async (req) => {
    const title = (req.title || '').trim()
    if (!title) return { ok: false, title: req.title }
    const cwd = workerManager.cwd || configStore.get('currentProject') || ''
    if (req.sandboxPath && isSandboxWorkspacePath(req.sandboxPath)) {
      renameSandboxWorkspace(req.sandboxPath, title)
      return { ok: true, title }
    }
    if (isSandboxWorkspacePath(cwd) && !req.sessionFile) {
      renameSandboxWorkspace(cwd, title)
      return { ok: true, title }
    }
    const file = req.sessionFile as string | undefined
    if (!file) return { ok: false, title, error: 'missing sessionFile' }
    const workspaceCwd =
      (req.workspaceId as string | undefined) ||
      workerManager.cwd ||
      configStore.get('currentProject') ||
      undefined
    const r = await renamePiSessionOnDisk(file, title, workspaceCwd)
    if (!r.ok) return { ok: false, title, error: r.error || 'rename failed' }
    clearSessionDisplayName(file)
    await sessionPreviewProcess.invalidateListSessions(workspaceCwd)
    return { ok: true, title }
  })

  registerHandlerWithSchema('ipc:session.delete', sessionDeleteSchema, async (req) => {
    const authorized = await authorizeTrustedSessionFile(req.workspaceId, req.sessionFile)
    if (!authorized.ok) return { ok: false, error: authorized.error }
    // 删除前留一份副本：撤销条（几秒内点「撤销」）能把对话原样放回去。
    const trashId = stashSessionForUndo(authorized.sessionFile)
    const r = await workerManager.deleteSessionFile(authorized.sessionFile)
    if (r.ok) {
      clearSessionDisplayName(authorized.sessionFile)
      await sessionPreviewProcess.invalidateListSessions(authorized.cwd)
    } else if (trashId) dropSessionUndo(trashId)
    return { ok: !!r.ok, error: r.error, ...(r.ok && trashId ? { trashId } : {}) }
  })

  /** 撤销删除：把先前留的副本放回原路径，并让侧栏重新读一次。 */
  registerHandlerWithSchema('ipc:session.restore', z.object({ trashId: z.string().min(1) }).strict(), async (req) => {
    const restored = restoreSessionFromUndo(req.trashId)
    if (!restored) return { ok: false, error: 'undo expired' }
    await sessionPreviewProcess.invalidateListSessions(dirname(restored.sessionFile)).catch(() => {})
    return { ok: true, sessionFile: restored.sessionFile, workspaceId: restored.workspaceId }
  })

  registerHandlerWithSchema('ipc:session.reloadFromDisk', sessionFileOnlySchema, async (req) => {
    const sessionFile =
      (req.sessionFile as string | undefined) || getPendingWorkerSessionFile() || undefined
    if (!sessionFile) return { ok: false, error: 'no session file' }
    try {
      const st = await workerManager.getState().catch(() => null)
      if (workerManager.isRunning && (st as { sessionFile?: string } | null)?.sessionFile === sessionFile) {
        await workerManager.loadSession(sessionFile)
      }
      return { ok: true, sessionFile }
    } catch (e: unknown) {
      return { ok: false, error: errorMessage(e) || 'reload failed' }
    }
  })

  registerHandlerWithSchema('ipc:project.removeRecent', projectRemoveRecentSchema, async (req) => {
    const path = (req.path as string | undefined)?.trim()
    if (!path) return { ok: false, error: 'missing path' }
    const isRepositoryGroup = req.isRepositoryGroup === true
    const groupPaths = Array.isArray(req.groupPaths)
      ? (req.groupPaths as unknown[]).filter((p): p is string => typeof p === 'string' && !!p.trim())
      : []
    const siblingPaths = Array.isArray(req.siblingPaths)
      ? (req.siblingPaths as unknown[]).filter((p): p is string => typeof p === 'string' && !!p.trim())
      : []
    const removedPaths = isRepositoryGroup ? [path, ...groupPaths] : [path]
    for (const target of removedPaths) {
      configStore.removeRecentProject(target)
      if (!isRepositoryGroup && typeof configStore.hideWorktree === 'function') {
        configStore.hideWorktree(target)
      }
    }
    if (!isRepositoryGroup && siblingPaths.length > 0) {
      const recentAfter = configStore.get('recentProjects') || []
      const hasSiblingInRecent = siblingPaths.some((sib) =>
        recentAfter.some((r) => workspacePathsEqual(r, sib)),
      )
      if (!hasSiblingInRecent) {
        configStore.addRecentProject(siblingPaths[0])
      }
    }
    const cur = configStore.get('currentProject')
    if (cur && removedPaths.some((target) => workspacePathsEqual(cur, target))) {
      const recent = configStore.get('recentProjects') || []
      const next = recent.find((p) => p && !removedPaths.some((target) => workspacePathsEqual(p, target))) || null
      configStore.set('currentProject', next)
    }
    return {
      ok: true,
      currentProject: configStore.get('currentProject'),
      recentProjects: configStore.get('recentProjects') || [],
    }
  })

  registerHandlerWithSchema('ipc:project.restoreRecent', projectPathSchema, async (req) => {
    // 「移除项目 / 隐藏项目」误点后的撤销：放回 MRU，并解掉 hiddenWorktrees 的隐藏。
    const path = (req.path as string | undefined)?.trim()
    if (!path) return { ok: false, error: 'missing path' }
    configStore.addRecentProject(path)
    if (typeof configStore.unhideProject === 'function') configStore.unhideProject(path)
    return {
      ok: true,
      currentProject: configStore.get('currentProject'),
      recentProjects: configStore.get('recentProjects') || [],
      hiddenProjects: configStore.get('hiddenWorktrees') || [],
    }
  })

  /**
   * 侧栏「隐藏项目」。
   *
   * 隐藏状态存主进程（hiddenWorktrees），不再只存渲染进程 localStorage：
   * 之前两套列表并存，重新添加同一个文件夹时只解了主进程那份，localStorage 那份还在，
   * 于是项目被永久“吞掉”，只能去隐藏抽屉里手动恢复。
   */
  registerHandlerWithSchema('ipc:project.hide', projectHideSchema, async (req) => {
    const raw = Array.isArray(req.paths) ? (req.paths as unknown[]) : req.path ? [req.path] : []
    const paths = raw
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p): p is string => !!p)
    if (!paths.length) return { ok: false, error: 'missing path' }
    for (const path of paths) {
      if (typeof configStore.hideWorktree === 'function') configStore.hideWorktree(path)
    }
    return { ok: true, hiddenProjects: configStore.get('hiddenWorktrees') || [] }
  })

  registerHandlerWithSchema('ipc:project.rename', projectRenameSchema, async (req) => {
    const path = (req.path as string | undefined)?.trim()
    if (!path) return { ok: false, error: 'missing path' }
    const name = typeof req.name === 'string' ? req.name.trim() : ''
    const isRepositoryGroup = req.isRepositoryGroup === true
    if (typeof configStore.setProjectDisplayName === 'function') {
      configStore.setProjectDisplayName(path, name, isRepositoryGroup)
    }
    return {
      ok: true,
      projectDisplayNames: configStore.get('projectDisplayNames') || {},
    }
  })

  registerHandlerWithSchema('ipc:session.compact', sessionCompactSchema, async (req) => {
    try {
      const authorized = await authorizeTrustedSessionFile(req.workspaceId, req.sessionFile)
      if (!authorized.ok) {
        return { sessionId: '', compacted: false, tokensSaved: 0, error: authorized.error }
      }
      const result = await workerManager.compactSession(authorized.sessionFile, req.customInstructions)
      return { ...result, compacted: true }
    } catch (e: unknown) {
      return { sessionId: '', compacted: false, tokensSaved: 0, error: errorMessage(e) }
    }
  })

  registerHandlerWithSchema('ipc:session.export', sessionExportSchema, async (req) => {
    const format = String(req.format || 'json')
    const sessionFile = String(req.sessionFile || '')
    try {
      if (!sessionFile) return { content: '', format, filename: 'export', error: 'missing sessionFile' }
      if (!workerManager.isRunning) {
        return { content: '', format, filename: 'export', error: 'worker_not_ready' }
      }
      const messages = await workerManager.getMessages(sessionFile, 0, 10000)
      const items = messages.items || []
      const filename = `session-${Date.now()}.${format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'}`
      if (format === 'json') {
        return { content: JSON.stringify(items, null, 2), format, filename }
      }
      if (format === 'markdown') {
        const lines = items.map((m: PiSessionMessage) => {
          const role = m.role || 'unknown'
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
          return `### ${role}\n\n${content}\n`
        })
        return { content: lines.join('\n---\n\n'), format, filename }
      }
      if (format === 'html') {
        const body = items
          .map((m: PiSessionMessage) => {
            const role = m.role || 'unknown'
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
            return `<div><strong>${role}</strong><p>${String(content).replace(/</g, '&lt;')}</p></div>`
          })
          .join('\n')
        return { content: `<!DOCTYPE html><html><body>${body}</body></html>`, format, filename }
      }
      return { content: '', format, filename, error: 'unsupported format' }
    } catch (e: unknown) {
      return { content: '', format, filename: 'export', error: errorMessage(e) }
    }
  })
}
