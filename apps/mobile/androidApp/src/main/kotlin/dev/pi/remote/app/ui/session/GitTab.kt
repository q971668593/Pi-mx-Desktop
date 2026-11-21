package dev.pi.remote.app.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pi.remote.R
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.SectionLabel
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.protocol.DiffLine
import dev.pi.remote.protocol.Empty
import dev.pi.remote.protocol.GitBranchRef
import dev.pi.remote.protocol.GitChange
import dev.pi.remote.protocol.GitCloneResult
import dev.pi.remote.protocol.GitCommandEntry
import dev.pi.remote.protocol.GitCommandLog
import dev.pi.remote.protocol.GitCommit
import dev.pi.remote.protocol.GitCommitDetail
import dev.pi.remote.protocol.GitCommitResult
import dev.pi.remote.protocol.GitFileDiff
import dev.pi.remote.protocol.GitGraphCommit
import dev.pi.remote.protocol.GitOverview
import dev.pi.remote.protocol.GitParams
import dev.pi.remote.protocol.GitStash
import dev.pi.remote.protocol.GitStashList
import dev.pi.remote.protocol.GitSuggestResult
import dev.pi.remote.protocol.GitSyncResult
import dev.pi.remote.protocol.GitTagList
import dev.pi.remote.protocol.GitWorktree
import dev.pi.remote.protocol.GitWorktreeList
import kotlinx.coroutines.launch

private val GIT_TABS = listOf("changes", "graph", "branches", "log", "more")

/** 面板里弹出的东西：动作表、单文件 diff、提交详情、输入框、确认框。 */
private sealed interface GitSheet {
    data class Actions(val title: String, val meta: String?, val items: List<Pair<String, () -> Unit>>) : GitSheet
    data class Diff(val title: String, val path: String, val staged: Boolean, val commit: String?) : GitSheet
    data class Commit(val ref: String) : GitSheet
    data class Prompt(val title: String, val hint: String?, val initial: String, val confirm: String, val onDone: (String) -> Unit) : GitSheet
    data class Confirm(val title: String, val message: String, val confirm: String, val onYes: () -> Unit) : GitSheet
}

private typealias Run = (suspend () -> Unit) -> Unit

/**
 * 手机端 Git 面板：电脑端「更改 / 图谱 / 分支 / 命令记录 / 更多」整套搬过来。
 * 每个动作都打网关的 `git.*` 方法，真正干活的是电脑端 gitBoard handler，两边行为一致。
 */
