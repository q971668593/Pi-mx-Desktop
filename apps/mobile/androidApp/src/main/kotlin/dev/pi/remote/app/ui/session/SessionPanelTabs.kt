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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.SectionLabel
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.protocol.FileEntry
import dev.pi.remote.protocol.FileReadResult
import kotlinx.coroutines.launch

/** 与桌面端侧栏一致的 tab 顺序：文件 / Git / 工作团队 / 终端 / 浏览器。 */
private val TABS = listOf("run", "files", "git", "team")

/**
 * 会话面板的 tab 区（⋯ 打开的那一栏）：文件可预览可编辑保存，Git 看改动与提交，
 * 工作团队读电脑上的看板文件；终端与浏览器依赖桌面窗口，这里只给入口说明。
 */
@Composable
fun SessionPanelTabs(
    repo: RemoteRepository,
    sessionKey: String,
    canWrite: Boolean,
    runContent: (@Composable () -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    // 概览（Run）第一个：上下文、本会话、会话文件都在里面，和电脑端 Run tab 对齐。
    var tab by remember { mutableStateOf("run") }
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (key in TABS) {
                val selected = tab == key
                Box(
                    Modifier.clip(RoundedCornerShape(Pi.radius)).background(if (selected) Pi.c.surface else Color.Transparent)
                        .clickable(role = Role.Tab) { tab = key }.padding(horizontal = 10.dp, vertical = 6.dp),
                ) {
                    Text(stringResource(tabLabel(key)), style = Pi.t.meta.copy(color = if (selected) Pi.c.fg else Pi.c.fg3))
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Hairline()
        when (tab) {
            "run" -> if (runContent != null) runContent() else TeamTab(repo, sessionKey)
            "files" -> FilesTab(repo, sessionKey, canWrite)
            // Git 面板：电脑端「更改 / 图谱 / 分支 / 命令记录 / 更多」整套都在 GitPanel 里。
            "git" -> GitPanel(repo, sessionKey)
            else -> TeamTab(repo, sessionKey)
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
private fun FilesTab(repo: RemoteRepository, sessionKey: String, canWrite: Boolean) {
    var path by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<FileEntry>?>(null) }
    var open by remember { mutableStateOf<FileReadResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var savedHint by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(path, sessionKey) {
        loading = true
        entries = repo.listFiles(sessionKey, path)?.entries
        loading = false
    }

    val current = open
    if (current != null) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                QuietButton(stringResource(R.string.back), { open = null; editing = false; savedHint = null }, icon = PiIcons.ChevronLeft)
                Spacer(Modifier.width(8.dp))
                Text(
                    current.path.substringAfterLast('/'),
                    style = Pi.t.meta.copy(color = Pi.c.fg2),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
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
            when {
                current.kind == "image" && current.data != null -> {
                    val bytes = remember(current.data) { android.util.Base64.decode(current.data, android.util.Base64.DEFAULT) }
                    val bitmap = remember(bytes) { android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
                    if (bitmap != null) {
                        androidx.compose.foundation.Image(
                            bitmap.asImageBitmap(),
                            contentDescription = current.path,
                            contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                            modifier = Modifier.fillMaxWidth().heightIn(max = 260.dp),
                        )
                    }
                }
                current.kind == "binary" -> Text(stringResource(R.string.projfiles_binary), style = Pi.t.meta.copy(color = Pi.c.fg3))
                editing -> {
                    Box(Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 360.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.code).padding(10.dp)) {
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
                }
                else -> {
                    Box(Modifier.fillMaxWidth().heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                        Text(current.text.orEmpty(), style = Pi.t.meta.copy(fontFamily = FontFamily.Monospace, color = Pi.c.fg))
                    }
                }
            }
            if (editing && current.kind != "text") Unit
        }
        return
    }

    Column(Modifier.fillMaxWidth()) {
        if (path.isNotEmpty()) {
            Text(
                "…/" + path,
                style = Pi.t.meta.copy(color = Pi.c.fg3),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp).clickable(role = Role.Button) { path = "" },
            )
        }
        val list = entries
        when {
            list == null && loading -> Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
            list == null -> Text(stringResource(R.string.projfiles_failed), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
            list.isEmpty() -> Text(stringResource(R.string.projfiles_empty), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
            else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 380.dp)) {
                items(list, key = { it.path }) { entry ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 40.dp).clickable(role = Role.Button) {
                            if (entry.dir) path = entry.path
                            else scope.launch {
                                loading = true
                                open = repo.readFile(sessionKey, entry.path).getOrNull()
                                editing = false
                                savedHint = null
                                loading = false
                            }
                        }.padding(horizontal = 16.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PiIcon(if (entry.dir) PiIcons.Folder else PiIcons.File, Pi.c.fg3, 14.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(entry.name, style = Pi.t.secondary.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 12.dp)
                    }
                    Hairline()
                }
            }
        }
    }
}

@Composable
private fun TeamTab(repo: RemoteRepository, sessionKey: String) {
    var text by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(sessionKey) {
        val r = repo.readFile(sessionKey, TEAM_BOARD_PATH)
        text = r.getOrNull()?.takeIf { it.kind == "text" }?.text
        failed = text == null
    }
    Column(Modifier.fillMaxWidth()) {
        SectionLabel(stringResource(R.string.panel_tab_team))
        when {
            text == null && !failed -> Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
            failed -> Text(stringResource(R.string.panel_team_empty, TEAM_BOARD_PATH), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
            else -> Box(Modifier.fillMaxWidth().heightIn(max = 360.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
                Text(text.orEmpty(), style = Pi.t.meta.copy(fontFamily = FontFamily.Monospace, color = Pi.c.fg))
            }
        }
    }
}

/** 团队看板的固定位置，和桌面端一致。 */
private const val TEAM_BOARD_PATH = ".文档/开发规范/看板/当前批次.md"

/** 供 Compose Preview / 截图之外的调用方复用：当前 section 的标题。 */
@Composable
internal fun tabTitle(key: String): String = stringResource(tabLabel(key))
