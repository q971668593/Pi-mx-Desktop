package dev.pi.remote.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** Mirrors packages/shared/remote/{frames,methods,events}.ts. */

const val PROTOCOL_VERSION = 1

val RemoteJson: Json = Json {
    ignoreUnknownKeys = true // newer desktops may add fields; never crash on them
    explicitNulls = false
    encodeDefaults = false
}

/** Decrypted envelope. `p` stays raw JSON until the caller knows the method. */
@Serializable
data class Frame(
    val v: Int,
    val k: String,
    val id: String? = null,
    val m: String? = null,
    val p: JsonElement? = null,
    val ok: Boolean? = null,
    val err: RpcError? = null,
)

@Serializable
data class RpcError(val code: String, val message: String, val retryable: Boolean)

@Serializable class Empty

@Serializable data class AppInfo(val name: String, val version: String, val platform: String)
@Serializable data class ClientCaps(val templates: List<String>, val piUi: List<String>, val uiKinds: List<String>)
@Serializable data class HelloParams(val app: AppInfo, val caps: ClientCaps)
@Serializable data class AssetInfo(val name: String, val sha256: String, val size: Long)

@Serializable
data class HelloResult(
    val hostId: String,
    val hostName: String,
    val version: String,
    val epoch: String,
    val deviceId: String,
    val role: String,
    val features: List<String>,
    val assets: List<AssetInfo>,
    val endpoints: List<String> = emptyList(),
)

@Serializable data class ProjectList(val projects: List<ProjectInfo>)
@Serializable data class ProjectAddParams(val path: String)
@Serializable data class ProjectAddResult(val project: ProjectInfo)

// —— 手机选项目文件夹：一层一层翻电脑目录 ——
@Serializable data class FsRoot(val name: String, val path: String)
@Serializable data class FsDir(val name: String, val path: String, val repo: Boolean)
@Serializable data class FsBrowseParams(val path: String? = null, val dotfiles: Boolean? = null)
@Serializable data class FsBrowseResult(
    val path: String,
    val parent: String? = null,
    val roots: List<FsRoot>,
    val dirs: List<FsDir>,
    val truncated: Boolean,
)
@Serializable data class AssetGetParams(val name: String, val offset: Int? = null, val limit: Int? = null)
@Serializable data class AssetGetResult(
    val name: String,
    val total: Int,
    val offset: Int,
    val sha256: String,
    val data: String,
)

@Serializable data class FsMkdirParams(val parent: String, val name: String)
@Serializable data class FsMkdirResult(val path: String)

@Serializable data class WatchListParams(val projectId: String? = null)
@Serializable data class SessionList(val sessions: List<SessionSummary>)
@Serializable data class SessionKeyParams(val sessionKey: String)
@Serializable data class DeleteResult(val deleted: Boolean)
@Serializable data class OpenParams(val sessionKey: String, val cursor: Cursor? = null)

@Serializable
data class OpenResult(
    val sessionKey: String,
    val title: String,
    val epoch: String,
    val seq: Long,
    val kind: String,
    val resync: String? = null,
    val turns: List<Turn>? = null,
    val hasOlder: Boolean? = null,
    val patches: List<TurnPatch>? = null,
    val state: SessionState,
    val pendingUi: List<UiRequest>,
)