@Composable
fun GitPanel(repo: RemoteRepository, sessionKey: String, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    var overview by remember { mutableStateOf<GitOverview?>(null) }
    // 电脑端还是老网关（没有 git.overview）时退回旧视图：至少能看到提交记录。
    var legacyCommits by remember { mutableStateOf<List<GitCommit>?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf("changes") }
    var message by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var sheet by remember { mutableStateOf<GitSheet?>(null) }
    var tick by remember { mutableStateOf(0) }

    suspend fun load() {
        loading = true
        val r = repo.gitOverview(sessionKey, query = query.ifBlank { null })
        if (r.isSuccess) {
            overview = r.getOrNull()
            legacyCommits = null
            failure = null
        } else {
            failure = r.exceptionOrNull()?.message
            legacyCommits = repo.gitLog(sessionKey, 30).getOrNull()?.commits
        }
        loading = false
    }

    val act: Run = { run ->
        if (!busy) scope.launch {
            busy = true
            failure = null
            val r = runCatching { run() }
            busy = false
            if (r.isFailure) failure = r.exceptionOrNull()?.message
            load()
        }
    }

    suspend fun sync(action: String) {
        repo.gitCall("git.sync", GitParams(sessionKey, action = action), GitSyncResult.serializer(), 180_000)
    }

    LaunchedEffect(sessionKey, tick) { load() }

    val data = overview
    Column(modifier.fillMaxWidth()) {
        GitHeader(
            data = data,
            busy = busy,
            onFetch = { act { sync("fetch") } },
            onPull = { act { sync("pull") } },
            onPush = { act { sync("push") } },
            onRefresh = { tick += 1 },
        )
        data?.operation?.let { op ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.git_operation_running, op), style = Pi.t.meta.copy(color = Pi.c.warn), modifier = Modifier.weight(1f))
                QuietButton(stringResource(R.string.git_continue), {
                    act { repo.gitCall("git.operation", GitParams(sessionKey, operation = op, action = "continue"), Empty.serializer()) }
                })
                Spacer(Modifier.width(6.dp))
                QuietButton(stringResource(R.string.git_abort), {
                    act { repo.gitCall("git.operation", GitParams(sessionKey, operation = op, action = "abort"), Empty.serializer()) }
                }, color = Pi.c.bad)
            }
        }
        failure?.let { Text(stringResource(R.string.git_action_failed, it), style = Pi.t.meta.copy(color = Pi.c.bad), modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) }

        when {
            data == null && legacyCommits != null -> {
                Text(stringResource(R.string.git_need_desktop), style = Pi.t.meta.copy(color = Pi.c.warn), modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
                LegacyCommitList(legacyCommits.orEmpty())
            }
            data == null -> Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
            !data.isRepo -> Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.git_not_repo), style = Pi.t.meta.copy(color = Pi.c.fg3))
                QuietButton(stringResource(R.string.git_init), {
                    act { repo.gitCall("git.init", GitParams(sessionKey), Empty.serializer()) }
                }, icon = PiIcons.Plus)
            }
            else -> {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (key in GIT_TABS) {
                        val selected = tab == key
                        val label = when (key) {
                            "changes" -> stringResource(R.string.git_tab_changes) + if (data.files.isNotEmpty()) " ${data.files.size}" else ""
                            "graph" -> stringResource(R.string.git_tab_graph)
                            "branches" -> stringResource(R.string.git_tab_branches)
                            "log" -> stringResource(R.string.git_tab_log)
                            else -> stringResource(R.string.git_tab_more)
                        }
                        Box(
                            Modifier.clip(RoundedCornerShape(Pi.radius)).background(if (selected) Pi.c.surface else Color.Transparent)
                                .clickable(role = Role.Tab) { tab = key }.padding(horizontal = 10.dp, vertical = 6.dp),
                        ) { Text(label, style = Pi.t.meta.copy(color = if (selected) Pi.c.fg else Pi.c.fg3)) }
                    }
                }
                Spacer(Modifier.height(4.dp))
                Hairline()
                when (tab) {
                    "changes" -> ChangesTab(data, repo, sessionKey, message, { message = it }, busy, act) { sheet = it }
                    "graph" -> GraphTab(data, repo, sessionKey, query, { query = it }, { tick += 1 }, busy, act) { sheet = it }
                    "branches" -> BranchesTab(data, repo, sessionKey, busy, act) { sheet = it }
                    "log" -> CommandLogTab(repo, sessionKey, loading)
                    else -> MoreTab(data, repo, sessionKey, busy, act) { sheet = it }
                }
            }
        }
    }

    when (val open = sheet) {
        null -> Unit
        is GitSheet.Actions -> PiSheet(onDismiss = { sheet = null }) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                Text(
                    open.title,
                    style = Pi.t.bodyMedium.copy(color = Pi.c.fg),
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                open.meta?.let {
                    Text(it, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 20.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(10.dp))
                Hairline()
                for ((label, action) in open.items) {
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Button) { sheet = null; action() }.padding(horizontal = 20.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) { Text(label, style = Pi.t.bodyMedium.copy(color = Pi.c.fg)) }
                    Hairline()
                }
            }
        }
        is GitSheet.Diff -> GitDiffSheet(repo, sessionKey, open, onClose = { sheet = null })
        is GitSheet.Commit -> GitCommitSheet(repo, sessionKey, open.ref, onClose = { sheet = null }) { sheet = it }
        is GitSheet.Prompt -> GitPromptSheet(open, onClose = { sheet = null })
        is GitSheet.Confirm -> PiSheet(onDismiss = { sheet = null }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(open.title, style = Pi.t.bodyMedium.copy(color = Pi.c.fg))
                Text(open.message, style = Pi.t.secondary.copy(color = Pi.c.fg2))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    QuietButton(stringResource(R.string.cancel), { sheet = null })
                    Spacer(Modifier.width(8.dp))
                    QuietButton(open.confirm, { sheet = null; open.onYes() }, color = Pi.c.bad)
                }
            }
        }
    }
}

/** 老网关（只有 `git.log`）的兜底列表。 */
@Composable
private fun LegacyCommitList(commits: List<GitCommit>) {
    if (commits.isEmpty()) {
        Text(stringResource(R.string.git_empty), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
        return
    }
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
        items(commits, key = { it.sha }) { commit ->
            CommitRow(
                GitGraphCommit(
                    hash = commit.sha,
                    short = commit.short,
                    parents = emptyList(),
                    author = commit.author,
                    email = "",
                    time = commit.at / 1000,
                    subject = commit.subject,
                    decorations = commit.refs?.joinToString(", ").orEmpty(),
                ),
            ) {}
        }
    }
}

@Composable
private fun GitHeader(data: GitOverview?, busy: Boolean, onFetch: () -> Unit, onPull: () -> Unit, onPush: () -> Unit, onRefresh: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PiIcon(PiIcons.Branch, Pi.c.fg3, 14.dp)
            Spacer(Modifier.width(8.dp))
            Text(
                data?.branch?.ifEmpty { "—" } ?: "—",
                style = Pi.t.bodyMedium.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (busy) Spinner(Pi.c.fg3, 14.dp) else QuietButton(stringResource(R.string.git_refresh), onRefresh)
        }
        val up = data?.upstream
        Text(
            when {
                data == null -> ""
                data.branch.isEmpty() -> stringResource(R.string.git_detached)
                up == null -> stringResource(R.string.git_no_upstream)
                else -> "$up · ↑${data.ahead} ↓${data.behind}"
            },
            style = Pi.t.meta.copy(color = Pi.c.fg3),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 2.dp),
        )
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QuietButton(stringResource(R.string.git_fetch), onFetch)
            QuietButton(stringResource(R.string.git_pull), onPull)
            QuietButton(stringResource(R.string.git_push), onPush)
        }
    }
    Hairline()
}

