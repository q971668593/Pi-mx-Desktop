import { z } from 'zod'
import {
  CursorSchema,
  ProjectInfoSchema,
  RenderNodeSchema,
  SessionStateSchema,
  SessionSummarySchema,
  TurnPatchSchema,
  TurnSchema,
} from './timeline'
import { UiRequestSchema, UiResponseSchema } from './ui'

/** RPC table: method name → params / result schema and the minimum device role. */

export const RoleSchema = z.enum(['viewer', 'operator'])
export type Role = z.infer<typeof RoleSchema>

export const CACHE_WARMING_MODES = ['off', 'streaming', 'idle'] as const
export const CacheWarmingSchema = z.enum(CACHE_WARMING_MODES)
export type CacheWarming = z.infer<typeof CacheWarmingSchema>

export const SEND_MODES = ['prompt', 'steer', 'followUp'] as const

/** Raw attachment bytes per upload (phones downscale photos well below this). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

const empty = z.object({}).strict()
const sessionKey = z.string().min(1)

export const AssetInfoSchema = z.object({ name: z.string(), sha256: z.string(), size: z.number().int().nonnegative() }).strict()

export const HelloParamsSchema = z
  .object({
    app: z.object({ name: z.string(), version: z.string(), platform: z.string() }).strict(),
    caps: z
      .object({
        templates: z.array(z.string()),
        piUi: z.array(z.string()),
        uiKinds: z.array(z.string()),
      })
      .strict(),
  })
  .strict()

export const HelloResultSchema = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    version: z.string(),
    epoch: z.string(),
    deviceId: z.string(),
    role: RoleSchema,
    features: z.array(z.string()),
    assets: z.array(AssetInfoSchema),
    /** Current LAN endpoints, so a paired phone follows DHCP changes without scanning again. */
    endpoints: z.array(z.string()).max(16).optional(),
  })
  .strict()

export const OpenResultSchema = z
  .object({
    sessionKey,
    title: z.string(),
    epoch: z.string(),
    seq: z.number().int().nonnegative(),
    kind: z.enum(['snapshot', 'replay']),
    resync: z.enum(['epoch_changed', 'gap', 'evicted']).optional(),
    turns: z.array(TurnSchema).optional(),
    hasOlder: z.boolean().optional(),
    patches: z.array(TurnPatchSchema).optional(),
    state: SessionStateSchema,
    pendingUi: z.array(UiRequestSchema),
  })
  .strict()
export type OpenResult = z.infer<typeof OpenResultSchema>

/** `group`: custom = models.json, apiKey = other key-based auth, login = OAuth sign-in; the phone lists them in that order. */
export const MODEL_GROUPS = ['custom', 'apiKey', 'login'] as const
export const ModelInfoSchema = z
  .object({ id: z.string(), name: z.string().optional(), provider: z.string().optional(), group: z.enum(MODEL_GROUPS).optional() })
  .strict()

export const CapabilityRowSchema = z
  .object({
    id: z.string(),
    available: z.boolean(),
    reason: z.string().optional(),
    promptTokens: z.number().int().nonnegative(),
    tools: z.number().int().nonnegative(),
    enabled: z.boolean(),
  })
  .strict()

export const COMMAND_CATEGORIES = ['prompt', 'skill', 'extension'] as const
/** A slash command pi expands when it is sent as prompt text (`/name args`). */
export const CommandInfoSchema = z
  .object({ name: z.string(), description: z.string().max(400).optional(), category: z.enum(COMMAND_CATEGORIES) })
  .strict()
export type CommandInfo = z.infer<typeof CommandInfoSchema>

/** A file or folder in the session's project; `path` is relative to the project root, `/`-separated. */
export const FileEntrySchema = z
  .object({ name: z.string(), path: z.string(), dir: z.boolean(), size: z.number().int().nonnegative().optional(), mtime: z.number().int().optional() })
  .strict()
