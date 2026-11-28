package dev.pi.remote.app.data

import dev.pi.remote.protocol.CommandInfo
import dev.pi.remote.protocol.ContextStats
import dev.pi.remote.protocol.SessionStatsResult
import dev.pi.remote.protocol.ReviewDiffResult
import dev.pi.remote.protocol.BranchInfo
import dev.pi.remote.protocol.ForkResult
import dev.pi.remote.protocol.TimelineReset
import dev.pi.remote.protocol.FileEntry
import dev.pi.remote.protocol.FileListResult
import dev.pi.remote.crypto.Hs2Payload
import dev.pi.remote.net.HostConnection
import dev.pi.remote.net.RemoteApi
import dev.pi.remote.protocol.AppInfo
import dev.pi.remote.protocol.Base64Url
import dev.pi.remote.protocol.CapabilityRow
import dev.pi.remote.protocol.ClientCaps
import dev.pi.remote.protocol.HelloParams
import dev.pi.remote.protocol.HelloResult
import dev.pi.remote.protocol.ModelListResult
import dev.pi.remote.protocol.PairOffer
import dev.pi.remote.protocol.FileReadResult
import dev.pi.remote.protocol.TeamBoardResult
import dev.pi.remote.protocol.FileWriteResult
import dev.pi.remote.protocol.GitLogResult
import dev.pi.remote.protocol.FsBrowseResult
import dev.pi.remote.protocol.GitOverview
import dev.pi.remote.protocol.GitParams
import dev.pi.remote.protocol.ProjectInfo
import dev.pi.remote.protocol.RemoteJson
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.protocol.SessionsUpdate
import dev.pi.remote.protocol.SettingsChanged
import dev.pi.remote.protocol.ToolDetailResult
import dev.pi.remote.protocol.TurnPatchEvent
import dev.pi.remote.protocol.UiDismiss
import dev.pi.remote.protocol.UiRequest
import dev.pi.remote.protocol.UiResponse
import dev.pi.remote.sync.ApplyResult
import dev.pi.remote.sync.SessionTimeline
import dev.pi.remote.sync.TurnStore
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** Templates / components / dialog kinds this build renders natively (sent in host.hello). */
val CLIENT_CAPS = ClientCaps(
    templates = listOf("bash", "read", "edit", "write", "search", "default", "list", "kv", "media", "tree"),
    piUi = listOf("stat-grid", "chart", "data-table", "card-grid", "diff", "quiz", "decision-tree", "gantt"),
    uiKinds = listOf("select", "confirm", "input", "editor", "notify", "ask_user_question", "image_review"),
)

data class InboxState(
    val sessions: List<SessionSummary> = emptyList(),
    val projects: List<ProjectInfo> = emptyList(),
    val loaded: Boolean = false,
)

sealed interface SendOutcome {
    data object Sent : SendOutcome
    /** The socket dropped before the answer: the message may or may not have arrived. */
    data object Unknown : SendOutcome
    data class Failed(val message: String) : SendOutcome
}

/**
 * App-wide remote state for the active host: one [HostConnection], the inbox, and the
 * timeline of the open session. Survives screen changes; connects only while the app is in
 * the foreground (30 s grace after backgrounding).
 */