@Composable
private fun ChangesTab(
    data: GitOverview,
    repo: RemoteRepository,
    sessionKey: String,
    message: String,
    onMessage: (String) -> Unit,
    busy: Boolean,
    act: Run,
    openSheet: (GitSheet) -> Unit,
) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
            Box(Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface).padding(10.dp)) {
                BasicTextField(
                    value = message,
                    onValueChange = onMessage,
                    textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                    cursorBrush = SolidColor(Pi.c.fg),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
                )
                if (message.isEmpty()) Text(stringResource(R.string.git_commit_hint), style = Pi.t.secondary.copy(color = Pi.c.fg3))
            }
            Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                QuietButton(stringResource(R.string.git_suggest), {
                    act {
                        val r = repo.gitCall("git.suggestCommit", GitParams(sessionKey), GitSuggestResult.serializer(), 120_000)
                        r.getOrNull()?.message?.let(onMessage)
                        r.map { }
                    }
                }, icon = PiIcons.Sparkles, enabled = !busy)
                Spacer(Modifier.weight(1f))
                QuietButton(stringResource(R.string.git_commit), {
                    act {
                        repo.gitCall(
                            "git.commit",
                            GitParams(sessionKey, message = message.trim(), action = if (data.files.none { it.group == "staged" }) "stage-and-commit" else "commit"),
                            GitCommitResult.serializer(),
                        )
                    }
                    onMessage("")
                }, enabled = message.isNotBlank() && !busy)
                Spacer(Modifier.width(6.dp))
                QuietButton(stringResource(R.string.git_commit_push), {
                    act {
                        repo.gitCall("git.commit", GitParams(sessionKey, message = message.trim(), action = "commit-and-push"), GitCommitResult.serializer(), 180_000)
                    }
                    onMessage("")
                }, enabled = message.isNotBlank() && !busy)
            }
        }
        Hairline()
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.git_changes, data.branch.ifEmpty { "—" }, data.files.size),
                style = Pi.t.meta.copy(color = Pi.c.fg3),
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (data.files.isNotEmpty()) {
                QuietButton(stringResource(R.string.git_stage_all), {
                    act { repo.gitCall("git.stageAll", GitParams(sessionKey), Empty.serializer()) }
                }, enabled = !busy)
                Spacer(Modifier.width(6.dp))
                QuietButton(stringResource(R.string.git_unstage_all), {
                    act { repo.gitCall("git.unstageAll", GitParams(sessionKey), Empty.serializer()) }
                }, enabled = !busy)
            }
        }
        if (data.files.isEmpty()) {
            Text(stringResource(R.string.git_no_changes), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
            return@Column
        }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
            changeGroup(data.files, "conflict", ctx.getString(R.string.git_group_conflict), repo, sessionKey, act, openSheet)
            changeGroup(data.files, "staged", ctx.getString(R.string.git_group_staged), repo, sessionKey, act, openSheet)
            changeGroup(data.files, "unstaged", ctx.getString(R.string.git_group_unstaged), repo, sessionKey, act, openSheet)
            changeGroup(data.files, "untracked", ctx.getString(R.string.git_group_untracked), repo, sessionKey, act, openSheet)
        }
    }
}

private fun LazyListScope.changeGroup(
    files: List<GitChange>,
    groupKey: String,
    title: String,
    repo: RemoteRepository,
    sessionKey: String,
    act: Run,
    openSheet: (GitSheet) -> Unit,
) {
    val rows = files.filter { it.group == groupKey }
    if (rows.isEmpty()) return
    item("head-$groupKey") { SectionLabel("$title · ${rows.size}", Modifier.padding(start = 14.dp, top = 8.dp, bottom = 2.dp)) }
    items(rows, key = { "$groupKey:${it.path}" }) { file -> ChangeRow(file, repo, sessionKey, act, openSheet) }
}