@Serializable data class PageParams(val sessionKey: String, val before: String, val limit: Int)
@Serializable data class PageResult(val turns: List<Turn>, val hasOlder: Boolean)
@Serializable data class ToolDetailParams(val sessionKey: String, val toolCallId: String)
@Serializable data class ToolDetailResult(val node: RenderNode, val output: String? = null)
@Serializable data class SendParams(val sessionKey: String, val text: String, val mode: String, val clientMessageId: String)
@Serializable data class SendResult(val accepted: Boolean, val duplicate: Boolean? = null)
@Serializable data class AbortResult(val aborted: Boolean, val restored: List<String>? = null)
@Serializable data class DequeueResult(val restored: List<String>)
@Serializable data class RoleTokens(val role: String, val tokens: Long)
@Serializable data class ContextStats(val tokens: Long, val window: Long? = null, val messages: Int, val breakdown: List<RoleTokens>)
@Serializable data class SessionUsage(val input: Long, val output: Long, val cacheRead: Long, val cacheWrite: Long, val cost: Double, val calls: Int)
@Serializable data class SessionStatsResult(val context: ContextStats? = null, val usage: SessionUsage? = null)
@Serializable data class RewindParams(val sessionKey: String, val anchor: String)
@Serializable data class RewindResult(val editorText: String? = null)
@Serializable data class BranchInfo(val leafId: String, val title: String, val turns: Int, val current: Boolean, val updatedAt: Long? = null, val divergedAt: String? = null, val reply: String? = null)
@Serializable data class BranchesResult(val branches: List<BranchInfo>)
@Serializable data class SwitchBranchParams(val sessionKey: String, val leafId: String)
@Serializable data class ForkResult(val sessionKey: String, val editorText: String? = null)
@Serializable data class CommandInfo(val name: String, val description: String? = null, val category: String)
@Serializable data class CommandListResult(val commands: List<CommandInfo>)
@Serializable data class FileReadParams(val sessionKey: String, val path: String)

@Serializable
data class FileReadResult(
    val path: String,
    val size: Long,
    val truncated: Boolean,
    val kind: String,
    val text: String? = null,
    val mime: String? = null,
    val data: String? = null,
)

@Serializable
data class GitCommit(
    val sha: String,
    val short: String,
    val subject: String,
    val author: String,
    val at: Long,
    val refs: List<String>? = null,
)

@Serializable data class FileWriteParams(val sessionKey: String, val path: String, val content: String, val expectedRevision: String? = null)
@Serializable data class FileWriteResult(val size: Long, val revision: String)

@Serializable data class ProjectSetHiddenParams(val projectId: String, val hidden: Boolean)

@Serializable data class GitLogParams(val sessionKey: String, val limit: Int? = null)
@Serializable data class GitLogResult(val isRepo: Boolean, val commits: List<GitCommit>)

// —— 手机端 Git 面板（与电脑端 gitBoard 面板一一对应） ——

@Serializable
data class GitChange(
    val staged: String,
    val unstaged: String,
    val path: String,
    val originalPath: String? = null,
    val group: String,
)

@Serializable
data class GitBranchRef(
    val name: String,
    val kind: String,
    val current: Boolean,
    val short: String,
    val upstream: String? = null,
    val ahead: Int,
    val behind: Int,
    val subject: String,
)

@Serializable
data class GitGraphCommit(
    val hash: String,
    val short: String,
    val parents: List<String>,
    val author: String,
    val email: String,
    val time: Long,
    val subject: String,
    val decorations: String,
)

@Serializable data class GitStash(val ref: String, val message: String)
@Serializable data class GitRemote(val name: String, val fetch: String, val push: String)
@Serializable data class GitWorktree(val path: String, val head: String, val branch: String? = null)

@Serializable
data class GitOverview(
    val isRepo: Boolean,
    val branch: String,
    val upstream: String? = null,
    val ahead: Int,
    val behind: Int,
    val files: List<GitChange>,
    val branches: List<GitBranchRef>,
    val commits: List<GitGraphCommit>,
    val hasMore: Boolean,
    val stashes: List<GitStash>,
    val tags: List<String>,
    val remotes: List<GitRemote>,
    val worktrees: List<GitWorktree>,
    val operation: String? = null,
)

@Serializable data class GitFileDiff(val path: String, val lines: List<DiffLine>, val truncated: Boolean)
@Serializable data class GitCommitFile(val status: String, val path: String)

