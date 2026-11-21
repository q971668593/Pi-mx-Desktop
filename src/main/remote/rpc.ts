import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ASSET_CHUNK_MAX, ATTACHMENT_MAX_BYTES, REMOTE_METHODS, isRemoteMethod, roleAllows, type MethodParams, type MethodResult, type RemoteMethod, type Role } from '@shared/remote'
import { normalizeSessionFileKey } from '@shared/session-file-key'
import type { AssetInfo } from './assets'
import { RpcFail } from './errors'
import type { GitBoardMethod, RemoteHostPort } from './host-port'
import type { HubClient, SessionHub } from './session-hub'
import type { UiRouter } from './ui-router'

/** Folder listings beyond this are cut (the phone shows a search hint instead). */
const FILE_LIST_MAX = 1000

/** Per-connection identity established by the handshake. */
export type RpcCaller = HubClient & {
  deviceId: string
  role: () => Role
}

export type RpcContext = {
  port: RemoteHostPort
  hub: SessionHub
  ui: UiRouter
  hostId: () => string
  assets: () => AssetInfo[]
  features: string[]
  endpoints?: () => string[]
}

type Handler<M extends RemoteMethod> = (caller: RpcCaller, params: MethodParams<M>) => Promise<MethodResult<M>>
type HandlerTable = { [M in RemoteMethod]: Handler<M> }

const SEND_DEDUPE_MAX = 500

/**
 * Method dispatch: schema validation → role check → handler. Handlers only talk to the hub,
 * UI router and host port. `turn.send` is idempotent per clientMessageId for the process lifetime.
 */
export class RemoteRpc {
  private readonly sent = new Map<string, Promise<MethodResult<'turn.send'>>>()
  private readonly handlers: HandlerTable