@Composable
private fun ChangeRow(file: GitChange, repo: RemoteRepository, sessionKey: String, act: Run, openSheet: (GitSheet) -> Unit) {
    val ctx = LocalContext.current
    val staged = file.group == "staged"
    val conflict = file.group == "conflict"
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) {
            val items = buildList {
                add(ctx.getString(R.string.git_view_diff) to { openSheet(GitSheet.Diff(file.path.substringAfterLast('/'), file.path, staged, null)) })
                if (staged) add(ctx.getString(R.string.git_unstage) to { act { repo.gitCall("git.unstage", GitParams(sessionKey, paths = listOf(file.path)), Empty.serializer()) } })
                else add(ctx.getString(R.string.git_stage) to { act { repo.gitCall("git.stage", GitParams(sessionKey, paths = listOf(file.path)), Empty.serializer()) } })
                if (conflict) {
                    add(ctx.getString(R.string.git_take_ours) to { act { repo.gitCall("git.resolve", GitParams(sessionKey, paths = listOf(file.path), side = "ours"), Empty.serializer()) } })
                    add(ctx.getString(R.string.git_take_theirs) to { act { repo.gitCall("git.resolve", GitParams(sessionKey, paths = listOf(file.path), side = "theirs"), Empty.serializer()) } })
                }
                add(ctx.getString(R.string.git_ignore) to { act { repo.gitCall("git.exclude", GitParams(sessionKey, paths = listOf(file.path)), Empty.serializer()) } })
                add(ctx.getString(R.string.git_discard) to {
                    openSheet(
                        GitSheet.Confirm(
                            title = file.path,
                            message = ctx.getString(R.string.git_discard_confirm, file.path),
                            confirm = ctx.getString(R.string.git_discard),
                            onYes = {
                                act {
                                    if (file.group == "untracked") repo.gitCall("git.discard", GitParams(sessionKey, untracked = listOf(file.path)), Empty.serializer())
                                    else repo.gitCall("git.discard", GitParams(sessionKey, tracked = listOf(file.path)), Empty.serializer())
                                }
                            },
                        ),
                    )
                })
            }
            openSheet(GitSheet.Actions(file.path, null, items))
        }.padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            (if (staged) file.staged else file.unstaged).ifBlank { "·" },
            style = Pi.t.meta.copy(color = if (conflict) Pi.c.bad else Pi.c.fg3, fontFamily = FontFamily.Monospace),
            modifier = Modifier.width(18.dp),
        )
        Text(file.path, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 12.dp)
    }
    Hairline()
}

