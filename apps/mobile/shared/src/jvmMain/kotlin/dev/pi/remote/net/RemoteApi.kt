package dev.pi.remote.net

import dev.pi.remote.protocol.Accepted
import dev.pi.remote.protocol.ReviewDiffParams
import dev.pi.remote.protocol.ReviewDiffResult
import dev.pi.remote.protocol.AbortResult
import dev.pi.remote.protocol.DequeueResult
import dev.pi.remote.protocol.SessionStatsResult
import dev.pi.remote.protocol.BranchesResult
import dev.pi.remote.protocol.Empty
import dev.pi.remote.protocol.ForkResult
import dev.pi.remote.protocol.RewindParams
import dev.pi.remote.protocol.SwitchBranchParams
import dev.pi.remote.protocol.RewindResult
import dev.pi.remote.protocol.CommandListResult
import dev.pi.remote.protocol.FileListParams
import dev.pi.remote.protocol.FileWriteParams
import dev.pi.remote.protocol.FileWriteResult
import dev.pi.remote.protocol.AssetGetParams
import dev.pi.remote.protocol.AssetGetResult
import dev.pi.remote.protocol.FsBrowseParams
import dev.pi.remote.protocol.FsBrowseResult
import dev.pi.remote.protocol.FsMkdirParams
import dev.pi.remote.protocol.FsMkdirResult
import dev.pi.remote.protocol.ProjectAddParams
import dev.pi.remote.protocol.ProjectAddResult
import dev.pi.remote.protocol.ProjectSetHiddenParams
import dev.pi.remote.protocol.FileReadParams
import dev.pi.remote.protocol.FileReadResult
import dev.pi.remote.protocol.GitLogParams
import dev.pi.remote.protocol.GitLogResult
import dev.pi.remote.protocol.GitCloneResult
import dev.pi.remote.protocol.GitCommandLog
import dev.pi.remote.protocol.GitCommitDetail
import dev.pi.remote.protocol.GitCommitResult
import dev.pi.remote.protocol.GitFileDiff
import dev.pi.remote.protocol.GitOverview
import dev.pi.remote.protocol.GitParams
import dev.pi.remote.protocol.GitStashList
import dev.pi.remote.protocol.GitSuggestResult
import dev.pi.remote.protocol.GitSyncResult
import dev.pi.remote.protocol.GitTagList
import dev.pi.remote.protocol.GitWorktreeList
import dev.pi.remote.protocol.FileListResult
import dev.pi.remote.protocol.FileSearchParams
import dev.pi.remote.protocol.FileSearchResult
import dev.pi.remote.protocol.CacheWarmingValue
import dev.pi.remote.protocol.CapabilityList
import dev.pi.remote.protocol.CapabilitySetParams
import dev.pi.remote.protocol.CapabilitySetResult
import dev.pi.remote.protocol.CreateParams
import dev.pi.remote.protocol.CreateResult
import dev.pi.remote.protocol.Cursor
import dev.pi.remote.protocol.DeleteResult
import dev.pi.remote.protocol.ModelListResult
import dev.pi.remote.protocol.ModelSetParams
import dev.pi.remote.protocol.ModelSetResult
import dev.pi.remote.protocol.OpenParams
import dev.pi.remote.protocol.OpenResult
import dev.pi.remote.protocol.PageParams
import dev.pi.remote.protocol.PageResult
import dev.pi.remote.protocol.ProjectList
import dev.pi.remote.protocol.SendParams
import dev.pi.remote.protocol.SendResult
import dev.pi.remote.protocol.SessionKeyParams
import dev.pi.remote.protocol.SessionList
import dev.pi.remote.protocol.ThinkingSetParams
import dev.pi.remote.protocol.AttachmentGetParams
import dev.pi.remote.protocol.AttachmentGetResult
import dev.pi.remote.protocol.UploadParams
import dev.pi.remote.protocol.UploadResult
import dev.pi.remote.protocol.ThinkingSetResult
import dev.pi.remote.protocol.ToolDetailParams
import dev.pi.remote.protocol.ToolDetailResult
import dev.pi.remote.protocol.UiCancelParams
import dev.pi.remote.protocol.RemoteJson
import dev.pi.remote.protocol.UiResponse
import dev.pi.remote.protocol.WatchListParams

