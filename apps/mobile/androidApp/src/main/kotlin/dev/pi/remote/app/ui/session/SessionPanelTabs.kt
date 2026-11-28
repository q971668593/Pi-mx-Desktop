package dev.pi.remote.app.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.FileRefs
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.rich.MermaidSource
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.FileEntry
import dev.pi.remote.protocol.FileReadResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

private val TABS = listOf("run", "files", "git", "team")

@Composable
fun SessionPanelTabs(
    repo: RemoteRepository,
    sessionKey: String,
    canWrite: Boolean,
    runContent: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    mermaid: MermaidSource? = null,
    onOpenFile: (String) -> Unit = {},
    onQuote: (String) -> Unit = {},
) {
    // 概览（Run）第一个：上下文、本会话、会话文件都在里面，和电脑端 Run tab 对齐。
    var tab by remember { mutableStateOf("run") }
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().selectableGroup().padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (key in TABS) {
                val selected = tab == key
                Box(
                    Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(Pi.radius))
                        .background(if (selected) Pi.c.blue.copy(alpha = 0.14f) else Color.Transparent)
                        .selectable(selected, role = Role.Tab) { tab = key },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(stringResource(tabLabel(key)), style = Pi.t.secondary.copy(color = if (selected) Pi.c.blue else Pi.c.fg2))
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Hairline()
        when (tab) {
            "run" -> runContent()
            "files" -> FilesTab(repo, sessionKey, canWrite, mermaid = mermaid, onOpenFullscreen = onOpenFile, onQuote = onQuote)
            // Git 面板：电脑端「更改 / 图谱 / 分支 / 命令记录 / 更多」整套都在 GitPanel 里。
            "git" -> GitPanel(repo, sessionKey)
            else -> TeamBoardTab(repo, sessionKey, onOpenFile = onOpenFile, onQuoteTask = onQuote)
        }
    }
}

private fun tabLabel(key: String) = when (key) {
    "run" -> R.string.panel_tab_run
    "files" -> R.string.panel_tab_files
    "git" -> R.string.panel_tab_git
    else -> R.string.panel_tab_team
}

