package dev.pi.remote.app.ui.session

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
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
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.SectionLabel
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.formatAgo
import dev.pi.remote.protocol.FileEntry
import dev.pi.remote.protocol.FileReadResult
import dev.pi.remote.protocol.GitCommit
import kotlinx.coroutines.launch

/** 提交列表：分支上的最近 N 条（手机上的最小可用 Git 视图）。 */
@Composable
fun GitLogSheet(repo: RemoteRepository, sessionKey: String, onDismiss: () -> Unit) {
    var commits by remember { mutableStateOf<List<GitCommit>?>(null) }
    var isRepo by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(sessionKey) {
        repo.gitLog(sessionKey).onSuccess {
            isRepo = it.isRepo
            commits = it.commits
        }.onFailure { error = it.message ?: "failed" }
    }

    PiSheet(onDismiss) {
        Column(Modifier.fillMaxWidth().padding(bottom = 20.dp)) {
            SheetHeader(stringResource(R.string.git_title), onDismiss)
            when {
                error != null -> EmptyHint(stringResource(R.string.git_failed, error ?: ""))
                commits == null -> Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
                !isRepo -> EmptyHint(stringResource(R.string.git_not_repo))
                commits!!.isEmpty() -> EmptyHint(stringResource(R.string.git_empty))
                else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
                    items(commits!!, key = { it.sha }) { commit -> Box(Modifier.animateItem()) { CommitRow(commit) } }
                }
            }
        }
    }
}

@Composable
private fun CommitRow(commit: GitCommit) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 18.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
            Text(
                commit.short,
                style = Pi.t.meta.copy(fontFamily = FontFamily.Monospace, color = Pi.c.blue),
                modifier = Modifier.width(64.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(commit.subject, style = Pi.t.bodyMedium.copy(color = Pi.c.fg), maxLines = 3, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    commit.refs?.take(2)?.forEach { ref ->
                        Text(
                            ref,
                            style = Pi.t.meta.copy(color = Pi.c.fg2),
                            maxLines = 1,
                            modifier = Modifier
                                .padding(end = 6.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(Pi.c.surface)
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                    Text(
                        stringResource(R.string.git_by, commit.author, formatAgo(commit.at)),
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

/** 项目文件：逐级浏览 + 点开读内容（文本按等宽排版，图片直接显示）。 */
@Composable
fun FilesSheet(repo: RemoteRepository, sessionKey: String, onDismiss: () -> Unit) {
    var path by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<FileEntry>?>(null) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<FileEntry>?>(null) }
    var open by remember { mutableStateOf<FileReadResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    LaunchedEffect(path, sessionKey) {
        loading = true
        entries = repo.listFiles(sessionKey, path)?.entries
        loading = false
    }
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.isEmpty()) results = null else results = repo.searchFiles(sessionKey, q)
    }

    PiSheet(onDismiss) {
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).padding(bottom = 16.dp)) {
            SheetHeader(stringResource(R.string.projfiles_title), onDismiss)
            val shown = open
            if (shown != null) {
                FileViewer(shown, onBack = { open = null })
                return@Column
            }

            Breadcrumb(path, onNavigate = { path = it })
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
                  .clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface).padding(horizontal = 12.dp, vertical = 10.dp)) {
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = Pi.t.body.copy(color = Pi.c.fg),
                    decorationBox = { inner ->
                        if (query.isEmpty()) Text(stringResource(R.string.projfiles_search), style = Pi.t.body.copy(color = Pi.c.fg3))
                        inner()
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            val list = results ?: entries
            when {
                list == null && loading -> Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
                list == null -> EmptyHint(stringResource(R.string.projfiles_failed))
                list.isEmpty() -> EmptyHint(stringResource(R.string.projfiles_empty))
                else -> LazyColumn(Modifier.fillMaxWidth()) {
                    items(list, key = { it.path }) { entry ->
                        Column(Modifier.animateItem()) {
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button) {
                                if (entry.dir) {
                                    query = ""
                                    path = entry.path
                                } else {
                                    scope.launch {
                                        loading = true
                                        open = repo.readFile(sessionKey, entry.path).getOrNull()
                                        loading = false
                                    }
                                }
                            }.heightIn(min = Pi.row).padding(horizontal = 18.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            PiIcon(if (entry.dir) PiIcons.Folder else PiIcons.File, Pi.c.fg3, 14.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(
                                entry.name,
                                style = Pi.t.body.copy(color = Pi.c.fg),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            if (!entry.dir) {
                                Text(entry.size?.let { humanSize(it) } ?: "", style = Pi.t.meta.copy(color = Pi.c.fg3))
                            }
                            PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 13.dp)
                        }
                        Hairline()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FileViewer(file: FileReadResult, onBack: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconAction(PiIcons.ChevronLeft, stringResource(R.string.back), onBack)
            Spacer(Modifier.width(8.dp))
            Text(
                file.path.substringAfterLast('/'),
                style = Pi.t.meta.copy(color = Pi.c.fg2),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                buildString {
                    append(humanSize(file.size))
                    if (file.truncated) append(" · ").append(stringResource(R.string.projfiles_truncated))
                },
                style = Pi.t.meta.copy(color = Pi.c.fg3),
            )
        }
        Hairline()
        when (file.kind) {
            "image" -> {
                val bytes = remember(file.data) { file.data?.let { Base64.decode(it, Base64.DEFAULT) } }
                val bitmap = remember(bytes) { bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }
                if (bitmap != null) {
                    Image(
                        bitmap.asImageBitmap(),
                        contentDescription = file.path,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(Pi.radius)),
                    )
                } else EmptyHint(stringResource(R.string.projfiles_image_failed))
            }
            "text" -> {
                Box(Modifier.fillMaxWidth().heightIn(max = 440.dp).padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text(
                        file.text.orEmpty(),
                        style = Pi.t.meta.copy(fontFamily = FontFamily.Monospace, color = Pi.c.fg),
                    )
                }
            }
            else -> EmptyHint(stringResource(R.string.projfiles_binary))
        }
    }
}

@Composable
private fun Breadcrumb(path: String, onNavigate: (String) -> Unit) {
    if (path.isEmpty()) return
    Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            stringResource(R.string.projfiles_root),
            style = Pi.t.meta.copy(color = Pi.c.blue),
            modifier = Modifier.clickable(role = Role.Button) { onNavigate("") },
        )
        path.split('/').filter { it.isNotEmpty() }.forEachIndexed { index, part ->
            Text("/", style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(horizontal = 4.dp))
            val target = path.split('/').filter { it.isNotEmpty() }.take(index + 1).joinToString("/")
            Text(
                part,
                style = Pi.t.meta.copy(color = Pi.c.fg2),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable(role = Role.Button) { onNavigate(target) },
            )
        }
    }
}

@Composable
private fun SheetHeader(title: String, onDismiss: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.weight(1f))
        IconAction(PiIcons.X, stringResource(R.string.close), onDismiss)
    }
}

@Composable
private fun EmptyHint(text: String) {
    Text(text, style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.fillMaxWidth().padding(20.dp))
}

private fun humanSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}
