package dev.pi.remote.app.ui.inbox

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.draw.rotate
import dev.pi.remote.app.data.LocalUiPrefs
import dev.pi.remote.app.data.UiPrefs
import dev.pi.remote.app.ui.Banner
import dev.pi.remote.app.ui.Segmented
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.InboxState
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.ConnectionBanner
import dev.pi.remote.app.ui.Dot
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.SectionLabel
import dev.pi.remote.app.ui.ShimmerText
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.countsLine
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.app.ui.useTicker
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.PullRefresh
import dev.pi.remote.app.ui.verbFor
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.SessionSummary
import dev.pi.remote.text.formatClock
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun InboxScreen(repo: RemoteRepository, onOpen: (String) -> Unit, onHosts: () -> Unit) {
    val inbox by repo.inbox.collectAsState()
    val active by repo.active.collectAsState()
    val connection by repo.connection.collectAsState()
    val prefs = LocalUiPrefs.current
    val scope = rememberCoroutineScope()
    var picking by remember { mutableStateOf(false) }
    var pickerOpen by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var pendingProject by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<dev.pi.remote.protocol.SessionSummary?>(null) }
    var hiddenSheet by remember { mutableStateOf(false) }
    val shared by repo.pendingShare.collectAsState()
    val canCreate = repo.canWrite && connection is HostConnection.State.Ready
    val latency by repo.latency.collectAsState()

    fun create(projectId: String) {
        if (pendingProject != null) return
        pendingProject = projectId
        prefs?.lastProject = projectId
        scope.launch {
            // Creating starts a pi worker on the desktop (cold start, ~seconds): show progress meanwhile.
            val key = repo.createSession(projectId, null)
            pendingProject = null
            picking = false
            pickerOpen = false
            if (key != null) onOpen(key)
        }
    }

    Column {
        if (shared != null) Banner(stringResource(R.string.share_pending), stringResource(R.string.share_discard)) { repo.takeShare() }
        InboxContent(
            hostName = active?.hostName.orEmpty(),
            connection = connection,
            inbox = inbox,
            canCreate = canCreate,
            onOpen = onOpen,
            onHosts = onHosts,
            onRetry = repo::retry,
            onNew = { picking = true },
            onNewIn = { create(it) },
            onAskDelete = { pendingDelete = it },
            onShowHidden = { hiddenSheet = true },
            latencyMs = latency,
            onHideProject = { project, hide ->
                scope.launch {
                    if (repo.setProjectHidden(project.id, hide)) repo.refreshInbox()
                }
            },
            onMenu = { menu = true },
            refreshing = refreshing,
            onRefresh = {
                if (!refreshing) scope.launch {
                    refreshing = true
                    val started = System.currentTimeMillis()
                    repo.refreshInbox()
                    // Let the ring turn at least once, so a fast reply does not read as a flicker.
                    delay((600 - (System.currentTimeMillis() - started)).coerceAtLeast(0))
                    refreshing = false
                }
            },
            modifier = Modifier.weight(1f),
        )
    }
    pendingDelete?.let { target ->
        PiSheet(onDismiss = { pendingDelete = null }) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 22.dp)) {
                Text(stringResource(R.string.session_delete_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg))
                Spacer(Modifier.height(6.dp))
                Text(target.title.ifEmpty { stringResource(R.string.session_untitled) }, style = Pi.t.secondary.copy(color = Pi.c.fg2), maxLines = 2)
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    QuietButton(stringResource(R.string.panel_cancel), { pendingDelete = null })
                    QuietButton(stringResource(R.string.session_delete_confirm), {
                        val key = target.sessionKey
                        pendingDelete = null
                        scope.launch { repo.deleteSession(key) }
                    }, color = Pi.c.bad)
                }
            }
        }
    }
    if (hiddenSheet) {
        PiSheet(onDismiss = { hiddenSheet = false }) {
            Column(Modifier.padding(bottom = 20.dp)) {
                Text(stringResource(R.string.inbox_hidden_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                val list = inbox.projects.filter { it.hidden && !it.temporary }
                if (list.isEmpty()) {
                    Text(stringResource(R.string.inbox_hidden_none), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                } else for (p in list) {
                    Row(Modifier.fillMaxWidth().heightIn(min = Pi.row).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(p.id, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        QuietButton(stringResource(R.string.inbox_unhide), {
                            scope.launch {
                                if (repo.setProjectHidden(p.id, false)) repo.refreshInbox()
                            }
                        }, icon = PiIcons.Eye)
                    }
                }
            }
        }
    }
    if (picking) {
        PiSheet(onDismiss = { picking = false }) {
            Column(Modifier.padding(bottom = 18.dp)) {
                Text(stringResource(R.string.new_session_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                // 项目不在列表里？直接去电脑上翻文件夹，选中就地建项目再开对话。
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { picking = false; pickerOpen = true }.padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PiIcon(PiIcons.Folder, Pi.c.blue, 16.dp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.picker_browse), style = Pi.t.body.copy(color = Pi.c.fg))
                        Text(stringResource(R.string.picker_browse_hint), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 2)
                    }
                    PiIcon(PiIcons.ChevronRight, Pi.c.fg3)
                }
                Hairline()
                SectionLabel(stringResource(R.string.new_session_pick))
                // New chats go to real projects; desktop temporary chats are one-offs.
                val last = prefs?.lastProject
                for (p in inbox.projects.filter { !it.temporary }.sortedByDescending { it.id == last }) {
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Button) { create(p.id) }.padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, style = Pi.t.body.copy(color = Pi.c.fg))
                            Text(p.id, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (pendingProject == p.id) Text(stringResource(R.string.creating), style = Pi.t.meta.copy(color = Pi.c.fg3))
                        else PiIcon(PiIcons.ChevronRight, Pi.c.fg3)
                    }
                }
            }
        }
    }
    if (pickerOpen) {
        ProjectPickerSheet(
            repo = repo,
            creating = pendingProject != null,
            onCreate = { create(it) },
            onDismiss = { pickerOpen = false },
        )
    }
    if (menu && prefs != null) InboxMenu(prefs, repo, onHosts = { menu = false; onHosts() }, onDismiss = { menu = false })
}