class RemoteRepository(
    private val scope: CoroutineScope,
    private val hostStore: HostStore,
    private val keyVault: KeyVault,
    private val cache: TimelineCache,
    private val assetDir: File,
    private val deviceName: String,
    private val platform: String,
    private val appVersion: String,
) {
    /** In-memory per-session UI state, kept while navigating or reconnecting. */
    val sessionDrafts = mutableMapOf<String, String>()
    val sessionReadPositions = mutableMapOf<String, Pair<Int, Int>>()

    private val _hosts = MutableStateFlow(hostStore.hosts)
    val hosts: StateFlow<List<SavedHost>> = _hosts
    private val _active = MutableStateFlow(hostStore.hosts.firstOrNull { it.hostId == hostStore.activeHostId })
    val active: StateFlow<SavedHost?> = _active
    private val _connection = MutableStateFlow<HostConnection.State>(HostConnection.State.Idle)
    val connection: StateFlow<HostConnection.State> = _connection
    /** 心跳往返时间（毫秒），断开后为 null。 */
    private val _latency = MutableStateFlow<Long?>(null)
    val latency: StateFlow<Long?> = _latency
    private val _inbox = MutableStateFlow(InboxState())
    val inbox: StateFlow<InboxState> = _inbox
    private val _timelines = MutableStateFlow<Map<String, SessionTimeline>>(emptyMap())
    val timelines: StateFlow<Map<String, SessionTimeline>> = _timelines
    private val _pendingSends = MutableStateFlow<Map<String, String>>(emptyMap())
    /** Text sent from this phone that the host has not echoed back as a turn yet (shown as a ghost bubble). */
    val pendingSends: StateFlow<Map<String, String>> = _pendingSends
    private val _settingsVersion = MutableStateFlow(0)
    val settingsVersion: StateFlow<Int> = _settingsVersion
    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val notices: SharedFlow<String> = _notices

    private var conn: HostConnection? = null
    private var api: RemoteApi? = null
    private var jobs = mutableListOf<Job>()
    private var openKey: String? = null
    private var stopJob: Job? = null
    private var hello: HelloResult? = null
    private var foreground = false
    private val projectImages = android.util.LruCache<String, android.graphics.Bitmap>(24)

    private val helloParams get() = HelloParams(AppInfo("pi-remote", appVersion, platform), CLIENT_CAPS)

    init {
        _active.value?.let { h -> _inbox.value = InboxState(sessions = cache.loadInbox(h.hostId)) }
    }

    // ── Hosts / pairing ──

    /** Pair with a scanned/pasted offer. Resolves once the host accepted and answered hello. */
    suspend fun pair(offer: PairOffer): Result<SavedHost> {
        disconnect()
        var saved: SavedHost? = null
        val c = HostConnection(
            scope, offer.endpoints, Base64Url.decode(offer.hostPub), keyVault.identity(), deviceName, platform, helloParams, offer.pairToken,
            tlsPin = offer.tls,
            relayPin = offer.relayTls,
            onPaired = { p: Hs2Payload ->
                // Re-pairing the same computer keeps the addresses the user typed in.
                val manual = hostStore.hosts.firstOrNull { it.hostId == p.hostId }?.manualEndpoints.orEmpty()
                saved = SavedHost(p.hostId, p.hostName, offer.hostPub, offer.endpoints, p.deviceId, p.role, System.currentTimeMillis(), manual, tlsPin = offer.tls, relayTlsPin = offer.relayTls).also {
                    hostStore.upsert(it)
                    _hosts.value = hostStore.hosts
                }
            },
        )
        c.start()
        val end = withTimeoutOrNull(20_000) { c.state.first { it is HostConnection.State.Ready || it is HostConnection.State.Refused } }
        c.stop()
        return when {
            end is HostConnection.State.Ready && saved != null -> {
                select(saved!!.hostId)
                Result.success(saved!!)
            }
            end is HostConnection.State.Refused -> Result.failure(IllegalStateException(end.code))
            else -> Result.failure(IllegalStateException("unreachable"))
        }
    }

    fun select(hostId: String) {
        val host = hostStore.hosts.firstOrNull { it.hostId == hostId } ?: return
        hostStore.setActive(hostId)
        if (_active.value?.hostId != hostId) {
            disconnect()
            _timelines.value = emptyMap()
            _inbox.value = InboxState(sessions = cache.loadInbox(hostId))
        }
        _active.value = host
        if (foreground) connect()
    }

    /** Replace a host's typed-in addresses; the active connection tries them on its next attempt. */
    fun setManualEndpoints(hostId: String, list: List<String>) {
        val host = hostStore.hosts.firstOrNull { it.hostId == hostId } ?: return
        val updated = host.copy(manualEndpoints = list.distinct())
        hostStore.update(updated)
        _hosts.value = hostStore.hosts
        if (_active.value?.hostId == hostId) {
            _active.value = updated
            conn?.updateEndpoints(updated.allEndpoints)
            if (_connection.value !is HostConnection.State.Ready) conn?.kick()
        }
    }

    fun forget(hostId: String) {
        if (_active.value?.hostId == hostId) {
            disconnect()
            _active.value = null
            _inbox.value = InboxState()
            _timelines.value = emptyMap()
        }
        hostStore.remove(hostId)
        cache.clearHost(hostId)
        _hosts.value = hostStore.hosts
    }

    // ── Lifecycle ──

    fun onForeground() {
        foreground = true
        openKey?.let { notifier?.clear(it) }
        updateKeepAlive()
        stopJob?.cancel()
        stopJob = null
        val c = conn
        if (c == null) connect() else c.probeAlive()
    }

    fun onBackground() {
        foreground = false
        scheduleDisconnect()
        updateKeepAlive()
    }

    fun retry() {
        conn?.kick() ?: connect()
    }

    /**
     * Pull to refresh: re-list projects and sessions (the host rescans its session files, which
     * catches desktop changes that never reached us as `sessions.update`). Offline, it reconnects
     * instead (the list reloads on ready) and waits briefly for the link. False on failure.
     */
    suspend fun refreshInbox(): Boolean {
        if (_connection.value !is HostConnection.State.Ready) {
            retry()
            return withTimeoutOrNull(8_000) { _connection.first { it is HostConnection.State.Ready } } != null
        }
        val a = api ?: return false
        return runCatching {
            val projects = a.projects()
            val sessions = a.watchList()
            // 宿主列表是唯一事实源：电脑上删掉的会话不能在手机上借缓存复活。
            val alive = sessions.map { it.sessionKey }.toSet()
            _timelines.update { m -> m.filterKeys { it in alive } }
            _pendingSends.update { m -> m.filterKeys { it in alive } }
            _inbox.value = InboxState(sessions, projects, loaded = true)
            cache.pruneInbox(alive)
            persistInbox()
        }.onFailure { _notices.tryEmit(it.message ?: "list failed") }.isSuccess
    }

    private fun connect() {
        val host = _active.value ?: return
        if (conn != null) return
        val c = HostConnection(
            scope, host.allEndpoints, Base64Url.decode(host.hostPub), keyVault.identity(), deviceName, platform, helloParams,
            tlsPin = host.tlsPin,
            relayPin = host.relayTlsPin,
        )
        conn = c
        api = RemoteApi(c)
        jobs += scope.launch { c.state.collect { s -> _connection.value = s; if (s is HostConnection.State.Ready) onReady(s) } }
        jobs += scope.launch { c.latencyMs.collect { _latency.value = it } }
        jobs += scope.launch { c.events.collect(::onEvent) }
        c.start()
    }

    private fun disconnect() {
        jobs.forEach { it.cancel() }
        jobs.clear()
        conn?.stop()
        conn = null
        api = null
        _connection.value = HostConnection.State.Idle
    }

    private suspend fun onReady(s: HostConnection.State.Ready) {
        hello = s.hello
        _active.value?.let { h ->
            // Remember what worked (first) plus the host's current addresses, so the next start
            // connects at once and a DHCP change does not need a new QR scan.
            val endpoints = (listOf(s.endpoint) + s.hello.endpoints + h.endpoints).distinct().take(8)
            val updated = h.copy(hostName = s.hello.hostName, role = s.hello.role, endpoints = endpoints, lastConnectedAt = System.currentTimeMillis())
            conn?.updateEndpoints(updated.allEndpoints)
            hostStore.upsert(updated)
            _active.value = updated
            _hosts.value = hostStore.hosts
        }
        val a = api ?: return
        runCatching {
            val projects = a.projects()
            val sessions = a.watchList()
            // 宿主列表是唯一事实源：电脑上删掉的会话不能在手机上借缓存复活。
            val alive = sessions.map { it.sessionKey }.toSet()
            _timelines.update { m -> m.filterKeys { it in alive } }
            _pendingSends.update { m -> m.filterKeys { it in alive } }
            _inbox.value = InboxState(sessions, projects, loaded = true)
            cache.pruneInbox(alive)
            persistInbox()
        }.onFailure { _notices.tryEmit(it.message ?: "list failed") }
        openKey?.let { reopen(it) }
    }

    private fun persistInbox() {
        val host = _active.value ?: return
        val sessions = _inbox.value.sessions
        scope.launch(Dispatchers.IO) { cache.saveInbox(host.hostId, sessions) }
    }

    private fun onEvent(e: HostConnection.Event) {
        when (e.method) {
            "sessions.update" -> {
                val u = RemoteJson.decodeFromJsonElement(SessionsUpdate.serializer(), e.payload)
                val before = _inbox.value.sessions.associateBy { it.sessionKey }
                _inbox.update { inbox ->
                    val byKey = inbox.sessions.associateBy { it.sessionKey }.toMutableMap()
                    u.sessions.forEach { byKey[it.sessionKey] = it }
                    u.removed?.forEach { byKey.remove(it) }
                    inbox.copy(sessions = byKey.values.sortedByDescending { it.updatedAt })
                }
                // 运行中/已结束都算宿主收到了那条消息
                u.sessions.forEach { if (it.status == "running" || it.status == "needsInput") _pendingSends.update { p -> p - it.sessionKey } }
                // 当前正在看的会话有变化：主动补一次，避免漏包导致"发了没显示"
                val open = openKey
                if (open != null && u.sessions.any { it.sessionKey == open }) scope.launch { resync(open) }
                persistInbox()
                noticeTransitions(before, u.sessions)
            }
            "turn.patch" -> {
                val evt = RemoteJson.decodeFromJsonElement(TurnPatchEvent.serializer(), e.payload)
                // 任何一条时间线补丁都说明宿主已经收下这条消息：先撤掉「发送中」，别再挂着。
                _pendingSends.update { it - evt.sessionKey }
                val current = _timelines.value[evt.sessionKey] ?: return
                if (evt.patches.any { it is TimelineReset }) {
                    scope.launch { reopen(evt.sessionKey, fresh = true) }
                    return
                }
                when (val r = TurnStore.applyAll(current, evt.patches)) {
                    is ApplyResult.Applied -> putTimeline(r.timeline)
                    is ApplyResult.Gap -> {
                        putTimeline(r.timeline)
                        scope.launch { reopen(evt.sessionKey) }
                    }
                }
            }
            "ui.request" -> {
                val req = RemoteJson.decodeFromJsonElement(UiRequest.serializer(), e.payload)
                _timelines.value[req.sessionKey]?.let { putTimeline(TurnStore.addUi(it, req)) }
            }
            "ui.dismiss" -> {
                val d = RemoteJson.decodeFromJsonElement(UiDismiss.serializer(), e.payload)
                _timelines.value[d.sessionKey]?.let { putTimeline(TurnStore.removeUi(it, d.id)) }
            }
            "settings.changed" -> {
                RemoteJson.decodeFromJsonElement(SettingsChanged.serializer(), e.payload)
                _settingsVersion.update { it + 1 }
            }
            "host.notice" -> _notices.tryEmit(e.payload.toString())
        }
    }

    private fun putTimeline(t: SessionTimeline) {
        _timelines.update { it + (t.sessionKey to t) }
        val pending = _pendingSends.value[t.sessionKey] ?: return
        if (t.turns.takeLast(2).any { it.user.text.trim() == pending }) _pendingSends.update { it - t.sessionKey }
    }

    private var saveJob: Job? = null
    private fun persistTimeline(key: String) {
        val host = _active.value ?: return
        saveJob?.cancel()
        saveJob = scope.launch(Dispatchers.IO) {
            delay(1500)
            _timelines.value[key]?.let { cache.saveTimeline(host.hostId, it) }
        }
    }

    // ── Sessions ──

    /** Show cache immediately, then sync (replay from cursor when possible). */
    suspend fun openSession(key: String) {
        openKey = key
        // The session screen stays composed in the background and re-opens on reconnects;
        // only an actual look at it (foreground) should clear its notification.
        if (foreground) notifier?.clear(key)
        val host = _active.value
        if (_timelines.value[key] == null && host != null) {
            withContext(Dispatchers.IO) { cache.loadTimeline(host.hostId, key) }?.let { putTimeline(it) }
        }
        reopen(key)
    }

    private suspend fun reopen(key: String, fresh: Boolean = false) {
        val a = api ?: return
        if (conn?.isReady != true) return
        val prev = _timelines.value[key]
        val cursor = if (fresh) null else prev?.cursor?.takeIf { it.epoch == hello?.epoch }
        runCatching { a.open(key, cursor) }
            .onSuccess { r ->
                // A rewind happened while we were away: the replayed patches describe a stale branch.
                if (r.kind == "replay" && r.patches.orEmpty().any { it is TimelineReset }) {
                    reopen(key, fresh = true)
                    return@onSuccess
                }
                putTimeline(TurnStore.fromOpen(prev?.takeIf { r.kind == "replay" }, r))
                persistTimeline(key)
            }
            .onFailure { _notices.tryEmit(it.message ?: "open failed") }
    }

    fun closeSession(key: String) {
        if (openKey == key) openKey = null
        persistTimeline(key)
        val a = api ?: return
        scope.launch { runCatching { a.close(key) } }
    }

    suspend fun loadOlder(key: String) {
        val a = api ?: return
        val t = _timelines.value[key] ?: return
        val first = t.turns.firstOrNull() ?: return
        runCatching { a.page(key, first.anchor) }.onSuccess { r ->
            _timelines.value[key]?.let { putTimeline(TurnStore.prependOlder(it, r.turns, r.hasOlder)) }
        }
    }

    suspend fun send(key: String, text: String, mode: String): SendOutcome {
        val clientMessageId = "m_${UUID.randomUUID()}"
        val a = api ?: run {
            retry()
            val ready = withTimeoutOrNull(8_000) { _connection.first { it is HostConnection.State.Ready } }
            if (ready == null) return SendOutcome.Failed("offline")
            api ?: return SendOutcome.Failed("offline")
        }
        if (mode == "prompt") _pendingSends.update { it + (key to text.trim()) }
        return try {
            a.send(key, text, mode, clientMessageId)
            // 宿主收下之后立刻补一次同步：万一补丁在路上丢了，也不会出现「发了没反应、退出再进才看到」。
            if (mode == "prompt") scope.launch { delay(700); resync(key) }
            SendOutcome.Sent
        } catch (e: HostConnection.ConnectionLost) {
            // 断在半路：同一 clientMessageId 走重连重试一次（PC 端已做幂等去重，不会重复发送）。
            conn?.kick()
            val ready = withTimeoutOrNull(8_000) { _connection.first { it is HostConnection.State.Ready } }
            val nextApi = api
            if (ready != null && nextApi != null) {
                val retried = runCatching { nextApi.send(key, text, mode, clientMessageId) }
                if (retried.isSuccess) {
                    if (mode == "prompt") scope.launch { delay(700); resync(key) }
                    return SendOutcome.Sent
                }
            }
            scope.launch { resync(key) }
            SendOutcome.Unknown
        } catch (_: kotlinx.coroutines.TimeoutCancellationException) {
            // 常见于冷会话唤醒或长链路响应慢：宿主大概率已收下并开始跑，绝不回退输入框！
            scope.launch { resync(key) }
            SendOutcome.Unknown
        } catch (e: HostConnection.CallException) {
            _pendingSends.update { it - key }
            SendOutcome.Failed(e.message ?: "send failed")
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            scope.launch { resync(key) }
            SendOutcome.Unknown
        }
    }

    /** 主动对齐一次时间线（补发/漏包时用）：没有本地时间线就从快照重建。 */
    suspend fun resync(key: String) {
        if (conn?.isReady != true) return
        reopen(key)
    }

    /** 排队消息「立即发送」：中断当前轮并把队列里的消息合并立即发出去。 */
    suspend fun flushQueue(key: String): Boolean {
        val restored = abort(key) ?: return false
        val merged = restored.map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n\n")
        if (merged.isEmpty()) return false
        return send(key, merged, "prompt") != SendOutcome.Failed("offline")
    }

    /** Queued texts the host pulled back, or null when the stop did not reach it. */
    suspend fun abort(key: String): List<String>? = runCatching { api?.abort(key)?.let { it.restored.orEmpty() } }.getOrNull()

    private val commandCache = HashMap<String, Pair<Long, List<CommandInfo>>>()

    /** Slash commands for the session's project; cached briefly so the panel opens instantly. */
    suspend fun commands(key: String, maxAgeMs: Long = 15_000): List<CommandInfo>? {
        commandCache[key]?.let { (at, list) -> if (System.currentTimeMillis() - at < maxAgeMs) return list }
        val list = runCatching { api?.commands(key) }.getOrNull() ?: return commandCache[key]?.second
        commandCache[key] = System.currentTimeMillis() to list
        return list
    }

    fun cachedCommands(key: String): List<CommandInfo>? = commandCache[key]?.second

    suspend fun listFiles(key: String, path: String, dotfiles: Boolean = false): FileListResult? =
        runCatching { api?.listFiles(key, path, dotfiles) }.getOrNull()

    suspend fun listFilesResult(key: String, path: String, dotfiles: Boolean = false): Result<FileListResult> =
        runCatching { (api ?: error("offline")).listFiles(key, path, dotfiles) }

    suspend fun searchFiles(key: String, query: String): List<FileEntry>? = runCatching { api?.searchFiles(key, query) }.getOrNull()

    /** Rewind before the turn's user message; the message text on success, failure message otherwise. */
    suspend fun rewind(key: String, anchor: String): Result<String> = runCatching {
        val a = api ?: error("offline")
        a.rewind(key, anchor).editorText.orEmpty()
    }.onSuccess { reopen(key, fresh = true) }

    /** Commits of the session's project (phone Git view). */
    /** 删除会话（和电脑端「删除对话」是同一个动作）；成功后本地列表与缓存一起清掉。 */
    suspend fun deleteSession(key: String): Boolean {
        val a = api ?: return false
        return runCatching {
            if (!a.delete(key)) return@runCatching false
            _inbox.update { inbox -> inbox.copy(sessions = inbox.sessions.filterNot { it.sessionKey == key }) }
            _timelines.update { it - key }
            _pendingSends.update { it - key }
            persistInbox()
            true
        }.getOrDefault(false)
    }

    /** 手机端编辑保存（有 revision 守卫，过期就拒绝而不是覆盖）。 */
    suspend fun writeFile(key: String, path: String, content: String, expectedRevision: String? = null): Result<FileWriteResult> =
        runCatching { api?.writeFile(key, path, content, expectedRevision) ?: error("offline") }

    /** 手机「新建项目」：翻电脑目录（[path] 为空时给盘符 / 用户目录）。 */
    suspend fun browseDirs(path: String? = null, dotfiles: Boolean = false): Result<FsBrowseResult> =
        runCatching { api?.browseDirs(path, dotfiles) ?: error("offline") }

    /** 在电脑上新建一个文件夹（当新项目用）。 */
    suspend fun makeDir(parent: String, name: String): Result<String> =
        runCatching { api?.makeDir(parent, name) ?: error("offline") }

    /** 把一个电脑目录登记成项目，返回项目（电脑侧栏里也会出现）。 */
    suspend fun addProject(path: String): Result<dev.pi.remote.protocol.ProjectInfo> = runCatching {
        val project = api?.addProject(path) ?: error("offline")
        runCatching { refreshInbox() }
        project
    }

    /** 和电脑侧栏同一份隐藏列表：隐藏/恢复后立刻重拉项目列表。 */
    suspend fun setProjectHidden(projectId: String, hidden: Boolean): Boolean {
        val a = api ?: return false
        return runCatching {
            a.setProjectHidden(projectId, hidden)
            val projects = a.projects()
            _inbox.update { it.copy(projects = projects) }
            true
        }.getOrDefault(false)
    }

    suspend fun gitLog(key: String, limit: Int = 20): Result<GitLogResult> =
        runCatching { api?.gitLog(key, limit) ?: error("offline") }

    /** 手机端 Git 面板：读一眼全貌（分支、改动、图谱、分支表、stash/tag/remote/worktree）。 */
    suspend fun gitOverview(key: String, skip: Int? = null, query: String? = null, author: String? = null): Result<GitOverview> =
        runCatching { api?.gitOverview(key, skip, query, author) ?: error("offline") }

    /** 任意 git 方法与结果解码：动作类方法用 `Empty`，列表类用对应 result。 */
    suspend fun <T> gitCall(
        method: String,
        params: GitParams,
        ser: kotlinx.serialization.KSerializer<T>,
        timeoutMs: Long = 60_000,
    ): Result<T> = runCatching {
        val a = api ?: error("offline")
        RemoteJson.decodeFromJsonElement(ser, a.gitRaw(method, params, timeoutMs))
    }

    suspend fun teamBoard(key: String): Result<TeamBoardResult> =
        runCatching { api?.teamBoard(key) ?: error("offline") }

    /** One file for the phone reader: text (capped) or an image as base64. */
    suspend fun readFile(key: String, path: String): Result<FileReadResult> =
        runCatching { api?.readFile(key, path) ?: error("offline") }

    /**
     * 项目内图片（生图结果、截图）解码成位图；按路径缓存，聊天里滚动不会反复拉取。
     * 拉取失败返回 null，界面显示占位图标而不是报错。
     */
    suspend fun projectImage(key: String, path: String): android.graphics.Bitmap? = withContext(Dispatchers.IO) {
        projectImages.get(path)?.let { return@withContext it }
        val file = readFile(key, path).getOrNull() ?: return@withContext null
        val data = file.data ?: return@withContext null
        if (file.kind != "image") return@withContext null
        val bytes = runCatching { android.util.Base64.decode(data, android.util.Base64.DEFAULT) }.getOrNull() ?: return@withContext null
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also { projectImages.put(path, it) }
    }

    suspend fun branches(key: String): Result<List<BranchInfo>> = runCatching { api?.branches(key) ?: error("offline") }

    /** Make another branch active; viewers re-open like after a rewind. */
    suspend fun switchBranch(key: String, leafId: String): Result<Unit> = runCatching {
        (api ?: error("offline")).switchBranch(key, leafId)
        Unit
    }.onSuccess { reopen(key, fresh = true) }

    /** Fork before a user message: the new session's key and the message to edit there. */
    suspend fun fork(key: String, anchor: String): Result<ForkResult> = runCatching { (api ?: error("offline")).fork(key, anchor) }

    /** `review.diff`: file list (no [path]) or one file's lines; failure carries the host's message. */
    suspend fun reviewDiff(key: String, scope: String, turnId: String? = null, path: String? = null): Result<ReviewDiffResult> =
        runCatching { api?.reviewDiff(key, scope, turnId, path) ?: error("offline") }

    suspend fun sessionStats(key: String): SessionStatsResult? = runCatching { api?.stats(key) }.getOrNull()

    suspend fun dequeue(key: String): List<String>? = runCatching { api?.dequeue(key)?.restored }.getOrNull()

    suspend fun respondUi(key: String, response: UiResponse): Boolean {
        val ok = runCatching { api?.respondUi(response) ?: false }.getOrDefault(false)
        _timelines.value[key]?.let { putTimeline(TurnStore.removeUi(it, response.id)) }
        return ok
    }

    suspend fun cancelUi(key: String, id: String) {
        runCatching { api?.cancelUi(id) }
        _timelines.value[key]?.let { putTimeline(TurnStore.removeUi(it, id)) }
    }

    suspend fun models(key: String): ModelListResult? = runCatching { api?.models(key) }.getOrNull()
    suspend fun setModel(key: String, id: String) = runCatching { api?.setModel(key, id) }
    private val _pendingShare = MutableStateFlow<SharedContent?>(null)
    /** Shared from another app; the next opened session takes it into its composer. */
    val pendingShare: StateFlow<SharedContent?> = _pendingShare
    fun share(content: SharedContent) { _pendingShare.value = content }
    fun takeShare(): SharedContent? = _pendingShare.value.also { _pendingShare.value = null }

    /** Set by [dev.pi.remote.app.AppGraph]: run notifications and the background keep-alive. */
    var notifier: RunNotifier? = null
    private var keptAlive = false

    /** Notify on running → done/failed and on a new question, unless the user is looking at it. */
    /** 后台完成/需要回答时响一声（由 AppGraph 接到 SoundAlerts）。 */
    var onSoundAlert: (() -> Unit)? = null
    /** UI 上要能开关声音提醒，所以这里也留一个引用。 */
    var soundAlerts: SoundAlerts? = null

    private fun noticeTransitions(before: Map<String, SessionSummary>, after: List<SessionSummary>) {
        val n = notifier
        for (s in after) {
            val was = before[s.sessionKey]?.status ?: continue
            val settled = was == "running" && s.status != "running"
            val asks = s.status == "needsInput" && was != "needsInput"
            val visible = foreground && openKey == s.sessionKey
            if ((settled || asks) && !visible) {
                n?.notifySession(s)
                // 正在看的会话不响；其它会话（含后台）完成或提问都提醒一下。
                onSoundAlert?.invoke()
            }
        }
        updateKeepAlive()
    }

    /** In the background, stay connected while something is still running; drop 30 s after the last run ends. */
    private fun updateKeepAlive() {
        val running = _inbox.value.sessions.count { it.status == "running" }
        val want = !foreground && running > 0
        if (want) {
            stopJob?.cancel()
            stopJob = null
            notifier?.keepAlive(running)
            keptAlive = true
        } else if (keptAlive) {
            notifier?.keepAlive(0)
            keptAlive = false
            if (!foreground) scheduleDisconnect()
        }
    }

    private fun scheduleDisconnect() {
        stopJob?.cancel()
        stopJob = scope.launch {
            delay(30_000)
            disconnect()
        }
    }

    /** Set by [dev.pi.remote.app.AppGraph]; receives our own uploads so they show without a download. */
    var attachmentStore: AttachmentStore? = null

    /** Uploads one prepared attachment; returns the host path the prompt should reference. */
    suspend fun upload(prepared: PreparedAttachment): Result<String> = runCatching {
        val a = api ?: error("offline")
        val data = withContext(Dispatchers.Default) { android.util.Base64.encodeToString(prepared.bytes, android.util.Base64.NO_WRAP) }
        a.upload(prepared.name, prepared.mime, data).path.also { path -> attachmentStore?.put(path, prepared.bytes) }
    }

    suspend fun downloadAttachment(path: String): ByteArray? {
        val a = api ?: return null
        val r = a.attachment(path)
        return withContext(Dispatchers.Default) { android.util.Base64.decode(r.data, android.util.Base64.NO_WRAP) }
    }
    suspend fun setThinking(key: String, level: String) = runCatching { api?.setThinking(key, level) }
    suspend fun capabilities(key: String): List<CapabilityRow> = runCatching { api?.capabilities(key) }.getOrNull().orEmpty()
    suspend fun setCapability(key: String, id: String, on: Boolean) = runCatching { api?.setCapability(key, id, on) ?: error("offline") }
    suspend fun cacheWarming(): String? = runCatching { api?.cacheWarming() }.getOrNull()
    suspend fun setCacheWarming(mode: String) = runCatching { api?.setCacheWarming(mode) }
    suspend fun toolDetail(key: String, toolCallId: String): ToolDetailResult? = runCatching { api?.toolDetail(key, toolCallId) }.getOrNull()
    suspend fun createSession(projectId: String, caps: List<String>?): String? = runCatching { api?.create(projectId, caps)?.sessionKey }.getOrNull()

    val canWrite: Boolean get() = (hello?.role ?: _active.value?.role) == "operator"

    /**
     * mermaid.min.js 从电脑取：优先走加密会话（`asset.get` 分块），经自建中转也能拿到；
     * 老电脑端没有这个方法时才退回原来的 HTTP 取法。落地后按 hello 里的 sha256 校验，坏的不落盘。
     */
    suspend fun mermaidScript(): File? = withContext(Dispatchers.IO) {
        val info = hello?.assets?.firstOrNull { it.name == MERMAID_ASSET } ?: return@withContext null
        val file = File(assetDir, "${info.sha256}.js")
        if (file.exists()) return@withContext file
        val bytes = fetchAssetOverSession(MERMAID_ASSET, info.size) ?: fetchAssetOverHttp(info)
        if (bytes == null) return@withContext null
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        if (!sha.equals(info.sha256, ignoreCase = true)) return@withContext null
        assetDir.mkdirs()
        // 先写临时文件再改名：中途断线不会留下半个脚本
        val tmp = File(assetDir, "${info.sha256}.part")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(file)) {
            tmp.delete()
            return@withContext null
        }
        file
    }

    /** 分块取回整个资源；任一块失败就返回 null（交给旧的 HTTP 兜底）。 */
    private suspend fun fetchAssetOverSession(name: String, expectedSize: Long): ByteArray? {
        val a = api ?: return null
        val out = java.io.ByteArrayOutputStream(expectedSize.toInt().coerceAtLeast(64 * 1024))
        var offset = 0
        while (true) {
            val chunk = runCatching { a.assetChunk(name, offset, ASSET_CHUNK) }.getOrNull() ?: return null
            val raw = runCatching { android.util.Base64.decode(chunk.data, android.util.Base64.DEFAULT) }.getOrNull() ?: return null
            out.write(raw)
            offset = chunk.offset + raw.size
            if (offset >= chunk.total || raw.isEmpty()) break
        }
        return out.toByteArray()
    }

    /** 老电脑端（没有 `asset.get`）的兜底：明文 HTTP 直取，拿到后同样按 sha256 校验。 */
    private fun fetchAssetOverHttp(info: dev.pi.remote.protocol.AssetInfo): ByteArray? {
        val endpoint = (conn?.state?.value as? HostConnection.State.Ready)?.endpoint ?: return null
        return runCatching {
            val u = URI(endpoint)
            URI("http", null, u.host, u.port, "/assets/${info.name}", null, null).toURL().openStream().use { it.readBytes() }
        }.getOrNull()
    }

}

/** 手机端唯一需要的静态资源（图表渲染）。 */
private const val MERMAID_ASSET = "mermaid.min.js"

/** 分块大小：和电脑端 `ASSET_CHUNK_MAX` 对齐。 */
private const val ASSET_CHUNK = 1024 * 1024