export type FileEntry = z.infer<typeof FileEntrySchema>

/** One branch of a session's tree (a tip holding user messages). */
export const BranchInfoSchema = z
  .object({
    leafId: z.string(),
    /** The branch's last user message (preview). */
    title: z.string(),
    turns: z.number().int().nonnegative(),
    current: z.boolean(),
    updatedAt: z.number().int().optional(),
    /** Its first user message after it split from the current branch. */
    divergedAt: z.string().optional(),
    /** The branch's last assistant reply (preview), to tell apart branches with the same prompt. */
    reply: z.string().optional(),
  })
  .strict()
export type BranchInfo = z.infer<typeof BranchInfoSchema>

const nn = z.number().int().nonnegative()

/** Tokens and cost of every reply in the session file (cost in USD from the model entries' prices). */
export const SessionUsageSchema = z
  .object({ input: nn, output: nn, cacheRead: nn, cacheWrite: nn, cost: z.number().nonnegative(), calls: nn })
  .strict()
export type SessionUsage = z.infer<typeof SessionUsageSchema>

/** One rendered diff line: context, added, removed, or a gap between hunks. `o`/`n` are old/new line numbers. */
export const DiffLineSchema = z
  .object({ k: z.enum(['ctx', 'add', 'del', 'gap']), o: z.number().int().positive().optional(), n: z.number().int().positive().optional(), s: z.string() })
  .strict()
export type DiffLine = z.infer<typeof DiffLineSchema>

export const DiffFileSchema = z
  .object({ path: z.string(), add: z.number().int().nonnegative(), del: z.number().int().nonnegative(), status: z.enum(['modified', 'added', 'deleted', 'renamed', 'binary']) })
  .strict()
export type DiffFile = z.infer<typeof DiffFileSchema>

/** What the session's context holds right now (desktop composer metrics): chars / 4 like the desktop. */
export const ContextStatsSchema = z
  .object({
    tokens: z.number().int().nonnegative(),
    /** The model's context window; absent when the model is unknown. */
    window: z.number().int().positive().optional(),
    messages: z.number().int().nonnegative(),
    breakdown: z.array(z.object({ role: z.string(), tokens: z.number().int().nonnegative() }).strict()).max(12),
  })
  .strict()
export type ContextStats = z.infer<typeof ContextStatsSchema>

/** One file inside the project: text (UTF-8, capped) or an image the phone can render. */
export const FileReadResultSchema = z
  .object({
    path: z.string(),
    size: z.number().int().nonnegative(),
    truncated: z.boolean(),
    kind: z.enum(['text', 'image', 'binary']),
    text: z.string().optional(),
    mime: z.string().optional(),
    /** base64, images only. */
    data: z.string().optional(),
  })
  .strict()
export type FileReadResult = z.infer<typeof FileReadResultSchema>

/** `git log` row for the phone's Git view; `refs` are decorations (`HEAD -> main`, `origin/main`). */
export const GitCommitSchema = z
  .object({ sha: z.string(), short: z.string(), subject: z.string(), author: z.string(), at: z.number().int(), refs: z.array(z.string()).optional() })
  .strict()
export type GitCommit = z.infer<typeof GitCommitSchema>

/** One changed path in the working tree (`group` decides which bucket the phone lists it under). */
export const GIT_CHANGE_GROUPS = ['conflict', 'staged', 'unstaged', 'untracked'] as const
export const GitChangeSchema = z
  .object({
    staged: z.string(),
    unstaged: z.string(),
    path: z.string(),
    originalPath: z.string().optional(),
    group: z.enum(GIT_CHANGE_GROUPS),
  })
  .strict()
export type GitChange = z.infer<typeof GitChangeSchema>

/** A local or remote branch row (desktop 分支 tab). */
export const GitBranchRefSchema = z
  .object({
    name: z.string(),
    kind: z.enum(['local', 'remote']),
    current: z.boolean(),
    short: z.string(),
    upstream: z.string().nullable(),
    ahead: nn,
    behind: nn,
    subject: z.string(),
  })
  .strict()