  constructor(private readonly ctx: RpcContext) {
    const { port, hub, ui } = ctx
    /** Mutating git ops share one shape: authorize the session, run the desktop handler, answer `{}`. */
    const gitSync = async (sessionKey: string, method: GitBoardMethod, params: Record<string, unknown>): Promise<Record<string, never>> => {
      const { projectId } = await hub.authorize(sessionKey)
      await port.gitBoard(projectId, method, params)
      return {}
    }
    this.handlers = {
      'host.hello': async (caller) => ({
        hostId: ctx.hostId(),
        hostName: port.hostName(),
        version: port.appVersion(),
        epoch: hub.epoch,
        deviceId: caller.deviceId,
        role: caller.role(),
        features: ctx.features,
        assets: ctx.assets(),
        ...(ctx.endpoints ? { endpoints: ctx.endpoints() } : {}),
      }),
      'project.list': async () => {
        // Desktop order = trust list order (MRU); hidden ones come along with a flag so the phone mirrors
        // the sidebar exactly — same order, same hidden set, no list of its own.
        const hidden = new Set(port.hiddenProjects().map((p) => normalizeSessionFileKey(p).replace(/\/+$/, '')))
        return {
          projects: port
            .trustedProjects()
            .filter((p) => hub.isAllowedProject(p))
            .map((id) => {
              const info = port.projectInfo?.(id) ?? {}
              const folder = id.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || id
              const isHidden = hidden.has(normalizeSessionFileKey(id).replace(/\/+$/, ''))
              return { id, name: info.label || folder, ...(info.temporary ? { temporary: true } : {}), ...(isHidden ? { hidden: true } : {}) }
            })
            // Temporary chats after real projects.
            .sort((a, b) => Number(!!a.temporary) - Number(!!b.temporary)),
        }
      },
      'project.setHidden': async (_c, p) => {
        const project = port.trustedProjects().find((t) => normalizeSessionFileKey(t) === normalizeSessionFileKey(p.projectId))
        if (!project) throw new RpcFail('not_found', 'unknown project')
        port.setProjectHidden(project, p.hidden)
        port.notifySettingsChanged('projects')
        return {}
      },
      // —— 静态资源走会话通道：手机经中转时拿不到 HTTP /assets，明文 HTTP 也不该用 ——
      'asset.get': async (_c, p) => {
        // 白名单与路径校验都在 port.assetPath 里；这里只负责切块，哈希自己算（手机仍以 hello 里的为准）
        const path = port.assetPath(p.name)
        if (!path) throw new RpcFail('not_found', 'unknown asset')
        const bytes = await readFile(path).catch(() => null)
        if (!bytes) throw new RpcFail('not_found', 'asset file unreadable')
        const offset = p.offset ?? 0
        if (offset > bytes.length) throw new RpcFail('bad_request', 'offset past the end')
        const limit = p.limit ?? ASSET_CHUNK_MAX
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + limit))
        return {
          name: p.name,
          total: bytes.length,
          offset,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          data: chunk.toString('base64'),
        }
      },
      // —— 手机上「新建项目」：翻电脑目录 → 把这个文件夹变成项目 → 建对话 ——
      'project.add': async (_c, p) => {
        const added = await port.addProject(p.path)
        port.notifySettingsChanged('projects')
        port.notifySessionsChanged(added.id)
        return { project: { id: added.id, name: added.name } }
      },
      'fs.browse': async (_c, p) => port.browseDirs(p.path ?? '', p.dotfiles === true),
      'fs.mkdir': async (_c, p) => ({ path: await port.makeDir(p.parent, p.name) }),
      'session.watchList': async (caller, p) => ({ sessions: await hub.watchList(caller, p.projectId) }),
      'session.unwatchList': async (caller) => {
        hub.unwatchList(caller)
        return {}
      },
      'session.open': async (caller, p) => hub.open(caller, p.sessionKey, p.cursor),
      'session.close': async (caller, p) => {
        hub.close(caller, p.sessionKey)
        return {}
      },
      'turn.page': async (_c, p) => hub.page(p.sessionKey, p.before, p.limit),
      'turn.toolDetail': async (_c, p) => hub.toolDetail(p.sessionKey, p.toolCallId),
      'turn.send': async (_c, p) => {
        const prior = this.sent.get(p.clientMessageId)
        if (prior) return prior.then((r) => ({ ...r, duplicate: true }))
        const run = (async () => {
          const { entry, projectId } = await hub.authorize(p.sessionKey)
          await port.send(entry.sessionFile, p.text, p.mode, port.sessionCapabilities(entry.sessionFile), projectId)
          return { accepted: true as const }
        })()
        this.sent.set(p.clientMessageId, run)
        if (this.sent.size > SEND_DEDUPE_MAX) this.sent.delete(this.sent.keys().next().value as string)
        // A failed send may be retried with the same id.
        run.catch(() => this.sent.delete(p.clientMessageId))
        return run
      },
      'turn.abort': async (_c, p) => {
        const { entry } = await hub.authorize(p.sessionKey)
        // The worker's abort drops its queue: take the texts first so they are not lost.
        const restored = await port.clearQueue(entry.sessionFile).catch(() => [])
        await port.abort(entry.sessionFile)
        return { aborted: true, restored }
      },
      'turn.rewind': async (_c, p) => hub.rewind(p.sessionKey, p.anchor),
      'session.branches': async (_c, p) => hub.branches(p.sessionKey),
      'session.switchBranch': async (_c, p) => hub.switchBranch(p.sessionKey, p.leafId),
      'session.fork': async (_c, p) => hub.fork(p.sessionKey, p.anchor),
      'turn.dequeue': async (_c, p) => {
        const { entry } = await hub.authorize(p.sessionKey)
        return { restored: await port.clearQueue(entry.sessionFile) }
      },
      'session.create': async (_c, p) => {
        if (!hub.isAllowedProject(p.projectId)) throw new RpcFail('forbidden', 'project is not allowed')
        const project = port.trustedProjects().find((t) => normalizeSessionFileKey(t) === normalizeSessionFileKey(p.projectId)) ?? p.projectId
        const sessionFile = await port.createSession(project)
        if (p.capabilities?.length) {
          const known = new Set(port.capabilityCatalog().map((c) => c.id as string))
          port.setSessionCapabilities(sessionFile, p.capabilities.filter((c) => known.has(c)))
        }
        hub.announceSession(sessionFile, project)
        return { sessionKey: sessionFile }
      },
      'model.list': async (_c, p) => {
        const { entry } = await hub.authorize(p.sessionKey)
        return port.listModels(entry.sessionFile)
      },
      'model.set': async (_c, p) => {
        const { entry } = await hub.authorize(p.sessionKey)
        return { model: await port.setModel(entry.sessionFile, p.modelId) }
      },
      'attachment.upload': async (_c, p) => {
        const bytes = Buffer.from(p.data, 'base64')
        if (!bytes.length) throw new RpcFail('bad_request', 'empty attachment')
        if (bytes.length > ATTACHMENT_MAX_BYTES) throw new RpcFail('bad_request', 'attachment too large')
        const path = await port.saveAttachment(bytes, p.name, p.mime)
        return { path, name: p.name, size: bytes.length }
      },
      'attachment.get': async (_c, p) => {
        const file = await port.readAttachment(p.path)
        if (!file) throw new RpcFail('not_found', 'attachment not found')
        if (file.bytes.length > ATTACHMENT_MAX_BYTES) throw new RpcFail('bad_request', 'attachment too large')
        return { mime: file.mime, data: Buffer.from(file.bytes).toString('base64') }
      },
      'thinking.set': async (_c, p) => {
        const { entry } = await hub.authorize(p.sessionKey)
        await port.setThinking(entry.sessionFile, p.level)
        return { level: p.level }
      },
      'session.stats': async (_c, p) => {
        const { entry, projectId } = await hub.authorize(p.sessionKey)
        const [context, usage] = await Promise.all([port.contextStats(entry.sessionFile, projectId).catch(() => null), port.sessionUsage(entry.sessionFile).catch(() => null)])
        return { context, usage }
      },
      'command.list': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const commands = await port.listCommands(projectId)
        return { commands: commands.map((c) => ({ ...c, description: c.description?.slice(0, 400) })) }
      },
      'review.diff': async (_c, p) => hub.reviewDiff(p.sessionKey, p.scope, p.turnId, p.path),
      'file.list': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = await port.listDir(projectId, p.path || '.', p.dotfiles === true)
        if (!r) throw new RpcFail('not_found', 'folder not found in the project')
        return { entries: r.entries.slice(0, FILE_LIST_MAX), truncated: r.truncated || r.entries.length > FILE_LIST_MAX }
      },
      'file.read': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const file = await port.readFile(projectId, p.path)
        if (!file) throw new RpcFail('not_found', 'file not found in the project')
        return file
      },
      'session.delete': async (_c, p) => {
        const { entry, projectId } = await hub.authorize(p.sessionKey)
        const ok = await port.deleteSession(entry.sessionFile, projectId)
        if (!ok) throw new RpcFail('internal', 'delete refused')
        hub.forgetSession(entry.sessionFile)
        return { deleted: true }
      },
      'file.write': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = await port.writeFile(projectId, p.path, p.content, p.expectedRevision)
        if (!r) throw new RpcFail('bad_request', 'write refused (path outside project, too large, or revision changed)')
        return r
      },
      'git.log': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        return port.gitLog(projectId, p.limit ?? 20)
      },
      // —— 手机端 Git 面板：与电脑端 gitBoard 面板同一套 handler ——
      'git.overview': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = await port.gitBoard(projectId, 'overview', { ...(p.skip ? { skip: p.skip } : {}), ...(p.query ? { query: p.query } : {}), ...(p.author ? { author: p.author } : {}) })
        return r as unknown as MethodResult<'git.overview'>
      },
      'git.stage': async (_c, p) => gitSync(p.sessionKey, 'stage', { paths: p.paths }),
      'git.unstage': async (_c, p) => gitSync(p.sessionKey, 'unstage', { paths: p.paths }),
      'git.stageAll': async (_c, p) => gitSync(p.sessionKey, 'stageAll', {}),
      'git.unstageAll': async (_c, p) => gitSync(p.sessionKey, 'unstageAll', {}),
      'git.discard': async (_c, p) =>
        gitSync(p.sessionKey, 'discard', { ...(p.tracked ? { tracked: p.tracked } : {}), ...(p.untracked ? { untracked: p.untracked } : {}) }),
      'git.exclude': async (_c, p) => gitSync(p.sessionKey, 'exclude', { paths: p.paths }),
      'git.resolve': async (_c, p) => gitSync(p.sessionKey, 'resolve', { paths: p.paths, side: p.side }),
      'git.commit': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'commit', {
          message: p.message,
          ...(p.paths ? { paths: p.paths } : {}),
          ...(p.action ? { action: p.action } : {}),
          ...(p.remote ? { remote: p.remote } : {}),
        })) as { committed?: boolean; pushed?: boolean }
        return { committed: r.committed !== false, pushed: r.pushed === true }
      },
      'git.suggestCommit': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'suggestCommit', { ...(p.prompt ? { prompt: p.prompt } : {}) })) as { text?: string }
        return { message: String(r.text || '') }
      },
      'git.sync': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'sync', { action: p.action })) as {
          incoming?: Array<{ hash: string; subject: string }>
          incomingCount?: number
          tracking?: boolean
        }
        return { incoming: r.incoming ?? [], incomingCount: r.incomingCount ?? 0, tracking: r.tracking !== false }
      },
      'git.branch': async (_c, p) =>
        gitSync(p.sessionKey, 'branch', {
          action: p.action,
          name: p.name,
          ...(p.from ? { from: p.from } : {}),
          ...(p.force ? { force: p.force } : {}),
        }),
      'git.merge': async (_c, p) => gitSync(p.sessionKey, 'merge', { ref: p.ref, ...(p.noFf ? { noFf: p.noFf } : {}) }),
      'git.rebase': async (_c, p) => gitSync(p.sessionKey, 'rebase', { ref: p.ref }),
      'git.cherryPick': async (_c, p) => gitSync(p.sessionKey, 'cherryPick', { ref: p.ref }),
      'git.operation': async (_c, p) => gitSync(p.sessionKey, 'operation', { operation: p.operation, action: p.action }),
      'git.stash': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'stash', {
          action: p.action,
          ...(p.message ? { message: p.message } : {}),
          ...(p.ref ? { ref: p.ref } : {}),
          ...(p.includeUntracked ? { includeUntracked: true } : {}),
        })) as { stashes?: unknown }
        return { stashes: (p.action === 'list' ? (r.stashes as never) : []) ?? [] }
      },
      'git.tag': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'tag', {
          action: p.action,
          ...(p.name ? { name: p.name } : {}),
          ...(p.target ? { target: p.target } : {}),
          ...(p.message ? { message: p.message } : {}),
          ...(p.remote ? { remote: p.remote } : {}),
        })) as { tags?: string[] }
        return { tags: p.action === 'list' ? (r.tags ?? []) : [] }
      },
      'git.remote': async (_c, p) =>
        gitSync(p.sessionKey, 'remote', {
          action: p.action,
          name: p.name,
          ...(p.url ? { url: p.url } : {}),
          ...(p.to ? { to: p.to } : {}),
          ...(p.branch ? { branch: p.branch } : {}),
        }),
      'git.worktree': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'worktree', {
          action: p.action,
          ...(p.path ? { path: p.path } : {}),
          ...(p.branch ? { branch: p.branch } : {}),
          ...(p.create ? { create: true } : {}),
        })) as { worktrees?: unknown }
        return { worktrees: (p.action === 'list' ? (r.worktrees as never) : []) ?? [] }
      },
      'git.diff': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'diff', {
          path: p.path,
          ...(p.staged ? { staged: true } : {}),
          ...(p.commit ? { commit: p.commit } : {}),
        })) as { path?: string; lines?: unknown; truncated?: boolean }
        return { path: p.path, lines: (r.lines as never) ?? [], truncated: r.truncated === true }
      },
      'git.commitDetail': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        return (await port.gitBoard(projectId, 'commitDetail', { ref: p.ref })) as unknown as MethodResult<'git.commitDetail'>
      },
      'git.reset': async (_c, p) => gitSync(p.sessionKey, 'reset', { hash: p.hash, mode: p.mode }),
      'git.checkout': async (_c, p) => gitSync(p.sessionKey, 'checkout', { ref: p.ref }),
      'git.checkoutCommit': async (_c, p) => gitSync(p.sessionKey, 'checkoutCommit', { ref: p.ref }),
      'git.init': async (_c, p) => gitSync(p.sessionKey, 'init', {}),
      'git.clone': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'clone', { url: p.url, path: p.path })) as { path?: string }
        return { path: String(r.path || p.path) }
      },
      'git.commandLog': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        const r = (await port.gitBoard(projectId, 'log', { ...(p.limit ? { limit: p.limit } : {}) })) as { entries?: unknown }
        return { entries: (r.entries as never) ?? [] }
      },
      'git.clearCommandLog': async (_c, p) => gitSync(p.sessionKey, 'clearLog', {}),
      'file.search': async (_c, p) => {
        const { projectId } = await hub.authorize(p.sessionKey)
        return { entries: (await port.searchFiles(projectId, p.query)).slice(0, 60) }
      },
      'capability.list': async (_c, p) => {
        const { entry } = await hub.authorize(p.sessionKey)
        const on = new Set(port.sessionCapabilities(entry.sessionFile))
        return {
          capabilities: port.capabilityCatalog().map((c) => ({
            id: c.id,
            available: c.available,
            ...(c.reason ? { reason: c.reason } : {}),
            promptTokens: c.promptTokens,
            tools: c.tools,
            enabled: on.has(c.id),
          })),
        }
      },
      'capability.set': async (_c, p) => {
        const { entry } = await hub.authorize(p.sessionKey)
        if (!port.capabilityCatalog().some((c) => c.id === p.id)) throw new RpcFail('bad_request', 'unknown capability')
        const current = port.sessionCapabilities(entry.sessionFile)
        const next = p.on ? [...new Set([...current, p.id])] : current.filter((c) => c !== p.id)
        port.setSessionCapabilities(entry.sessionFile, next)
        port.notifySettingsChanged('capabilities', entry.sessionFile)
        return { enabled: next }
      },
      'settings.cacheWarming.get': async () => ({ mode: await port.getCacheWarming() }),
      'settings.cacheWarming.set': async (_c, p) => {
        const mode = await port.setCacheWarming(p.mode)
        port.notifySettingsChanged('cacheWarming')
        return { mode }
      },
      'ui.respond': async (_c, p) => ({ accepted: ui.respond(p) }),
      'ui.cancel': async (_c, p) => ({ accepted: ui.cancel(p.id) }),
    }
  }

  async dispatch(caller: RpcCaller, method: string, rawParams: unknown): Promise<unknown> {
    if (!isRemoteMethod(method)) throw new RpcFail('not_supported', `unknown method ${method}`)
    const def = REMOTE_METHODS[method]
    if (!roleAllows(caller.role(), def.role)) throw new RpcFail('forbidden', 'this device is read-only')
    const parsed = def.params.safeParse(rawParams ?? {})
    if (!parsed.success) throw new RpcFail('bad_request', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const handler = this.handlers[method] as Handler<typeof method>
    return handler(caller, parsed.data as never)
  }
}