/** Theme, language and inbox grouping. */
@Composable
private fun InboxMenu(prefs: UiPrefs, repo: RemoteRepository, onHosts: () -> Unit, onDismiss: () -> Unit) {
    val theme by prefs.theme.collectAsState()
    val soundOn by (repo.soundAlerts?.enabled ?: remember { kotlinx.coroutines.flow.MutableStateFlow(false) }).collectAsState()
    val language by prefs.language.collectAsState()
    val activity = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity
    val grouping by prefs.grouping.collectAsState()
    PiSheet(onDismiss) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.menu_theme), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 6.dp))
            Segmented(listOf("system" to stringResource(R.string.theme_system), "light" to stringResource(R.string.theme_light), "dark" to stringResource(R.string.theme_dark)), theme, prefs::setTheme)
            Text(stringResource(R.string.menu_language), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 10.dp))
            // Language names stay in their own language.
            Segmented(listOf("system" to stringResource(R.string.theme_system), "en" to "English", "zh" to "简体中文"), language, onSelect = { if (prefs.setLanguage(it)) activity?.recreate() })
            Text(stringResource(R.string.menu_grouping), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 10.dp))
            Segmented(listOf("status" to stringResource(R.string.group_status), "project" to stringResource(R.string.group_project)), grouping, prefs::setGrouping)
            Text(stringResource(R.string.menu_sound_alerts), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(top = 10.dp))
            Segmented(
                listOf("on" to stringResource(R.string.sound_on), "off" to stringResource(R.string.sound_off)),
                if (soundOn) "on" else "off",
                onSelect = { repo.soundAlerts?.setEnabled(it == "on") },
            )
            Text(stringResource(R.string.menu_sound_hint), style = Pi.t.small.copy(color = Pi.c.fg3))
            Hairline(Modifier.padding(top = 10.dp))
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onHosts), verticalAlignment = Alignment.CenterVertically) {
                PiIcon(PiIcons.Monitor, Pi.c.fg2, 16.dp)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.inbox_hosts), style = Pi.t.body.copy(color = Pi.c.fg))
            }
        }
    }
}

private const val TEMPORARY = "__temporary__"

private fun dayBucket(ms: Long, now: Long): Int {
    val day = 86_400_000L
    val off = java.util.TimeZone.getDefault().getOffset(now).toLong()
    val diff = Math.floorDiv(now + off, day) - Math.floorDiv(ms + off, day)
    return when {
        diff <= 0 -> 0
        diff == 1L -> 1
        diff < 7 -> 2
        else -> 3
    }
}