@Serializable
data class GitCommitDetail(
    val hash: String,
    val subject: String,
    val body: String,
    val author: String,
    val email: String,
    val time: Long,
    val parents: List<String>,
    val files: List<GitCommitFile>,
)

@Serializable
data class GitCommandEntry(val time: Long, val command: String, val repo: String, val success: Boolean, val output: String)

@Serializable data class GitCommitResult(val committed: Boolean, val pushed: Boolean)
@Serializable data class GitSyncIncoming(val hash: String, val subject: String)
@Serializable data class GitSyncResult(val incoming: List<GitSyncIncoming>, val incomingCount: Int, val tracking: Boolean)
@Serializable data class GitSuggestResult(val message: String)
@Serializable data class GitStashList(val stashes: List<GitStash>)
@Serializable data class GitTagList(val tags: List<String>)
@Serializable data class GitWorktreeList(val worktrees: List<GitWorktree>)
@Serializable data class GitCommandLog(val entries: List<GitCommandEntry>)
@Serializable data class GitCloneResult(val path: String)

/** One param bag for every `git.*` method: null fields are dropped, the host validates the rest. */
@Serializable
data class GitParams(
    val sessionKey: String,
    val paths: List<String>? = null,
    val tracked: List<String>? = null,
    val untracked: List<String>? = null,
    val side: String? = null,
    val message: String? = null,
    val action: String? = null,
    val remote: String? = null,
    val prompt: String? = null,
    val name: String? = null,
    val from: String? = null,
    val force: Boolean? = null,
    val noFf: Boolean? = null,
    val ref: String? = null,
    val operation: String? = null,
    val includeUntracked: Boolean? = null,
    val target: String? = null,
    val to: String? = null,
    val branch: String? = null,
    val path: String? = null,
    val create: Boolean? = null,
    val staged: Boolean? = null,
    val commit: String? = null,
    val hash: String? = null,
    val mode: String? = null,
    val url: String? = null,
    val limit: Int? = null,
    val skip: Int? = null,
    val query: String? = null,
    val author: String? = null,
)

@Serializable data class FileEntry(val name: String, val path: String, val dir: Boolean, val size: Long? = null, val mtime: Long? = null)
@Serializable data class DiffLine(val k: String, val o: Int? = null, val n: Int? = null, val s: String)
@Serializable data class DiffFile(val path: String, val add: Int, val del: Int, val status: String)
@Serializable data class DiffFileLines(val path: String, val lines: List<DiffLine>, val truncated: Boolean)
@Serializable data class ReviewDiffParams(val sessionKey: String, val scope: String, val turnId: String? = null, val path: String? = null)
@Serializable data class ReviewDiffResult(val isRepo: Boolean, val branch: String? = null, val files: List<DiffFile>, val file: DiffFileLines? = null, val message: String? = null)
@Serializable data class FileListParams(val sessionKey: String, val path: String, val dotfiles: Boolean? = null)
@Serializable data class FileListResult(val entries: List<FileEntry>, val truncated: Boolean)
@Serializable data class FileSearchParams(val sessionKey: String, val query: String)
@Serializable data class FileSearchResult(val entries: List<FileEntry>)
@Serializable data class CreateParams(val projectId: String, val capabilities: List<String>? = null)
@Serializable data class CreateResult(val sessionKey: String)
@Serializable data class ModelInfo(val id: String, val name: String? = null, val provider: String? = null, val group: String? = null)

@Serializable
data class ModelListResult(
    val models: List<ModelInfo>,
    val current: String? = null,
    val thinking: String? = null,
    val availableThinking: List<String>,
)

@Serializable data class ModelSetParams(val sessionKey: String, val modelId: String)
@Serializable data class ModelSetResult(val model: String)
@Serializable data class UploadParams(val name: String, val mime: String, val data: String)
@Serializable data class UploadResult(val path: String, val name: String, val size: Long)
@Serializable data class AttachmentGetParams(val path: String)
@Serializable data class AttachmentGetResult(val mime: String, val data: String)
@Serializable data class ThinkingSetParams(val sessionKey: String, val level: String)
@Serializable data class ThinkingSetResult(val level: String)