@Composable
private fun FilesTab(
    repo: RemoteRepository,
    sessionKey: String,
    canWrite: Boolean,
    mermaid: MermaidSource? = null,
    onOpenFullscreen: (String) -> Unit = {},
    onQuote: (String) -> Unit = {},
) {
    val connection by repo.connection.collectAsState()
    val ready = connection is HostConnection.State.Ready
    var path by remember(sessionKey) { mutableStateOf("") }
    var showHidden by remember(sessionKey) { mutableStateOf(true) }
    var reloadTick by remember(sessionKey) { mutableIntStateOf(0) }
    var query by remember(sessionKey) { mutableStateOf("") }
    var searchResults by remember(sessionKey) { mutableStateOf<List<FileEntry>?>(null) }
    var entries by remember(sessionKey) { mutableStateOf<List<FileEntry>?>(null) }
    var listTruncated by remember(sessionKey) { mutableStateOf(false) }
    var listError by remember(sessionKey) { mutableStateOf<String?>(null) }
    var open by remember(sessionKey) { mutableStateOf<FileReadResult?>(null) }
    var openError by remember(sessionKey) { mutableStateOf<String?>(null) }
    var loading by remember(sessionKey) { mutableStateOf(true) }
    var openingFile by remember(sessionKey) { mutableStateOf(false) }
    var editing by remember(sessionKey) { mutableStateOf(false) }
    var viewMode by remember(sessionKey) { mutableStateOf("preview") }
    var draft by remember(sessionKey) { mutableStateOf("") }
    var saving by remember(sessionKey) { mutableStateOf(false) }
    var savedHint by remember(sessionKey) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(path, sessionKey, showHidden, reloadTick, ready) {
        loading = true
        listError = null
        if (!ready) {
            withTimeoutOrNull(10_000) { repo.connection.first { it is HostConnection.State.Ready } }
        }
        val reqPath = path.ifEmpty { "." }
        var res = repo.listFilesResult(sessionKey, reqPath, dotfiles = showHidden)
        if (res.isFailure) {
            delay(600)
            res = repo.listFilesResult(sessionKey, reqPath, dotfiles = showHidden)
        }
        res.onSuccess {
            entries = it.entries
            listTruncated = it.truncated
            listError = null
        }.onFailure { err ->
            if (entries == null) listError = err.message ?: "failed"
        }
        loading = false
    }

    LaunchedEffect(query, sessionKey, ready) {
        val q = query.trim()
        if (q.isEmpty()) {
            searchResults = null
            return@LaunchedEffect
        }
        delay(200)
        searchResults = repo.searchFiles(sessionKey, q).orEmpty()
    }

    fun openEntry(entryPath: String) {
        if (openingFile) return
        scope.launch {
            openingFile = true
            openError = null
            val res = repo.readFile(sessionKey, entryPath)
            res.onSuccess {
                open = it
                viewMode = "preview"
                editing = false
                savedHint = null
            }.onFailure {
                openError = it.message ?: "open failed"
            }
            openingFile = false
        }
    }

    val current = open
    if (current != null) {
        val isRichDoc = (current.kind == "text" && (FileRefs.isMarkdown(current.path) || FileRefs.isHtml(current.path) || FileRefs.isSvg(current.path))) ||
            (current.kind == "image" && FileRefs.isSvg(current.path))
        Column(Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                QuietButton(stringResource(R.string.back), { open = null; editing = false; savedHint = null }, icon = PiIcons.ChevronLeft)
                Spacer(Modifier.width(4.dp))
                Text(
                    current.path.substringAfterLast('/'),
                    style = Pi.t.meta.copy(color = Pi.c.fg2),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (!editing && isRichDoc) {
                    Segmented(
                        listOf("preview" to stringResource(R.string.file_preview_mode), "source" to stringResource(R.string.file_source_mode)),
                        viewMode,
                        { viewMode = it },
                    )
                    Spacer(Modifier.width(2.dp))
                }
                IconAction(PiIcons.At, stringResource(R.string.file_quote), { onQuote(current.path) }, size = 16.dp)
                IconAction(PiIcons.Expand, stringResource(R.string.fullscreen), { onOpenFullscreen(current.path) }, size = 16.dp)
                if (current.kind == "text" && canWrite) {
                    QuietButton(stringResource(if (editing) R.string.panel_cancel else R.string.panel_edit), {
                        if (editing) {
                            editing = false
                        } else {
                            draft = current.text.orEmpty()
                            editing = true
                        }
                    })
                }
            }
            Spacer(Modifier.height(6.dp))
            if (editing && current.kind == "text") {
                Box(Modifier.fillMaxWidth().weight(1f, fill = false).heightIn(min = 160.dp, max = 380.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.code).padding(10.dp)) {
                    BasicTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        textStyle = Pi.t.monoSmall.copy(color = Pi.c.fg),
                        cursorBrush = SolidColor(Pi.c.fg),
                        modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val savedText = stringResource(R.string.panel_saved)
                    val failedText = stringResource(R.string.panel_save_failed)
                    QuietButton(stringResource(if (saving) R.string.panel_saving else R.string.panel_save), {
                        if (!saving) scope.launch {
                            saving = true
                            val r = repo.writeFile(sessionKey, current.path, draft)
                            saving = false
                            savedHint = if (r.isSuccess) {
                                open = current.copy(text = draft, size = draft.toByteArray().size.toLong())
                                editing = false
                                savedText
                            } else failedText
                        }
                    }, icon = PiIcons.Check)
                    savedHint?.let {
                        Spacer(Modifier.width(10.dp))
                        Text(it, style = Pi.t.meta.copy(color = Pi.c.fg3))
                    }
                }
            } else {
                RichFileContent(
                    file = current,
                    viewMode = viewMode,
                    mermaid = mermaid,
                    onOpenFileLink = { target ->
                        val norm = FileRefs.normalizePath(target)
                        if (norm.isNotEmpty()) onOpenFullscreen(norm)
                    },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                )
            }
        }
        return
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(Pi.c.surface).padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(PiIcons.Search, Pi.c.fg3, 14.dp)
                Spacer(Modifier.width(6.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text(stringResource(R.string.projfiles_search), style = Pi.t.secondary.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                        cursorBrush = SolidColor(Pi.c.fg),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (query.isNotEmpty()) {
                    PiIcon(PiIcons.X, Pi.c.fg3, 13.dp, Modifier.clip(CircleShape).clickable(role = Role.Button) { query = "" })
                }
            }
            Box(
                Modifier.clip(RoundedCornerShape(8.dp))
                    .background(if (showHidden) Pi.c.blue.copy(alpha = 0.14f) else Pi.c.surface)
                    .clickable(role = Role.Button) { showHidden = !showHidden }
                    .padding(horizontal = 9.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(R.string.projfiles_show_hidden),
                    style = Pi.t.meta.copy(color = if (showHidden) Pi.c.blue else Pi.c.fg3),
                )
            }
            QuietButton(stringResource(R.string.git_refresh), { reloadTick++ }, enabled = !loading)
        }
        if (path.isNotEmpty() && query.isBlank()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(R.string.projfiles_root),
                    style = Pi.t.meta.copy(color = Pi.c.blue),
                    modifier = Modifier.clickable(role = Role.Button) { path = ""; open = null },
                )
                val parts = path.split('/').filter { it.isNotEmpty() }
                parts.forEachIndexed { idx, part ->
                    Text(" / ", style = Pi.t.meta.copy(color = Pi.c.fg3))
                    val target = parts.take(idx + 1).joinToString("/")
                    val last = idx == parts.lastIndex
                    Text(
                        part,
                        style = Pi.t.meta.copy(color = if (last) Pi.c.fg else Pi.c.blue),
                        modifier = Modifier.clickable(enabled = !last, role = Role.Button) { path = target; open = null },
                    )
                }
            }
        }
        if (openingFile) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Spinner(Pi.c.blue, 14.dp)
                Text(stringResource(R.string.projfiles_loading_file), style = Pi.t.meta.copy(color = Pi.c.fg2))
            }
        }
        openError?.let {
            Text("${stringResource(R.string.projfiles_open_failed)}: $it", style = Pi.t.meta.copy(color = Pi.c.bad), modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }

        val list = if (query.isNotBlank()) searchResults else entries
        when {
            list == null && loading -> Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 18.dp) }
            list == null -> Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(listError?.let { "${stringResource(R.string.projfiles_failed)}: $it" } ?: stringResource(R.string.projfiles_failed), style = Pi.t.meta.copy(color = Pi.c.fg3))
                QuietButton(stringResource(R.string.file_retry), { reloadTick++ })
            }
            list.isEmpty() -> Text(
                stringResource(if (query.isNotBlank()) R.string.files_none else R.string.projfiles_empty),
                style = Pi.t.meta.copy(color = Pi.c.fg3),
                modifier = Modifier.padding(18.dp),
            )
            else -> LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                items(list, key = { it.path }) { entry ->
                    val isImg = !entry.dir && FileRefs.isImage(entry.path)
                    val isDoc = !entry.dir && (FileRefs.isMarkdown(entry.path) || FileRefs.isHtml(entry.path))
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 42.dp).clickable(role = Role.Button) {
                            if (entry.dir) {
                                query = ""
                                open = null
                                path = entry.path
                            } else {
                                openEntry(entry.path)
                            }
                        }.padding(horizontal = 16.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PiIcon(
                            when {
                                entry.dir -> PiIcons.Folder
                                isImg -> PiIcons.Image
                                else -> PiIcons.File
                            },
                            if (isDoc) Pi.c.blue else Pi.c.fg3,
                            14.dp,
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(entry.name, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (query.isNotBlank() && entry.path != entry.name) {
                                Text(entry.path, style = Pi.t.small.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        val entrySize = entry.size
                        if (!entry.dir && entrySize != null) {
                            Text(formatSize(entrySize), style = Pi.t.small.copy(color = Pi.c.fg3), modifier = Modifier.padding(end = 6.dp))
                        }
                        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 12.dp)
                    }
                    Hairline()
                }
                if (listTruncated && query.isBlank()) {
                    item("truncated") {
                        Text(stringResource(R.string.files_truncated), style = Pi.t.small.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
                    }
                }
            }
        }
    }
}

/** 供 Compose Preview / 截图之外的调用方复用：当前 section 的标题。 */
@Composable
internal fun tabTitle(key: String): String = stringResource(tabLabel(key))