export type GitBranchRef = z.infer<typeof GitBranchRefSchema>

/** A commit in the graph tab: parents drive the lane drawing on the desktop. */
export const GitGraphCommitSchema = z
  .object({
    hash: z.string(),
    short: z.string(),
    parents: z.array(z.string()),
    author: z.string(),
    email: z.string(),
    time: z.number().int(),
    subject: z.string(),
    decorations: z.string(),
  })
  .strict()
export type GitGraphCommit = z.infer<typeof GitGraphCommitSchema>

export const GitStashSchema = z.object({ ref: z.string(), message: z.string() }).strict()
export const GitRemoteSchema = z.object({ name: z.string(), fetch: z.string(), push: z.string() }).strict()
export const GitWorktreeSchema = z.object({ path: z.string(), head: z.string(), branch: z.string().nullable() }).strict()

/** The whole Git board in one call: branch head, changes, graph, branches, and 更多 supplies. */
export const GitOverviewSchema = z
  .object({
    isRepo: z.boolean(),
    branch: z.string(),
    upstream: z.string().nullable(),
    ahead: nn,
    behind: nn,
    files: z.array(GitChangeSchema),
    branches: z.array(GitBranchRefSchema),
    commits: z.array(GitGraphCommitSchema),
    hasMore: z.boolean(),
    stashes: z.array(GitStashSchema),
    tags: z.array(z.string()),
    remotes: z.array(GitRemoteSchema),
    worktrees: z.array(GitWorktreeSchema),
    /** An unfinished merge / rebase / cherry-pick / revert the phone can continue or abort. */
    operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert']).nullable(),
  })
  .strict()
export type GitOverview = z.infer<typeof GitOverviewSchema>

/** One file's diff lines, rendered with the same rows as the review screen. */
export const GitFileDiffSchema = z.object({ path: z.string(), lines: z.array(DiffLineSchema), truncated: z.boolean() }).strict()

/** What one commit changed (graph tab → commit sheet). */
export const GitCommitDetailSchema = z
  .object({
    hash: z.string(),
    subject: z.string(),
    body: z.string(),
    author: z.string(),
    email: z.string(),
    time: z.number().int(),
    parents: z.array(z.string()),
    files: z.array(z.object({ status: z.string(), path: z.string() }).strict()),
  })
  .strict()
export type GitCommitDetail = z.infer<typeof GitCommitDetailSchema>

/** One recorded git command (desktop 命令记录 tab). */
export const GitCommandEntrySchema = z
  .object({ time: z.number().int(), command: z.string(), repo: z.string(), success: z.boolean(), output: z.string() })
  .strict()
export type GitCommandEntry = z.infer<typeof GitCommandEntrySchema>

export const GIT_BRANCH_ACTIONS = ['create', 'rename', 'delete', 'track', 'checkout'] as const
export const GIT_STASH_ACTIONS = ['list', 'save', 'pop', 'apply', 'drop'] as const
export const GIT_TAG_ACTIONS = ['list', 'create', 'delete', 'push'] as const
export const GIT_REMOTE_ACTIONS = ['add', 'remove', 'setUrl', 'rename', 'publish', 'deleteBranch'] as const
export const GIT_WORKTREE_ACTIONS = ['list', 'add', 'remove'] as const
export const GIT_OPERATIONS = ['merge', 'rebase', 'cherry-pick', 'revert'] as const

/** Chunk size for `asset.get`: the phone loops until `total` bytes are in. */
export const ASSET_CHUNK_MAX = 1024 * 1024