@Serializable
data class CapabilityRow(
    val id: String,
    val available: Boolean,
    val reason: String? = null,
    val promptTokens: Int,
    val tools: Int,
    val enabled: Boolean,
)

@Serializable data class CapabilityList(val capabilities: List<CapabilityRow>)
@Serializable data class CapabilitySetParams(val sessionKey: String, val id: String, val on: Boolean)
@Serializable data class CapabilitySetResult(val enabled: List<String>)
@Serializable data class CacheWarmingValue(val mode: String)
@Serializable data class UiCancelParams(val id: String)
@Serializable data class Accepted(val accepted: Boolean)

@Serializable data class SessionsUpdate(val sessions: List<SessionSummary>, val removed: List<String>? = null)
@Serializable data class TurnPatchEvent(val sessionKey: String, val patches: List<TurnPatch>)
@Serializable data class SettingsChanged(val key: String, val sessionKey: String? = null)
@Serializable data class HostNotice(val level: String, val text: String)

/** Method name → (params, result) serializers; also drives the fixture round-trip tests. */
object RemoteMethods {
    val table: Map<String, Pair<KSerializer<*>, KSerializer<*>>> = mapOf(
        "host.hello" to (HelloParams.serializer() to HelloResult.serializer()),
        "project.list" to (Empty.serializer() to ProjectList.serializer()),
        "project.add" to (ProjectAddParams.serializer() to ProjectAddResult.serializer()),
        "fs.browse" to (FsBrowseParams.serializer() to FsBrowseResult.serializer()),
        "fs.mkdir" to (FsMkdirParams.serializer() to FsMkdirResult.serializer()),
        "asset.get" to (AssetGetParams.serializer() to AssetGetResult.serializer()),
        "session.watchList" to (WatchListParams.serializer() to SessionList.serializer()),
        "session.unwatchList" to (Empty.serializer() to Empty.serializer()),
        "session.open" to (OpenParams.serializer() to OpenResult.serializer()),
        "session.close" to (SessionKeyParams.serializer() to Empty.serializer()),
        "session.delete" to (SessionKeyParams.serializer() to DeleteResult.serializer()),
        "turn.page" to (PageParams.serializer() to PageResult.serializer()),
        "turn.toolDetail" to (ToolDetailParams.serializer() to ToolDetailResult.serializer()),
        "turn.send" to (SendParams.serializer() to SendResult.serializer()),
        "turn.abort" to (SessionKeyParams.serializer() to AbortResult.serializer()),
        "file.list" to (FileListParams.serializer() to FileListResult.serializer()),
        "review.diff" to (ReviewDiffParams.serializer() to ReviewDiffResult.serializer()),
        "file.search" to (FileSearchParams.serializer() to FileSearchResult.serializer()),
        "file.read" to (FileReadParams.serializer() to FileReadResult.serializer()),
        "file.write" to (FileWriteParams.serializer() to FileWriteResult.serializer()),
        "project.setHidden" to (ProjectSetHiddenParams.serializer() to Empty.serializer()),
        "git.log" to (GitLogParams.serializer() to GitLogResult.serializer()),
        // Git 面板：电脑端能看到、能做的，手机这边一一对应
        "git.overview" to (GitParams.serializer() to GitOverview.serializer()),
        "git.stage" to (GitParams.serializer() to Empty.serializer()),
        "git.unstage" to (GitParams.serializer() to Empty.serializer()),
        "git.stageAll" to (GitParams.serializer() to Empty.serializer()),
        "git.unstageAll" to (GitParams.serializer() to Empty.serializer()),
        "git.discard" to (GitParams.serializer() to Empty.serializer()),
        "git.exclude" to (GitParams.serializer() to Empty.serializer()),
        "git.resolve" to (GitParams.serializer() to Empty.serializer()),
        "git.commit" to (GitParams.serializer() to GitCommitResult.serializer()),
        "git.suggestCommit" to (GitParams.serializer() to GitSuggestResult.serializer()),
        "git.sync" to (GitParams.serializer() to GitSyncResult.serializer()),
        "git.branch" to (GitParams.serializer() to Empty.serializer()),
        "git.merge" to (GitParams.serializer() to Empty.serializer()),
        "git.rebase" to (GitParams.serializer() to Empty.serializer()),
        "git.cherryPick" to (GitParams.serializer() to Empty.serializer()),
        "git.operation" to (GitParams.serializer() to Empty.serializer()),
        "git.stash" to (GitParams.serializer() to GitStashList.serializer()),
        "git.tag" to (GitParams.serializer() to GitTagList.serializer()),
        "git.remote" to (GitParams.serializer() to Empty.serializer()),
        "git.worktree" to (GitParams.serializer() to GitWorktreeList.serializer()),
        "git.diff" to (GitParams.serializer() to GitFileDiff.serializer()),
        "git.commitDetail" to (GitParams.serializer() to GitCommitDetail.serializer()),
        "git.reset" to (GitParams.serializer() to Empty.serializer()),
        "git.checkout" to (GitParams.serializer() to Empty.serializer()),
        "git.checkoutCommit" to (GitParams.serializer() to Empty.serializer()),
        "git.init" to (GitParams.serializer() to Empty.serializer()),
        "git.clone" to (GitParams.serializer() to GitCloneResult.serializer()),
        "git.commandLog" to (GitParams.serializer() to GitCommandLog.serializer()),
        "git.clearCommandLog" to (GitParams.serializer() to Empty.serializer()),
        "session.stats" to (SessionKeyParams.serializer() to SessionStatsResult.serializer()),
        "command.list" to (SessionKeyParams.serializer() to CommandListResult.serializer()),
        "turn.rewind" to (RewindParams.serializer() to RewindResult.serializer()),
        "session.branches" to (SessionKeyParams.serializer() to BranchesResult.serializer()),
        "session.switchBranch" to (SwitchBranchParams.serializer() to Empty.serializer()),
        "session.fork" to (RewindParams.serializer() to ForkResult.serializer()),
        "turn.dequeue" to (SessionKeyParams.serializer() to DequeueResult.serializer()),
        "session.create" to (CreateParams.serializer() to CreateResult.serializer()),
        "model.list" to (SessionKeyParams.serializer() to ModelListResult.serializer()),
        "model.set" to (ModelSetParams.serializer() to ModelSetResult.serializer()),
        "attachment.upload" to (UploadParams.serializer() to UploadResult.serializer()),
        "attachment.get" to (AttachmentGetParams.serializer() to AttachmentGetResult.serializer()),
        "thinking.set" to (ThinkingSetParams.serializer() to ThinkingSetResult.serializer()),
        "capability.list" to (SessionKeyParams.serializer() to CapabilityList.serializer()),
        "capability.set" to (CapabilitySetParams.serializer() to CapabilitySetResult.serializer()),
        "settings.cacheWarming.get" to (Empty.serializer() to CacheWarmingValue.serializer()),
        "settings.cacheWarming.set" to (CacheWarmingValue.serializer() to CacheWarmingValue.serializer()),
        "ui.respond" to (UiResponse.serializer() to Accepted.serializer()),
        "ui.cancel" to (UiCancelParams.serializer() to Accepted.serializer()),
    )

    val events: Map<String, KSerializer<*>> = mapOf(
        "sessions.update" to SessionsUpdate.serializer(),
        "turn.patch" to TurnPatchEvent.serializer(),
        "ui.request" to UiRequest.serializer(),
        "ui.dismiss" to UiDismiss.serializer(),
        "settings.changed" to SettingsChanged.serializer(),
        "host.notice" to HostNotice.serializer(),
    )
}