@Composable
private fun GraphTab(
    data: GitOverview,
    repo: RemoteRepository,
    sessionKey: String,
    query: String,
    onQuery: (String) -> Unit,
    onFilter: () -> Unit,
    busy: Boolean,
    act: Run,
    openSheet: (GitSheet) -> Unit,
) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).heightIn(min = 34.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface).padding(horizontal = 10.dp, vertical = 8.dp)) {
                BasicTextField(
                    value = query,
                    onValueChange = onQuery,
                    textStyle = Pi.t.meta.copy(color = Pi.c.fg),
                    cursorBrush = SolidColor(Pi.c.fg),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (query.isEmpty()) Text(stringResource(R.string.git_search_commit), style = Pi.t.meta.copy(color = Pi.c.fg3))
            }
            Spacer(Modifier.width(8.dp))
            QuietButton(stringResource(R.string.git_filter), onFilter, enabled = !busy)
        }
        Hairline()
        if (data.commits.isEmpty()) {
            Text(stringResource(R.string.git_empty), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
            return@Column
        }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
            items(data.commits, key = { it.hash }) { commit ->
                val commitMeta = "${commit.short} · ${commit.author} · ${formatAgo(commit.time * 1000)}"
                CommitRow(commit) {
                    openSheet(
                        GitSheet.Actions(
                            title = commit.subject,
                            meta = commitMeta,
                            items = listOf(
                                ctx.getString(R.string.git_view_commit) to { openSheet(GitSheet.Commit(commit.hash)) },
                                ctx.getString(R.string.git_checkout_commit) to {
                                    act { repo.gitCall("git.checkoutCommit", GitParams(sessionKey, ref = commit.hash), Empty.serializer()) }
                                },
                                ctx.getString(R.string.git_reset_here) to {
                                    openSheet(
                                        GitSheet.Actions(
                                            ctx.getString(R.string.git_reset_here),
                                            commit.short,
                                            listOf(
                                                ctx.getString(R.string.git_reset_soft) to { act { repo.gitCall("git.reset", GitParams(sessionKey, hash = commit.hash, mode = "soft"), Empty.serializer()) } },
                                                ctx.getString(R.string.git_reset_mixed) to { act { repo.gitCall("git.reset", GitParams(sessionKey, hash = commit.hash, mode = "mixed"), Empty.serializer()) } },
                                                ctx.getString(R.string.git_reset_hard) to { act { repo.gitCall("git.reset", GitParams(sessionKey, hash = commit.hash, mode = "hard"), Empty.serializer()) } },
                                            ),
                                        ),
                                    )
                                },
                            ),
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun CommitRow(commit: GitGraphCommit, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PiIcon(PiIcons.Fork, Pi.c.fg3, 13.dp)
            Spacer(Modifier.width(8.dp))
            Text(commit.subject, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
        Row(Modifier.padding(start = 21.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(commit.short, style = Pi.t.meta.copy(color = Pi.c.blue, fontFamily = FontFamily.Monospace))
            Spacer(Modifier.width(8.dp))
            Text("${commit.author} · ${formatAgo(commit.time * 1000)}", style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (commit.decorations.isNotBlank()) {
            Text(commit.decorations, style = Pi.t.meta.copy(color = Pi.c.s2), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 21.dp, top = 2.dp))
        }
    }
    Hairline()
}

@Composable
private fun BranchesTab(
    data: GitOverview,
    repo: RemoteRepository,
    sessionKey: String,
    busy: Boolean,
    act: Run,
    openSheet: (GitSheet) -> Unit,
) {
    val ctx = LocalContext.current
    val locals = data.branches.filter { it.kind == "local" }
    val remotes = data.branches.filter { it.kind == "remote" }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.git_local), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
            val newBranchTitle = stringResource(R.string.git_new_branch)
            val branchNameLabel = stringResource(R.string.git_branch_name)
            val createLabel = stringResource(R.string.create)
            QuietButton(newBranchTitle, {
                openSheet(
                    GitSheet.Prompt(newBranchTitle, branchNameLabel, "", createLabel) { name ->
                        if (name.isNotBlank()) act { repo.gitCall("git.branch", GitParams(sessionKey, action = "create", name = name.trim()), Empty.serializer()) }
                    },
                )
            }, icon = PiIcons.Plus, enabled = !busy)
        }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
            items(locals, key = { "l:${it.name}" }) { branch ->
                BranchRow(branch) {
                    openSheet(GitSheet.Actions(branch.name, branch.subject, branchActions({ id -> ctx.getString(id) }, branch, repo, sessionKey, act, openSheet)))
                }
            }
            if (remotes.isNotEmpty()) {
                item("remote-head") { SectionLabel(stringResource(R.string.git_remote), Modifier.padding(start = 14.dp, top = 10.dp, bottom = 2.dp)) }
                items(remotes, key = { "r:${it.name}" }) { branch ->
                    BranchRow(branch) {
                        openSheet(
                            GitSheet.Actions(
                                branch.name,
                                branch.subject,
                                listOf(
                                    ctx.getString(R.string.git_track) to {
                                        act { repo.gitCall("git.branch", GitParams(sessionKey, action = "track", name = branch.name.substringAfter('/'), from = branch.name), Empty.serializer()) }
                                    },
                                    ctx.getString(R.string.git_merge) to { act { repo.gitCall("git.merge", GitParams(sessionKey, ref = branch.name), Empty.serializer()) } },
                                    ctx.getString(R.string.git_rebase) to { act { repo.gitCall("git.rebase", GitParams(sessionKey, ref = branch.name), Empty.serializer()) } },
                                ),
                            ),
                        )
                    }
                }
            }
        }
    }
}

private fun branchActions(
    getString: (Int) -> String,
    branch: GitBranchRef,
    repo: RemoteRepository,
    sessionKey: String,
    act: Run,
    openSheet: (GitSheet) -> Unit,
): List<Pair<String, () -> Unit>> = buildList {
    if (!branch.current) {
        add(getString(R.string.git_switch) to { act { repo.gitCall("git.branch", GitParams(sessionKey, action = "checkout", name = branch.name), Empty.serializer()) } })
        add(getString(R.string.git_merge) to { act { repo.gitCall("git.merge", GitParams(sessionKey, ref = branch.name), Empty.serializer()) } })
        add(getString(R.string.git_rebase) to { act { repo.gitCall("git.rebase", GitParams(sessionKey, ref = branch.name), Empty.serializer()) } })
        add(getString(R.string.git_cherry_pick) to { act { repo.gitCall("git.cherryPick", GitParams(sessionKey, ref = branch.name), Empty.serializer()) } })
    }
    add(getString(R.string.git_rename) to {
        openSheet(
            GitSheet.Prompt(getString(R.string.git_rename), branch.name, branch.name, getString(R.string.git_rename)) { next ->
                if (next.isNotBlank()) act {
                    repo.gitCall("git.branch", GitParams(sessionKey, action = "rename", name = next.trim(), from = branch.name), Empty.serializer())
                }
            },
        )
    })
    if (!branch.current) {
        add(getString(R.string.git_delete) to {
            openSheet(
                GitSheet.Confirm(getString(R.string.git_delete), getString(R.string.git_delete_confirm).replace("%1\$s", branch.name), getString(R.string.git_delete), {
                    act { repo.gitCall("git.branch", GitParams(sessionKey, action = "delete", name = branch.name), Empty.serializer()) }
                }),
            )
        })
    }
}

@Composable
private fun BranchRow(branch: GitBranchRef, onTap: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onTap).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PiIcon(if (branch.current) PiIcons.Check else PiIcons.Branch, if (branch.current) Pi.c.ok else Pi.c.fg3, 13.dp)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(branch.name, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (branch.subject.isNotBlank()) {
                Text(branch.subject, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (branch.ahead > 0 || branch.behind > 0) {
            Text("↑${branch.ahead} ↓${branch.behind}", style = Pi.t.meta.copy(color = Pi.c.fg3))
            Spacer(Modifier.width(8.dp))
        }
        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 12.dp)
    }
    Hairline()
}

@Composable
private fun CommandLogTab(repo: RemoteRepository, sessionKey: String, loading: Boolean) {
    var entries by remember { mutableStateOf<List<GitCommandEntry>?>(null) }
    var tick by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(sessionKey, tick) {
        busy = true
        val r = repo.gitCall("git.commandLog", GitParams(sessionKey, limit = 100), GitCommandLog.serializer())
        entries = r.getOrNull()?.entries
        failed = r.isFailure
        busy = false
    }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.git_tab_log), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
            QuietButton(stringResource(R.string.git_refresh), { tick += 1 }, enabled = !busy)
            Spacer(Modifier.width(6.dp))
            QuietButton(stringResource(R.string.git_clear), {
                scope.launch {
                    repo.gitCall("git.clearCommandLog", GitParams(sessionKey), Empty.serializer())
                    tick += 1
                }
            }, enabled = !busy)
        }
        Hairline()
        val list = entries
        when {
            list == null -> Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) {
                if (loading || busy) Spinner(Pi.c.fg3, 16.dp) else Text(stringResource(R.string.git_failed, ""), style = Pi.t.meta.copy(color = Pi.c.fg3))
            }
            failed -> Text(stringResource(R.string.git_failed, ""), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
            list.isEmpty() -> Text(stringResource(R.string.git_command_history_empty), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
            else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
                items(list, key = { "${it.time}:${it.command}" }) { entry ->
                    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(if (entry.success) "✓" else "✕", style = Pi.t.meta.copy(color = if (entry.success) Pi.c.ok else Pi.c.bad))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                entry.command,
                                style = Pi.t.meta.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        Row(Modifier.padding(start = 20.dp, top = 2.dp)) {
                            Text(formatAgo(entry.time * 1000), style = Pi.t.meta.copy(color = Pi.c.fg3))
                            if (entry.output.isNotBlank()) {
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    entry.output.lineSequence().firstOrNull().orEmpty(),
                                    style = Pi.t.meta.copy(color = Pi.c.fg3),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    Hairline()
                }
            }
        }
    }
}

@Composable
private fun MoreTab(
    data: GitOverview,
    repo: RemoteRepository,
    sessionKey: String,
    busy: Boolean,
    act: Run,
    openSheet: (GitSheet) -> Unit,
) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        SectionLabel(stringResource(R.string.git_remotes), Modifier.padding(start = 14.dp, top = 10.dp))
        if (data.remotes.isEmpty()) {
            Text(stringResource(R.string.git_add_remote_before_push), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
        }
        for (remote in data.remotes) {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) {
                    openSheet(
                        GitSheet.Actions(
                            remote.name,
                            remote.push,
                            listOf(
                                ctx.getString(R.string.git_set_url) to {
                                    openSheet(
                                        GitSheet.Prompt(ctx.getString(R.string.git_remote_url), remote.push, remote.push, ctx.getString(R.string.git_save)) { url ->
                                            if (url.isNotBlank()) act {
                                                repo.gitCall("git.remote", GitParams(sessionKey, action = "setUrl", name = remote.name, url = url.trim()), Empty.serializer())
                                            }
                                        },
                                    )
                                },
                                ctx.getString(R.string.git_remove) to {
                                    act { repo.gitCall("git.remote", GitParams(sessionKey, action = "remove", name = remote.name), Empty.serializer()) }
                                },
                            ),
                        ),
                    )
                }.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(PiIcons.Monitor, Pi.c.fg3, 13.dp)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(remote.name, style = Pi.t.secondary.copy(color = Pi.c.fg))
                    Text(remote.push, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Hairline()
        }
        val addRemoteLabel = stringResource(R.string.git_add_remote)
        val createLabel = stringResource(R.string.create)
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
            QuietButton(addRemoteLabel, {
                openSheet(
                    GitSheet.Prompt(addRemoteLabel, "origin git@github.com:me/repo.git", "", createLabel) { value ->
                        val parts = value.trim().split(" ", limit = 2)
                        if (parts.size == 2) act {
                            repo.gitCall("git.remote", GitParams(sessionKey, action = "add", name = parts[0], url = parts[1].trim()), Empty.serializer())
                        }
                    },
                )
            }, icon = PiIcons.Plus, enabled = !busy)
        }

        Hairline()
        SectionLabel(stringResource(R.string.git_stashes), Modifier.padding(start = 14.dp, top = 12.dp))
        if (data.stashes.isEmpty()) {
            Text(stringResource(R.string.git_no_stash), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
        }
        for (stash in data.stashes) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                PiIcon(PiIcons.Queue, Pi.c.fg3, 12.dp)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(stash.ref, style = Pi.t.meta.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace))
                    Text(stash.message, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                QuietButton(stringResource(R.string.git_stash_pop), {
                    act { repo.gitCall("git.stash", GitParams(sessionKey, action = "pop", ref = stash.ref), GitStashList.serializer()) }
                }, enabled = !busy)
                Spacer(Modifier.width(6.dp))
                QuietButton(stringResource(R.string.git_stash_apply), {
                    act { repo.gitCall("git.stash", GitParams(sessionKey, action = "apply", ref = stash.ref), GitStashList.serializer()) }
                }, enabled = !busy)
                Spacer(Modifier.width(6.dp))
                QuietButton(stringResource(R.string.git_delete), {
                    act { repo.gitCall("git.stash", GitParams(sessionKey, action = "drop", ref = stash.ref), GitStashList.serializer()) }
                }, color = Pi.c.bad, enabled = !busy)
            }
            Hairline()
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
            QuietButton(stringResource(R.string.git_stash_save), {
                act { repo.gitCall("git.stash", GitParams(sessionKey, action = "save", includeUntracked = true), GitStashList.serializer()) }
            }, icon = PiIcons.Queue, enabled = !busy)
        }

        Hairline()
        SectionLabel(stringResource(R.string.git_tags), Modifier.padding(start = 14.dp, top = 12.dp))
        if (data.tags.isEmpty()) {
            Text(stringResource(R.string.git_no_tag), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
        }
        for (tag in data.tags) {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) {
                    openSheet(
                        GitSheet.Actions(
                            tag,
                            null,
                            listOf(
                                ctx.getString(R.string.git_tag_push) to { act { repo.gitCall("git.tag", GitParams(sessionKey, action = "push", name = tag), GitTagList.serializer()) } },
                                ctx.getString(R.string.git_delete) to { act { repo.gitCall("git.tag", GitParams(sessionKey, action = "delete", name = tag), GitTagList.serializer()) } },
                            ),
                        ),
                    )
                }.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(PiIcons.Lock, Pi.c.s2, 12.dp)
                Spacer(Modifier.width(8.dp))
                Text(tag, style = Pi.t.meta.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace), modifier = Modifier.weight(1f))
            }
            Hairline()
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
            val tagCreateLabel = stringResource(R.string.git_tag_create)
            val tagNameLabel = stringResource(R.string.git_tag_name)
            QuietButton(tagCreateLabel, {
                openSheet(
                    GitSheet.Prompt(tagCreateLabel, tagNameLabel, "", createLabel) { name ->
                        if (name.isNotBlank()) act {
                            repo.gitCall("git.tag", GitParams(sessionKey, action = "create", name = name.trim()), GitTagList.serializer())
                        }
                    },
                )
            }, icon = PiIcons.Plus, enabled = !busy)
        }

        Hairline()
        SectionLabel(stringResource(R.string.git_worktrees), Modifier.padding(start = 14.dp, top = 12.dp))
        if (data.worktrees.isEmpty()) {
            Text(stringResource(R.string.git_no_worktree), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
        }
        for (tree in data.worktrees) {
            WorktreeRow(tree, repo, sessionKey, busy, act)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
            val worktreeAddLabel = stringResource(R.string.git_worktree_add)
            val worktreePathLabel = stringResource(R.string.git_worktree_path)
            QuietButton(worktreeAddLabel, {
                openSheet(
                    GitSheet.Prompt(worktreeAddLabel, worktreePathLabel, "", createLabel) { path ->
                        if (path.isNotBlank()) act {
                            repo.gitCall("git.worktree", GitParams(sessionKey, action = "add", path = path.trim()), GitWorktreeList.serializer(), 180_000)
                        }
                    },
                )
            }, icon = PiIcons.Plus, enabled = !busy)
        }

        Hairline()
        SectionLabel(stringResource(R.string.git_repo), Modifier.padding(start = 14.dp, top = 12.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
            val cloneLabel = stringResource(R.string.git_clone)
            QuietButton(cloneLabel, {
                openSheet(
                    GitSheet.Prompt(cloneLabel, "https://… target", "", cloneLabel) { value ->
                        val parts = value.trim().split(" ", limit = 2)
                        if (parts.size == 2) act {
                            repo.gitCall("git.clone", GitParams(sessionKey, url = parts[0], path = parts[1]), GitCloneResult.serializer(), 300_000)
                        }
                    },
                )
            }, icon = PiIcons.Folder, enabled = !busy)
        }
    }
}