/** A static asset the phone needs (mermaid.min.js), served over the encrypted session, not HTTP. */
export const AssetGetResultSchema = z
  .object({
    name: z.string(),
    /** Full size in bytes. */
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    /** sha256 of the whole file (same value `host.hello` advertises). */
    sha256: z.string(),
    /** base64 of this chunk. */
    data: z.string(),
  })
  .strict()

/** One folder the phone can pick as a project (the 「新建项目」browser). */
export const FsDirSchema = z.object({ name: z.string(), path: z.string(), repo: z.boolean() }).strict()
export type FsDir = z.infer<typeof FsDirSchema>

/** A folder on the desktop machine, one level at a time. `path: ''` lists the roots (drives / home). */
export const FsBrowseResultSchema = z
  .object({
    path: z.string(),
    parent: z.string().nullable(),
    roots: z.array(z.object({ name: z.string(), path: z.string() }).strict()),
    dirs: z.array(FsDirSchema),
    truncated: z.boolean(),
  })
  .strict()
export type FsBrowseResult = z.infer<typeof FsBrowseResultSchema>

function method<P extends z.ZodTypeAny, R extends z.ZodTypeAny>(params: P, result: R, role: Role) {
  return { params, result, role }
}

export const REMOTE_METHODS = {
  'host.hello': method(HelloParamsSchema, HelloResultSchema, 'viewer'),
  'project.list': method(empty, z.object({ projects: z.array(ProjectInfoSchema) }).strict(), 'viewer'),
  /** Hide / unhide a project on the desktop (the phone mirrors the sidebar). */
  'project.setHidden': method(z.object({ projectId: z.string().min(1), hidden: z.boolean() }).strict(), empty, 'operator'),
  /**
   * Add a folder of the desktop machine as a project (the phone's 「新建项目」): it joins the desktop
   * sidebar / recent projects, then the phone can create a session in it.
   */
  'project.add': method(z.object({ path: z.string().min(1).max(4096) }).strict(), z.object({ project: ProjectInfoSchema }).strict(), 'operator'),
  /** Browse the desktop filesystem to pick that folder. `path: ''` answers the roots (drives / home). */
  'fs.browse': method(z.object({ path: z.string().max(4096).optional(), dotfiles: z.boolean().optional() }).strict(), FsBrowseResultSchema, 'operator'),
  /** Create a folder inside `parent` (a brand-new project folder on the desktop). */
  /**
   * Static assets over the session channel. The phone cannot fetch `/assets` over HTTP when it is
   * behind the relay (only WebSocket is tunneled), and plain HTTP would be unencrypted anyway.
   */
  'asset.get': method(
    z
      .object({
        name: z.string().min(1).max(120),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(ASSET_CHUNK_MAX).optional(),
      })
      .strict(),
    AssetGetResultSchema,
    'viewer',
  ),
  'fs.mkdir': method(
    z.object({ parent: z.string().min(1).max(4096), name: z.string().trim().min(1).max(200) }).strict(),
    z.object({ path: z.string() }).strict(),
    'operator',
  ),
  'session.watchList': method(
    z.object({ projectId: z.string().optional() }).strict(),
    z.object({ sessions: z.array(SessionSummarySchema) }).strict(),
    'viewer',
  ),
  'session.unwatchList': method(empty, empty, 'viewer'),
  'session.open': method(z.object({ sessionKey, cursor: CursorSchema.optional() }).strict(), OpenResultSchema, 'viewer'),
  'session.close': method(z.object({ sessionKey }).strict(), empty, 'viewer'),
  'turn.page': method(
    z.object({ sessionKey, before: z.string(), limit: z.number().int().min(1).max(50) }).strict(),
    z.object({ turns: z.array(TurnSchema), hasOlder: z.boolean() }).strict(),
    'viewer',
  ),
  'turn.toolDetail': method(
    z.object({ sessionKey, toolCallId: z.string() }).strict(),
    z.object({ node: RenderNodeSchema, output: z.string().optional() }).strict(),
    'viewer',
  ),
  'turn.send': method(
    z
      .object({ sessionKey, text: z.string().min(1).max(100_000), mode: z.enum(SEND_MODES), clientMessageId: z.string().min(8).max(80) })
      .strict(),
    z.object({ accepted: z.literal(true), duplicate: z.boolean().optional() }).strict(),
    'operator',
  ),
  /** Stop the run. Queued steer/follow-up texts are pulled back (`restored`) so the phone can put them in its composer. */
  'turn.abort': method(
    z.object({ sessionKey }).strict(),
    z.object({ aborted: z.boolean(), restored: z.array(z.string()).optional() }).strict(),
    'operator',
  ),
  /**
   * Rewind to just before a user message (pi `navigateTree` on its entry): later turns leave the
   * active branch and the message text comes back as `editorText` for editing. Refused while running.
   */
  'turn.rewind': method(
    z.object({ sessionKey, anchor: z.string().min(1) }).strict(),
    z.object({ editorText: z.string().optional() }).strict(),
    'operator',
  ),
  /** The session's branches (rewinds and edits leave the old turns on another branch). */
  'session.branches': method(z.object({ sessionKey }).strict(), z.object({ branches: z.array(BranchInfoSchema) }).strict(), 'viewer'),
  /** Make another branch the active one (pi `navigateTree` to its last entry). Refused while running. */
  'session.switchBranch': method(z.object({ sessionKey, leafId: z.string().min(1) }).strict(), z.object({}).strict(), 'operator'),
  /**
   * New session with the history before the user message `anchor` (desktop fork); the message
   * text comes back as `editorText`. Refused while running.
   */
  'session.fork': method(
    z.object({ sessionKey, anchor: z.string().min(1) }).strict(),
    z.object({ sessionKey, editorText: z.string().optional() }).strict(),
    'operator',
  ),
  /** Pull queued steer/follow-up texts back without stopping the run. */
  'turn.dequeue': method(z.object({ sessionKey }).strict(), z.object({ restored: z.array(z.string()) }).strict(), 'operator'),
  'session.create': method(
    z.object({ projectId: z.string(), capabilities: z.array(z.string()).optional() }).strict(),
    z.object({ sessionKey }).strict(),
    'operator',
  ),
  'model.list': method(
    z.object({ sessionKey }).strict(),
    z
      .object({
        models: z.array(ModelInfoSchema),
        current: z.string().optional(),
        thinking: z.string().optional(),
        availableThinking: z.array(z.string()),
      })
      .strict(),
    'viewer',
  ),
  'model.set': method(z.object({ sessionKey, modelId: z.string() }).strict(), z.object({ model: z.string() }).strict(), 'operator'),
  'attachment.upload': method(
    z
      .object({
        name: z.string().min(1).max(200),
        mime: z.string().max(100),
        /** base64 of the file bytes */
        data: z.string().min(1).max(Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4),
      })
      .strict(),
    /** `path` is a host file the prompt text references, exactly like a desktop clipboard image. */
    z.object({ path: z.string(), name: z.string(), size: z.number().int().nonnegative() }).strict(),
    'operator',
  ),
  /** Read back an attachment (phone uploads or desktop pastes) — only `pi-clipboard-*` files in the attachment dir. */
  'attachment.get': method(
    z.object({ path: z.string().min(1).max(4096) }).strict(),
    z.object({ mime: z.string(), data: z.string() }).strict(),
    'viewer',
  ),
  'thinking.set': method(z.object({ sessionKey, level: z.string() }).strict(), z.object({ level: z.string() }).strict(), 'operator'),
  /** Slash commands available in the session's project (prompts, skills the desktop has enabled, extension commands). */
  /** Context usage for the session panel; null when the host cannot read it. */
  'session.stats': method(
    z.object({ sessionKey }).strict(),
    z.object({ context: ContextStatsSchema.nullable(), usage: SessionUsageSchema.nullable().optional() }).strict(),
    'viewer',
  ),
  'command.list': method(z.object({ sessionKey }).strict(), z.object({ commands: z.array(CommandInfoSchema) }).strict(), 'viewer'),
  /**
   * Changes to review: `git` = the project's working tree against HEAD (incl. untracked text files),
   * `turn` = what one turn's edit / write calls changed. Without `path` only the file list comes
   * back; with it, that file's lines (capped, `truncated` when cut).
   */
  'review.diff': method(
    z.object({ sessionKey, scope: z.enum(['git', 'turn']), turnId: z.string().optional(), path: z.string().max(4096).optional() }).strict(),
    z
      .object({
        isRepo: z.boolean(),
        branch: z.string().optional(),
        files: z.array(DiffFileSchema),
        file: z.object({ path: z.string(), lines: z.array(DiffLineSchema), truncated: z.boolean() }).strict().optional(),
        message: z.string().optional(),
      })
      .strict(),
    'viewer',
  ),
  /** One folder of the session's project (folders first). Paths outside the project are refused. */
  'file.list': method(
    z.object({ sessionKey, path: z.string().max(4096), dotfiles: z.boolean().optional() }).strict(),
    z.object({ entries: z.array(FileEntrySchema), truncated: z.boolean() }).strict(),
    'viewer',
  ),
  /** Fuzzy path search across the project (desktop `@` search). */
  /** One file for the phone's reader (text or image); paths stay inside the session's project. */
  'file.read': method(z.object({ sessionKey, path: z.string().min(1).max(4096) }).strict(), FileReadResultSchema, 'viewer'),
  /** Commits of the session's project (empty list outside a repository). */
  /** Delete a conversation (same file removal as the desktop's 删除对话). */
  'session.delete': method(z.object({ sessionKey }).strict(), z.object({ deleted: z.boolean() }).strict(), 'operator'),
  /** Phone-side editor save; the revision guard refuses a stale write instead of clobbering. */
  'file.write': method(
    z.object({ sessionKey, path: z.string().min(1).max(4096), content: z.string().max(512 * 1024), expectedRevision: z.string().optional() }).strict(),
    z.object({ size: z.number().int().nonnegative(), revision: z.string() }).strict(),
    'operator',
  ),
  'git.log': method(
    z.object({ sessionKey, limit: z.number().int().min(1).max(50).optional() }).strict(),
    z.object({ isRepo: z.boolean(), commits: z.array(GitCommitSchema) }).strict(),
    'viewer',
  ),
  /**
   * The desktop Git board on the phone: header (branch / ahead / behind), the change list, the graph,
   * branches, stashes, tags, remotes, worktrees and any unfinished operation — one round trip.
   */
  'git.overview': method(
    z
      .object({
        sessionKey,
        skip: z.number().int().min(0).max(100_000).optional(),
        query: z.string().trim().max(300).optional(),
        author: z.string().trim().max(200).optional(),
      })
      .strict(),
    GitOverviewSchema,
    'viewer',
  ),
  /** Stage paths (`git add -A --`). */
  'git.stage': method(z.object({ sessionKey, paths: z.array(z.string().min(1)).min(1).max(5000) }).strict(), empty, 'operator'),
  'git.unstage': method(z.object({ sessionKey, paths: z.array(z.string().min(1)).min(1).max(5000) }).strict(), empty, 'operator'),
  'git.stageAll': method(z.object({ sessionKey }).strict(), empty, 'operator'),
  'git.unstageAll': method(z.object({ sessionKey }).strict(), empty, 'operator'),
  /** Throw away working-tree edits (tracked → checkout, untracked → delete). */
  'git.discard': method(
    z.object({ sessionKey, tracked: z.array(z.string().min(1)).max(5000).optional(), untracked: z.array(z.string().min(1)).max(5000).optional() }).strict(),
    empty,
    'operator',
  ),
  /** Add paths to `.git/info/exclude` (desktop 「忽略」). */
  'git.exclude': method(z.object({ sessionKey, paths: z.array(z.string().min(1)).min(1).max(5000) }).strict(), empty, 'operator'),
  /** Resolve a conflicted file by taking one side. */
  'git.resolve': method(
    z.object({ sessionKey, paths: z.array(z.string().min(1)).min(1).max(5000), side: z.enum(['ours', 'theirs']) }).strict(),
    empty,
    'operator',
  ),
  /** Commit; `stage-and-commit` stages everything first, `commit-and-push` also pushes. */
  'git.commit': method(
    z
      .object({
        sessionKey,
        message: z.string().trim().min(1).max(20_000),
        paths: z.array(z.string().min(1)).max(5000).optional(),
        action: z.enum(['commit', 'stage-and-commit', 'commit-and-push']).optional(),
        remote: z.string().trim().min(1).max(250).optional(),
      })
      .strict(),
    z.object({ committed: z.boolean(), pushed: z.boolean() }).strict(),
    'operator',
  ),
  /** Draft a commit message with the desktop's plugin model (the same handler the 生成说明 button uses). */
  'git.suggestCommit': method(
    z.object({ sessionKey, prompt: z.string().trim().max(8000).optional() }).strict(),
    z.object({ message: z.string() }).strict(),
    'operator',
  ),
  /** fetch / pull / push; fetch also returns what is coming in. */
  'git.sync': method(
    z.object({ sessionKey, action: z.enum(['fetch', 'pull', 'push']) }).strict(),
    z
      .object({
        incoming: z.array(z.object({ hash: z.string(), subject: z.string() }).strict()),
        incomingCount: z.number().int().nonnegative(),
        tracking: z.boolean(),
      })
      .strict(),
    'operator',
  ),
  'git.branch': method(
    z
      .object({
        sessionKey,
        action: z.enum(GIT_BRANCH_ACTIONS),
        name: z.string().trim().min(1).max(250),
        from: z.string().trim().max(250).optional(),
        force: z.boolean().optional(),
      })
      .strict(),
    empty,
    'operator',
  ),
  'git.merge': method(z.object({ sessionKey, ref: z.string().trim().min(1).max(300), noFf: z.boolean().optional() }).strict(), empty, 'operator'),
  'git.rebase': method(z.object({ sessionKey, ref: z.string().trim().min(1).max(300) }).strict(), empty, 'operator'),
  'git.cherryPick': method(z.object({ sessionKey, ref: z.string().trim().min(1).max(300) }).strict(), empty, 'operator'),
  /** `--continue` / `--abort` for an unfinished merge, rebase, cherry-pick or revert. */
  'git.operation': method(
    z.object({ sessionKey, operation: z.enum(GIT_OPERATIONS), action: z.enum(['continue', 'abort']) }).strict(),
    empty,
    'operator',
  ),
  'git.stash': method(
    z
      .object({
        sessionKey,
        action: z.enum(GIT_STASH_ACTIONS),
        message: z.string().max(500).optional(),
        ref: z.string().max(100).optional(),
        includeUntracked: z.boolean().optional(),
      })
      .strict(),
    z.object({ stashes: z.array(GitStashSchema) }).strict(),
    'operator',
  ),
  'git.tag': method(
    z
      .object({
        sessionKey,
        action: z.enum(GIT_TAG_ACTIONS),
        name: z.string().max(250).optional(),
        target: z.string().max(300).optional(),
        message: z.string().max(1000).optional(),
        remote: z.string().max(100).optional(),
      })
      .strict(),
    z.object({ tags: z.array(z.string()) }).strict(),
    'operator',
  ),
  'git.remote': method(
    z
      .object({
        sessionKey,
        action: z.enum(GIT_REMOTE_ACTIONS),
        name: z.string().min(1).max(250),
        url: z.string().max(1000).optional(),
        to: z.string().max(250).optional(),
        branch: z.string().max(250).optional(),
      })
      .strict(),
    empty,
    'operator',
  ),
  'git.worktree': method(
    z
      .object({
        sessionKey,
        action: z.enum(GIT_WORKTREE_ACTIONS),
        path: z.string().max(1000).optional(),
        branch: z.string().max(250).optional(),
        create: z.boolean().optional(),
      })
      .strict(),
    z.object({ worktrees: z.array(GitWorktreeSchema) }).strict(),
    'operator',
  ),
  /** One file's diff (working tree, index or a commit). */
  'git.diff': method(
    z.object({ sessionKey, path: z.string().min(1).max(4096), staged: z.boolean().optional(), commit: z.string().max(100).optional() }).strict(),
    GitFileDiffSchema,
    'viewer',
  ),
  'git.commitDetail': method(z.object({ sessionKey, ref: z.string().min(7).max(64) }).strict(), GitCommitDetailSchema, 'viewer'),
  'git.reset': method(
    z.object({ sessionKey, hash: z.string().min(7).max(64), mode: z.enum(['soft', 'mixed', 'hard']) }).strict(),
    empty,
    'operator',
  ),
  'git.checkout': method(z.object({ sessionKey, ref: z.string().trim().min(1).max(300) }).strict(), empty, 'operator'),
  'git.checkoutCommit': method(z.object({ sessionKey, ref: z.string().min(7).max(64) }).strict(), empty, 'operator'),
  'git.init': method(z.object({ sessionKey }).strict(), empty, 'operator'),
  'git.clone': method(z.object({ sessionKey, url: z.string().trim().min(1).max(1000), path: z.string().trim().min(1).max(1000) }).strict(), z.object({ path: z.string() }).strict(), 'operator'),
  /** Recorded git commands of the project (desktop 命令记录). */
  'git.commandLog': method(
    z.object({ sessionKey, limit: z.number().int().min(1).max(200).optional() }).strict(),
    z.object({ entries: z.array(GitCommandEntrySchema) }).strict(),
    'viewer',
  ),
  'git.clearCommandLog': method(z.object({ sessionKey }).strict(), empty, 'operator'),
  'file.search': method(
    z.object({ sessionKey, query: z.string().max(512) }).strict(),
    z.object({ entries: z.array(FileEntrySchema) }).strict(),
    'viewer',
  ),
  'capability.list': method(z.object({ sessionKey }).strict(), z.object({ capabilities: z.array(CapabilityRowSchema) }).strict(), 'viewer'),
  'capability.set': method(
    z.object({ sessionKey, id: z.string(), on: z.boolean() }).strict(),
    z.object({ enabled: z.array(z.string()) }).strict(),
    'operator',
  ),
  'settings.cacheWarming.get': method(empty, z.object({ mode: CacheWarmingSchema }).strict(), 'viewer'),
  'settings.cacheWarming.set': method(z.object({ mode: CacheWarmingSchema }).strict(), z.object({ mode: CacheWarmingSchema }).strict(), 'operator'),
  'ui.respond': method(UiResponseSchema, z.object({ accepted: z.boolean() }).strict(), 'operator'),
  'ui.cancel': method(z.object({ id: z.string() }).strict(), z.object({ accepted: z.boolean() }).strict(), 'operator'),
} as const

export type RemoteMethod = keyof typeof REMOTE_METHODS
export type MethodParams<M extends RemoteMethod> = z.infer<(typeof REMOTE_METHODS)[M]['params']>
export type MethodResult<M extends RemoteMethod> = z.infer<(typeof REMOTE_METHODS)[M]['result']>

export const isRemoteMethod = (m: string): m is RemoteMethod => Object.prototype.hasOwnProperty.call(REMOTE_METHODS, m)

/** Viewer < operator. */
export const roleAllows = (have: Role, need: Role): boolean => have === 'operator' || need === 'viewer'