/** Stateless inbox (also used by screenshot tests). */
@Composable
fun InboxContent(
    hostName: String,
    connection: HostConnection.State,
    inbox: InboxState,
    canCreate: Boolean,
    onOpen: (String) -> Unit,
    onHosts: () -> Unit,
    onRetry: () -> Unit,
    onNew: () -> Unit,
    onNewIn: ((String) -> Unit)? = null,
    onMenu: (() -> Unit)? = null,
    onHideProject: ((dev.pi.remote.protocol.ProjectInfo, Boolean) -> Unit)? = null,
    /** 心跳往返时间，用来在标题旁显示连接质量。 */
    latencyMs: Long? = null,
    /** 长按一行要删除：由外层弹二次确认（删了就没了，不能一手滑）。 */
    onAskDelete: ((dev.pi.remote.protocol.SessionSummary) -> Unit)? = null,
    /** 顶部眼睛：弹窗看已隐藏的项目。 */
    onShowHidden: () -> Unit = {},
    refreshing: Boolean = false,
    onRefresh: () -> Unit = {},
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    var query by rememberSaveable { mutableStateOf("") }
    var showHidden by rememberSaveable { mutableStateOf(false) }
    var statusFilter by rememberSaveable { mutableStateOf("all") }
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    val temporaryIds = inbox.projects.filter { it.temporary }.map { it.id }.toSet()
    // 和电脑侧栏同一份顺序：project.list 的顺序就是宿主顺序，这里不重排、也不按状态往顶上挪。
    val real = inbox.projects.filter { !it.temporary }
    val visible = real.filter { !it.hidden }
    val hidden = real.filter { it.hidden }
    val q = query.trim()
    val matches = { text: String -> q.isEmpty() || text.contains(q, ignoreCase = true) }
    val sessions = inbox.sessions
    val filteredSessions = sessions.filter { statusFilter == "all" || it.status == statusFilter }
    val shownProjects = visible.filter { project ->
        q.isEmpty() || matches(project.name) || filteredSessions.any { it.projectId == project.id && matches(it.title) }
    }
    val online = connection is HostConnection.State.Ready
    val now = useTicker(sessions.any { it.status == "running" })

    Column(modifier.background(Pi.c.bg)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(start = 12.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                Row(Modifier.clickable(role = Role.Button, onClick = onHosts).padding(horizontal = 6.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Dot(if (online) Pi.c.ok else Pi.c.fg3)
                    Spacer(Modifier.width(8.dp))
                    Text(hostName.ifEmpty { "pi" }, style = Pi.t.title.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    // 连接质量：在线时给心跳往返，掉了就靠下面的横幅说重连第几次
                    val ping = latencyMs
                    if (online && ping != null) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "${ping.coerceAtMost(9999)}ms",
                            style = Pi.t.meta.copy(color = if (ping < 120) Pi.c.ok else if (ping < 400) Pi.c.warn else Pi.c.bad),
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 12.dp)
                }
            }
            if (hidden.isNotEmpty()) {
                IconAction(PiIcons.Eye, stringResource(R.string.inbox_hidden_group, hidden.size), onShowHidden)
            }
            if (canCreate) IconAction(PiIcons.Plus, stringResource(R.string.inbox_new), onNew)
            onMenu?.let { IconAction(PiIcons.More, stringResource(R.string.more), it) }
        }
        ConnectionBanner(connection, onRetry)

        // 项目多的时候先搜：按项目名过滤，顺手也能搜会话标题
        Box(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                .clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 9.dp),
        ) {
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                cursorBrush = SolidColor(Pi.c.fg),
                decorationBox = { inner ->
                    if (query.isEmpty()) Text(stringResource(R.string.inbox_search), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    inner()
                },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            listOf("all" to R.string.inbox_filter_all, "needsInput" to R.string.inbox_filter_needs, "running" to R.string.inbox_filter_running, "failed" to R.string.inbox_filter_failed).forEach { (value, label) ->
                FilterTab(stringResource(label), statusFilter == value) { statusFilter = value }
            }
        }

        PullRefresh(refreshing, onRefresh, Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize()) {
                if (inbox.projects.isEmpty() && !inbox.loaded) {
                    item("empty") {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            if (online) Spinner(Pi.c.fg3, 18.dp) else Text(stringResource(R.string.inbox_empty), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                        }
                    }
                    return@LazyColumn
                }
                if (statusFilter != "all" && filteredSessions.none { session ->
                    val project = visible.firstOrNull { it.id == session.projectId }
                    (session.projectId in temporaryIds && matches(session.title)) || (project != null && (matches(project.name) || matches(session.title)))
                }) {
                    item("no-status-match") { SectionLabel(stringResource(R.string.inbox_filter_empty)) }
                }
                if (shownProjects.isEmpty() && q.isNotEmpty()) {
                    item("no-match") { SectionLabel(stringResource(R.string.inbox_no_project_match)) }
                }
                for (p in shownProjects) {
                    val list = filteredSessions
                        .filter { it.projectId == p.id && (matches(p.name) || matches(it.title)) }
                        .sortedByDescending { it.updatedAt }
                    if (statusFilter != "all" && list.isEmpty()) continue
                    val closed = statusFilter == "all" && q.isEmpty() && collapsed[p.id] == true
                    item("p-${p.id}") {
                        ProjectHeader(
                            name = p.name,
                            count = list.size,
                            closed = closed,
                            onToggle = { collapsed[p.id] = !closed },
                            onNew = if (canCreate && onNewIn != null) ({ onNewIn(p.id) }) else null,
                            onHide = onHideProject?.let { hide -> { hide(p, true) } },
                        )
                    }
                    if (!closed) {
                        if (list.isEmpty()) {
                            item("e-${p.id}") {
                                Text(
                                    stringResource(R.string.inbox_project_empty),
                                    style = Pi.t.meta.copy(color = Pi.c.fg3),
                                    modifier = Modifier.padding(start = 44.dp, end = 18.dp, top = 6.dp, bottom = 6.dp),
                                )
                            }
                        }
                        items(list, key = { it.sessionKey }) { SessionRow(it, now, onOpen, showProject = false, onLongPress = onAskDelete?.let { ask -> { ask(it) } }, modifier = Modifier.animateItem()) }
                    }
                }

                // 电脑上隐藏的项目照样同步过来：折在最后，点眼睛就能恢复
                if (hidden.isNotEmpty()) {
                    val open = showHidden
                    item("h-hidden") {
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button) { showHidden = !open }
                                .heightIn(min = 40.dp).padding(start = 18.dp, end = 18.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            PiIcon(PiIcons.Eye, Pi.c.fg3, 14.dp)
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.inbox_hidden_group, hidden.size), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
                            PiIcon(PiIcons.ChevronDown, Pi.c.fg3, 12.dp, Modifier.rotate(if (open) 180f else 0f))
                        }
                    }
                    if (open) {
                        items(hidden, key = { "hidden-${it.id}" }) { p ->
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = Pi.row).padding(horizontal = 18.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(p.name, style = Pi.t.secondary.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                IconAction(PiIcons.Eye, stringResource(R.string.inbox_unhide), { onHideProject?.invoke(p, false) }, tint = Pi.c.fg3, size = 16.dp)
                            }
                        }
                    }
                }

                val temp = filteredSessions.filter { it.projectId in temporaryIds && matches(it.title) }.sortedByDescending { it.updatedAt }
                if (temp.isNotEmpty()) {
                    val closed = statusFilter == "all" && q.isEmpty() && (collapsed[TEMPORARY] ?: true)
                    item("p-temp") {
                        ProjectHeader(
                            name = stringResource(R.string.temporary_chats),
                            count = temp.size,
                            closed = closed,
                            onToggle = { collapsed[TEMPORARY] = !closed },
                            onNew = null,
                            onHide = null,
                        )
                    }
                    if (!closed) items(temp, key = { it.sessionKey }) { SessionRow(it, now, onOpen, showProject = false, onLongPress = onAskDelete?.let { ask -> { ask(it) } }, modifier = Modifier.animateItem()) }
                }
                if (inbox.projects.isNotEmpty() && sessions.isEmpty()) {
                    item("no-sessions") { SectionLabel(stringResource(R.string.inbox_empty)) }
                }
                item("bottom") { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun ProjectHeader(
    name: String,
    count: Int,
    closed: Boolean,
    onToggle: () -> Unit,
    onNew: (() -> Unit)?,
    onHide: (() -> Unit)? = null,
) {
    val angle by animateFloatAsState(if (closed) 0f else 90f, label = "group")
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(start = 18.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        // 只有左边这块负责展开/收起，右侧的眼睛/加号各自独立可点（之前会被整行点击吞掉）。
        Row(
            Modifier.weight(1f).heightIn(min = 40.dp).clickable(role = Role.Button, onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 12.dp, Modifier.rotate(angle))
            Spacer(Modifier.width(8.dp))
            Text(name, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(6.dp))
            Text("$count", style = Pi.t.meta.copy(color = Pi.c.fg3))
        }
        onNew?.let { IconAction(PiIcons.Plus, stringResource(R.string.inbox_new), it, tint = Pi.c.fg3, size = 16.dp) }
        onHide?.let { IconAction(PiIcons.Eye, stringResource(R.string.inbox_hide), it, tint = Pi.c.fg3, size = 16.dp) }
    }
}

@Composable
private fun FilterTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Column(Modifier.clickable(role = Role.Tab, onClick = onClick).padding(top = 10.dp)) {
        Text(label, style = Pi.t.secondary.copy(color = if (selected) Pi.c.fg else Pi.c.fg3))
        Spacer(Modifier.height(9.dp))
        Box(Modifier.height(1.5.dp).width(if (selected) 24.dp else 0.dp).background(Pi.c.fg))
    }
}

@Composable
private fun SessionRow(
    s: SessionSummary,
    now: Long,
    onOpen: (String) -> Unit,
    showProject: Boolean = true,
    onLongPress: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val temporaryLabel = stringResource(R.string.temporary_chats)
    // animateItem() 由调用方的 LazyColumn 提供：新跑起来的会话、状态变化会平滑滑入而不是跳一下
    // 左滑露出「删除」：一次手势就到确认，不用先长按再翻面板。
    val swipe = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) {
                onLongPress?.invoke()
            }
            false // 不真的抽走行：交给确认弹窗，取消就弹回来
        },
    )
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromStartToEnd = false,
        enableDismissFromEndToStart = onLongPress != null,
        backgroundContent = {
            Box(
                Modifier.fillMaxSize().background(Pi.c.bad.copy(alpha = 0.10f)).padding(end = 22.dp),
                contentAlignment = Alignment.CenterEnd,
            ) { PiIcon(PiIcons.Trash, Pi.c.bad, 16.dp) }
        },
        modifier = modifier,
    ) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = Pi.row).background(Pi.c.bg)
            .combinedClickable(
                role = Role.Button,
                onClick = { onOpen(s.sessionKey) },
                onLongClick = onLongPress,
            )
            .padding(horizontal = 18.dp, vertical = 11.dp),
    ) {
        Box(Modifier.width(14.dp).padding(top = 3.dp), contentAlignment = Alignment.TopCenter) {
            when (s.status) {
                "needsInput" -> PiIcon(PiIcons.Question, Pi.c.warn, 14.dp)
                "failed" -> PiIcon(PiIcons.Alert, Pi.c.bad, 14.dp)
                "running" -> Spinner(Pi.c.blue, 14.dp)
                else -> Unit
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(s.title.ifEmpty { stringResource(R.string.session_untitled) }, style = Pi.t.bodyMedium.copy(color = if (s.status == "idle") Pi.c.fg2 else Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(10.dp))
                val right = if (s.status == "running" && s.startedAt != null) formatClock(now - s.startedAt!!) else formatAgo(s.updatedAt, now)
                Text(right, style = Pi.t.meta.copy(color = Pi.c.fg3))
            }
            when (s.status) {
                "running" -> {
                    val live = s.live?.takeIf { it.isNotEmpty() }?.let { "${s.liveCategory?.let { c -> verbFor(c) } ?: ""} $it".trim() } ?: "Thinking"
                    ShimmerText(live, Pi.t.secondary)
                }
                "needsInput" -> Text(listOfNotNull(stringResource(R.string.status_needs), s.preview?.takeIf { it.isNotBlank() }).joinToString("："), style = Pi.t.secondary.copy(color = Pi.c.warn), maxLines = 1, overflow = TextOverflow.Ellipsis)
                "failed" -> Text(listOfNotNull(stringResource(R.string.inbox_filter_failed), s.preview?.takeIf { it.isNotBlank() }).joinToString("："), style = Pi.t.secondary.copy(color = Pi.c.bad), maxLines = 1, overflow = TextOverflow.Ellipsis)
                else -> s.preview?.let { Text(it, style = Pi.t.secondary.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            val project = when {
                !showProject -> ""
                s.projectId.replace('\\', '/').contains("/sandbox-workspaces/") -> temporaryLabel
                else -> s.projectId.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\')
            }
            val counts = s.counts?.let { countsLine(it) }.orEmpty()
            Text(listOf(project, counts).filter { it.isNotEmpty() }.joinToString(" · "), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    }
}