@Composable
private fun WorktreeRow(tree: GitWorktree, repo: RemoteRepository, sessionKey: String, busy: Boolean, act: Run) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        PiIcon(PiIcons.Folder, Pi.c.fg3, 12.dp)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(tree.path, style = Pi.t.meta.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(tree.branch ?: tree.head.take(7), style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        QuietButton(stringResource(R.string.git_delete), {
            act { repo.gitCall("git.worktree", GitParams(sessionKey, action = "remove", path = tree.path), GitWorktreeList.serializer(), 180_000) }
        }, color = Pi.c.bad, enabled = !busy)
    }
    Hairline()
}

@Composable
private fun GitDiffSheet(repo: RemoteRepository, sessionKey: String, request: GitSheet.Diff, onClose: () -> Unit) {
    var diff by remember(request) { mutableStateOf<GitFileDiff?>(null) }
    var failed by remember(request) { mutableStateOf(false) }
    LaunchedEffect(request) {
        val r = repo.gitCall(
            "git.diff",
            GitParams(sessionKey, path = request.path, staged = request.staged.takeIf { it }, commit = request.commit),
            GitFileDiff.serializer(),
        )
        diff = r.getOrNull()
        failed = r.isFailure
    }
    PiSheet(onDismiss = onClose) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(request.path, style = Pi.t.mono.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                QuietButton(stringResource(R.string.close), onClose)
            }
            Hairline()
            val lines = diff?.lines
            when {
                failed -> Text(stringResource(R.string.review_failed), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
                lines == null -> Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
                lines.isEmpty() -> Text(stringResource(R.string.git_no_change_hint), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
                else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
                    items(lines.size) { index -> GitDiffLineRow(lines[index]) }
                    if (diff?.truncated == true) {
                        item("trunc") { Text(stringResource(R.string.review_truncated), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun GitDiffLineRow(line: DiffLine) {
    if (line.k == "gap") {
        Row(Modifier.fillMaxWidth().background(Pi.c.surface).padding(horizontal = 14.dp, vertical = 5.dp)) {
            Text(if (line.s.isEmpty()) "⋯" else "⋯  ${line.s}", style = Pi.t.mono.copy(color = Pi.c.fg3, fontSize = 11.sp), maxLines = 1)
        }
        return
    }
    val bg = when (line.k) {
        "add" -> Pi.c.ok.copy(alpha = 0.12f)
        "del" -> Pi.c.bad.copy(alpha = 0.12f)
        else -> Pi.c.bg
    }
    val sign = when (line.k) {
        "add" -> "+"
        "del" -> "−"
        else -> " "
    }
    Row(Modifier.fillMaxWidth().background(bg).padding(horizontal = 14.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            sign,
            style = Pi.t.mono.copy(
                color = when (line.k) {
                    "add" -> Pi.c.ok
                    "del" -> Pi.c.bad
                    else -> Pi.c.fg3
                },
                fontSize = 12.sp,
            ),
        )
        Spacer(Modifier.width(6.dp))
        Text(line.s, style = Pi.t.mono.copy(color = Pi.c.fg, fontSize = 12.sp), maxLines = 2)
    }
}

@Composable
private fun GitCommitSheet(repo: RemoteRepository, sessionKey: String, ref: String, onClose: () -> Unit, openSheet: (GitSheet) -> Unit) {
    var detail by remember(ref) { mutableStateOf<GitCommitDetail?>(null) }
    LaunchedEffect(ref) {
        detail = repo.gitCall("git.commitDetail", GitParams(sessionKey, ref = ref), GitCommitDetail.serializer()).getOrNull()
    }
    PiSheet(onDismiss = onClose) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.git_tab_graph), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.weight(1f))
                QuietButton(stringResource(R.string.close), onClose)
            }
            Hairline()
            val d = detail
            if (d == null) {
                Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
                return@Column
            }
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 10.dp)) {
                Text(d.subject, style = Pi.t.bodyMedium.copy(color = Pi.c.fg))
                Text(
                    "${d.author} · ${formatAgo(d.time * 1000)} · ${d.hash.take(7)}",
                    style = Pi.t.meta.copy(color = Pi.c.fg3),
                    modifier = Modifier.padding(top = 4.dp),
                )
                if (d.body.isNotBlank()) Text(d.body, style = Pi.t.meta.copy(color = Pi.c.fg2), modifier = Modifier.padding(top = 8.dp))
                SectionLabel(stringResource(R.string.git_commit_files), Modifier.padding(top = 12.dp))
                for (file in d.files) {
                    Row(
                        Modifier.fillMaxWidth().clickable(role = Role.Button) {
                            openSheet(GitSheet.Diff(file.path.substringAfterLast('/'), file.path, false, d.hash))
                        }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(file.status, style = Pi.t.meta.copy(color = Pi.c.fg3, fontFamily = FontFamily.Monospace), modifier = Modifier.width(26.dp))
                        Text(file.path, style = Pi.t.meta.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun GitPromptSheet(prompt: GitSheet.Prompt, onClose: () -> Unit) {
    var value by remember(prompt) { mutableStateOf(prompt.initial) }
    PiSheet(onDismiss = onClose) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(prompt.title, style = Pi.t.bodyMedium.copy(color = Pi.c.fg))
            Box(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface).padding(horizontal = 10.dp, vertical = 10.dp)) {
                BasicTextField(
                    value = value,
                    onValueChange = { value = it },
                    textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                    cursorBrush = SolidColor(Pi.c.fg),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (value.isEmpty() && prompt.hint != null) Text(prompt.hint, style = Pi.t.secondary.copy(color = Pi.c.fg3))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                QuietButton(stringResource(R.string.cancel), onClose)
                Spacer(Modifier.width(8.dp))
                QuietButton(prompt.confirm, { onClose(); prompt.onDone(value) })
            }
        }
    }
}