/** Typed facade over [HostConnection] — one function per gateway method. */
class RemoteApi(private val c: HostConnection) {
    suspend fun projects() = c.typedCall("project.list", Empty.serializer(), Empty(), ProjectList.serializer()).projects
    suspend fun watchList(projectId: String? = null) = c.typedCall("session.watchList", WatchListParams.serializer(), WatchListParams(projectId), SessionList.serializer()).sessions
    suspend fun open(sessionKey: String, cursor: Cursor?) = c.typedCall("session.open", OpenParams.serializer(), OpenParams(sessionKey, cursor), OpenResult.serializer())
    suspend fun delete(sessionKey: String) =
        c.typedCall("session.delete", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), DeleteResult.serializer()).deleted
    suspend fun close(sessionKey: String) = c.typedCall("session.close", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), Empty.serializer())
    suspend fun page(sessionKey: String, before: String, limit: Int = 20) = c.typedCall("turn.page", PageParams.serializer(), PageParams(sessionKey, before, limit), PageResult.serializer())
    suspend fun toolDetail(sessionKey: String, toolCallId: String) = c.typedCall("turn.toolDetail", ToolDetailParams.serializer(), ToolDetailParams(sessionKey, toolCallId), ToolDetailResult.serializer())
    suspend fun send(sessionKey: String, text: String, mode: String, clientMessageId: String) =
        c.typedCall("turn.send", SendParams.serializer(), SendParams(sessionKey, text, mode, clientMessageId), SendResult.serializer())
    suspend fun abort(sessionKey: String) = c.typedCall("turn.abort", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), AbortResult.serializer())
    suspend fun commands(sessionKey: String) = c.typedCall("command.list", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), CommandListResult.serializer()).commands
    suspend fun listFiles(sessionKey: String, path: String, dotfiles: Boolean = false) =
        c.typedCall("file.list", FileListParams.serializer(), FileListParams(sessionKey, path, dotfiles.takeIf { it }), FileListResult.serializer())
    suspend fun searchFiles(sessionKey: String, query: String) =
        c.typedCall("file.search", FileSearchParams.serializer(), FileSearchParams(sessionKey, query), FileSearchResult.serializer()).entries
    suspend fun readFile(sessionKey: String, path: String) =
        c.typedCall("file.read", FileReadParams.serializer(), FileReadParams(sessionKey, path), FileReadResult.serializer(), timeoutMs = 60_000)
    suspend fun writeFile(sessionKey: String, path: String, content: String, expectedRevision: String? = null) =
        c.typedCall("file.write", FileWriteParams.serializer(), FileWriteParams(sessionKey, path, content, expectedRevision), FileWriteResult.serializer())
    /** 手机「新建项目」：翻电脑目录、建目录、把目录登记成项目。 */
    suspend fun browseDirs(path: String? = null, dotfiles: Boolean = false) =
        c.typedCall("fs.browse", FsBrowseParams.serializer(), FsBrowseParams(path, dotfiles.takeIf { it }), FsBrowseResult.serializer())
    suspend fun makeDir(parent: String, name: String) =
        c.typedCall("fs.mkdir", FsMkdirParams.serializer(), FsMkdirParams(parent, name), FsMkdirResult.serializer()).path
    suspend fun addProject(path: String) =
        c.typedCall("project.add", ProjectAddParams.serializer(), ProjectAddParams(path), ProjectAddResult.serializer()).project

    /** 静态资源（mermaid.min.js）走会话通道：经中转也能拿到，而且是端到端加密的。 */
    suspend fun assetChunk(name: String, offset: Int, limit: Int) =
        c.typedCall("asset.get", AssetGetParams.serializer(), AssetGetParams(name, offset, limit), AssetGetResult.serializer(), 60_000)

    suspend fun setProjectHidden(projectId: String, hidden: Boolean) =
        c.typedCall("project.setHidden", ProjectSetHiddenParams.serializer(), ProjectSetHiddenParams(projectId, hidden), Empty.serializer())
    suspend fun gitLog(sessionKey: String, limit: Int = 20) =
        c.typedCall("git.log", GitLogParams.serializer(), GitLogParams(sessionKey, limit), GitLogResult.serializer())

    // —— Git 面板：电脑端的功能在手机上逐个对应 ——
    /** Raw call for the Git panel: one `GitParams` bag, result decoded by the caller. */
    suspend fun gitRaw(method: String, params: GitParams, timeoutMs: Long = 60_000): kotlinx.serialization.json.JsonElement =
        c.call(method, RemoteJson.encodeToJsonElement(GitParams.serializer(), params), timeoutMs)

    private suspend fun <R> gitCall(method: String, params: GitParams, rs: kotlinx.serialization.KSerializer<R>, timeoutMs: Long = 60_000): R =
        c.typedCall(method, GitParams.serializer(), params, rs, timeoutMs)

    suspend fun gitOverview(sessionKey: String, skip: Int? = null, query: String? = null, author: String? = null) =
        gitCall("git.overview", GitParams(sessionKey, skip = skip, query = query, author = author), GitOverview.serializer())

    suspend fun gitStage(sessionKey: String, paths: List<String>) = gitCall("git.stage", GitParams(sessionKey, paths = paths), Empty.serializer())
    suspend fun gitUnstage(sessionKey: String, paths: List<String>) = gitCall("git.unstage", GitParams(sessionKey, paths = paths), Empty.serializer())
    suspend fun gitStageAll(sessionKey: String) = gitCall("git.stageAll", GitParams(sessionKey), Empty.serializer())
    suspend fun gitUnstageAll(sessionKey: String) = gitCall("git.unstageAll", GitParams(sessionKey), Empty.serializer())
    suspend fun gitDiscard(sessionKey: String, tracked: List<String> = emptyList(), untracked: List<String> = emptyList()) =
        gitCall("git.discard", GitParams(sessionKey, tracked = tracked.ifEmpty { null }, untracked = untracked.ifEmpty { null }), Empty.serializer())
    suspend fun gitExclude(sessionKey: String, paths: List<String>) = gitCall("git.exclude", GitParams(sessionKey, paths = paths), Empty.serializer())
    suspend fun gitResolve(sessionKey: String, paths: List<String>, side: String) =
        gitCall("git.resolve", GitParams(sessionKey, paths = paths, side = side), Empty.serializer())
    suspend fun gitCommit(sessionKey: String, message: String, paths: List<String>? = null, action: String = "commit", remote: String? = null) =
        gitCall("git.commit", GitParams(sessionKey, paths = paths, message = message, action = action, remote = remote), GitCommitResult.serializer())
    suspend fun gitSuggestCommit(sessionKey: String, prompt: String? = null) =
        gitCall("git.suggestCommit", GitParams(sessionKey, prompt = prompt), GitSuggestResult.serializer(), timeoutMs = 120_000)
    suspend fun gitSync(sessionKey: String, action: String) =
        gitCall("git.sync", GitParams(sessionKey, action = action), GitSyncResult.serializer(), timeoutMs = 180_000)
    suspend fun gitBranch(sessionKey: String, action: String, name: String, from: String? = null, force: Boolean? = null) =
        gitCall("git.branch", GitParams(sessionKey, name = name, action = action, from = from, force = force), Empty.serializer())
    suspend fun gitMerge(sessionKey: String, ref: String, noFf: Boolean = false) =
        gitCall("git.merge", GitParams(sessionKey, ref = ref, noFf = noFf.takeIf { it }), Empty.serializer())
    suspend fun gitRebase(sessionKey: String, ref: String) = gitCall("git.rebase", GitParams(sessionKey, ref = ref), Empty.serializer())
    suspend fun gitCherryPick(sessionKey: String, ref: String) = gitCall("git.cherryPick", GitParams(sessionKey, ref = ref), Empty.serializer())
    suspend fun gitOperation(sessionKey: String, operation: String, action: String) =
        gitCall("git.operation", GitParams(sessionKey, operation = operation, action = action), Empty.serializer())
    suspend fun gitStash(sessionKey: String, action: String, message: String? = null, ref: String? = null, includeUntracked: Boolean = false) =
        gitCall("git.stash", GitParams(sessionKey, action = action, message = message, ref = ref, includeUntracked = includeUntracked.takeIf { it }), GitStashList.serializer())
    suspend fun gitTag(sessionKey: String, action: String, name: String? = null, target: String? = null, message: String? = null, remote: String? = null) =
        gitCall("git.tag", GitParams(sessionKey, action = action, name = name, target = target, message = message, remote = remote), GitTagList.serializer())
    suspend fun gitRemote(sessionKey: String, action: String, name: String, url: String? = null, to: String? = null, branch: String? = null) =
        gitCall("git.remote", GitParams(sessionKey, action = action, name = name, url = url, to = to, branch = branch), Empty.serializer(), timeoutMs = 180_000)
    suspend fun gitWorktree(sessionKey: String, action: String, path: String? = null, branch: String? = null, create: Boolean = false) =
        gitCall("git.worktree", GitParams(sessionKey, action = action, path = path, branch = branch, create = create.takeIf { it }), GitWorktreeList.serializer(), timeoutMs = 180_000)
    suspend fun gitDiff(sessionKey: String, path: String, staged: Boolean = false, commit: String? = null) =
        gitCall("git.diff", GitParams(sessionKey, path = path, staged = staged.takeIf { it }, commit = commit), GitFileDiff.serializer())
    suspend fun gitCommitDetail(sessionKey: String, ref: String) =
        gitCall("git.commitDetail", GitParams(sessionKey, ref = ref), GitCommitDetail.serializer())
    suspend fun gitReset(sessionKey: String, hash: String, mode: String) =
        gitCall("git.reset", GitParams(sessionKey, hash = hash, mode = mode), Empty.serializer())
    suspend fun gitCheckout(sessionKey: String, ref: String) = gitCall("git.checkout", GitParams(sessionKey, ref = ref), Empty.serializer())
    suspend fun gitCheckoutCommit(sessionKey: String, ref: String) = gitCall("git.checkoutCommit", GitParams(sessionKey, ref = ref), Empty.serializer())
    suspend fun gitInit(sessionKey: String) = gitCall("git.init", GitParams(sessionKey), Empty.serializer())
    suspend fun gitClone(sessionKey: String, url: String, path: String) =
        gitCall("git.clone", GitParams(sessionKey, url = url, path = path), GitCloneResult.serializer(), timeoutMs = 300_000)
    suspend fun gitCommandLog(sessionKey: String, limit: Int? = null) =
        gitCall("git.commandLog", GitParams(sessionKey, limit = limit), GitCommandLog.serializer())
    suspend fun gitClearCommandLog(sessionKey: String) = gitCall("git.clearCommandLog", GitParams(sessionKey), Empty.serializer())
    suspend fun branches(sessionKey: String) = c.typedCall("session.branches", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), BranchesResult.serializer()).branches
    suspend fun switchBranch(sessionKey: String, leafId: String) = c.typedCall("session.switchBranch", SwitchBranchParams.serializer(), SwitchBranchParams(sessionKey, leafId), Empty.serializer())
    suspend fun fork(sessionKey: String, anchor: String) = c.typedCall("session.fork", RewindParams.serializer(), RewindParams(sessionKey, anchor), ForkResult.serializer())
    suspend fun rewind(sessionKey: String, anchor: String) = c.typedCall("turn.rewind", RewindParams.serializer(), RewindParams(sessionKey, anchor), RewindResult.serializer())
    suspend fun reviewDiff(sessionKey: String, scope: String, turnId: String? = null, path: String? = null) =
        c.typedCall("review.diff", ReviewDiffParams.serializer(), ReviewDiffParams(sessionKey, scope, turnId, path), ReviewDiffResult.serializer())
    suspend fun stats(sessionKey: String) = c.typedCall("session.stats", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), SessionStatsResult.serializer())
    suspend fun dequeue(sessionKey: String) = c.typedCall("turn.dequeue", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), DequeueResult.serializer())
    suspend fun create(projectId: String, capabilities: List<String>? = null) = c.typedCall("session.create", CreateParams.serializer(), CreateParams(projectId, capabilities), CreateResult.serializer())
    suspend fun models(sessionKey: String) = c.typedCall("model.list", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), ModelListResult.serializer())
    suspend fun setModel(sessionKey: String, modelId: String) = c.typedCall("model.set", ModelSetParams.serializer(), ModelSetParams(sessionKey, modelId), ModelSetResult.serializer())
    /** Uploads can be several MB: give them a longer timeout than ordinary calls. */
    suspend fun upload(name: String, mime: String, base64: String) =
        c.typedCall("attachment.upload", UploadParams.serializer(), UploadParams(name, mime, base64), UploadResult.serializer(), timeoutMs = 60_000)
    suspend fun attachment(path: String) =
        c.typedCall("attachment.get", AttachmentGetParams.serializer(), AttachmentGetParams(path), AttachmentGetResult.serializer(), timeoutMs = 60_000)
    suspend fun setThinking(sessionKey: String, level: String) = c.typedCall("thinking.set", ThinkingSetParams.serializer(), ThinkingSetParams(sessionKey, level), ThinkingSetResult.serializer())
    suspend fun capabilities(sessionKey: String) = c.typedCall("capability.list", SessionKeyParams.serializer(), SessionKeyParams(sessionKey), CapabilityList.serializer()).capabilities
    suspend fun setCapability(sessionKey: String, id: String, on: Boolean) = c.typedCall("capability.set", CapabilitySetParams.serializer(), CapabilitySetParams(sessionKey, id, on), CapabilitySetResult.serializer())
    suspend fun cacheWarming() = c.typedCall("settings.cacheWarming.get", Empty.serializer(), Empty(), CacheWarmingValue.serializer()).mode
    suspend fun setCacheWarming(mode: String) = c.typedCall("settings.cacheWarming.set", CacheWarmingValue.serializer(), CacheWarmingValue(mode), CacheWarmingValue.serializer()).mode
    suspend fun respondUi(response: UiResponse) = c.typedCall("ui.respond", UiResponse.serializer(), response, Accepted.serializer()).accepted
    suspend fun cancelUi(id: String) = c.typedCall("ui.cancel", UiCancelParams.serializer(), UiCancelParams(id), Accepted.serializer()).accepted
}
