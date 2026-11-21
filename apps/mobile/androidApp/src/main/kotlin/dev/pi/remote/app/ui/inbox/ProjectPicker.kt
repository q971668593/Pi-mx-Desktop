package dev.pi.remote.app.ui.inbox

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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
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
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.SectionLabel
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.protocol.FsBrowseResult
import kotlinx.coroutines.launch

/**
 * 「新建项目」：直接翻电脑上的文件夹（可以当场建一个新文件夹），把它变成项目后立刻在这开局对话。
 * 这样不在项目列表里的目录也能用，不用先回电脑上操作一遍。
 */
@Composable
fun ProjectPickerSheet(
    repo: RemoteRepository,
    creating: Boolean,
    onCreate: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var path by remember { mutableStateOf<String?>(null) }
    var listing by remember { mutableStateOf<FsBrowseResult?>(null) }
    var loading by remember { mutableStateOf(true) }
    var failure by remember { mutableStateOf<String?>(null) }
    var jump by remember { mutableStateOf("") }
    var newFolder by remember { mutableStateOf(false) }
    var folderName by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<String?>(null) }

    suspend fun load(target: String?) {
        loading = true
        repo.browseDirs(target)
            .onSuccess { listing = it; path = it.path.ifEmpty { null }; failure = null }
            .onFailure { failure = it.message }
        loading = false
    }

    fun open(target: String?) {
        scope.launch { load(target) }
    }

    /** 目录 → 项目 → 对话：三步一次做完，失败就把原因留在面板上。 */
    fun pick(dir: String) {
        if (pending != null) return
        pending = dir
        scope.launch {
            val project = repo.addProject(dir)
            pending = null
            project.onSuccess { onCreate(it.id) }.onFailure { failure = it.message }
        }
    }

    LaunchedEffect(Unit) { load(null) }

    PiSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(bottom = 20.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.picker_title), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), modifier = Modifier.weight(1f))
                if (listing?.path?.isNotEmpty() == true) {
                    QuietButton(stringResource(R.string.picker_use_here), { listing?.path?.let(::pick) }, enabled = !creating && pending == null)
                }
            }
            Text(
                listing?.path?.ifEmpty { stringResource(R.string.picker_roots) } ?: stringResource(R.string.picker_roots),
                style = Pi.t.meta.copy(color = Pi.c.fg3, fontFamily = FontFamily.Monospace),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                QuietButton(stringResource(R.string.picker_up), { open(listing?.parent) }, enabled = listing?.parent != null, icon = PiIcons.ArrowUp)
                Spacer(Modifier.width(6.dp))
                QuietButton(stringResource(R.string.picker_new_folder), { newFolder = true; folderName = "" }, icon = PiIcons.Plus, enabled = listing != null)
            }
            if (newFolder) {
                // 内联一行：不在弹层上再叠弹层，手机上手更顺。
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).heightIn(min = 36.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface).padding(horizontal = 10.dp, vertical = 9.dp)) {
                        BasicTextField(
                            value = folderName,
                            onValueChange = { folderName = it },
                            textStyle = Pi.t.secondary.copy(color = Pi.c.fg),
                            cursorBrush = SolidColor(Pi.c.fg),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (folderName.isEmpty()) Text(stringResource(R.string.picker_folder_name), style = Pi.t.secondary.copy(color = Pi.c.fg3))
                    }
                    Spacer(Modifier.width(8.dp))
                    QuietButton(stringResource(R.string.picker_create_folder), {
                        val base = listing?.path.orEmpty()
                        val name = folderName.trim()
                        if (base.isNotEmpty() && name.isNotEmpty()) {
                            newFolder = false
                            scope.launch {
                                repo.makeDir(base, name)
                                    .onSuccess { created -> pick(created) }
                                    .onFailure { failure = it.message }
                            }
                        }
                    }, enabled = folderName.isNotBlank())
                    Spacer(Modifier.width(6.dp))
                    QuietButton(stringResource(R.string.cancel), { newFolder = false })
                }
            }
            Spacer(Modifier.height(6.dp))
            // 知道自己路径的人可以直接跳过去，不用一层层点。
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).heightIn(min = 34.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface).padding(horizontal = 10.dp, vertical = 8.dp)) {
                    BasicTextField(
                        value = jump,
                        onValueChange = { jump = it },
                        textStyle = Pi.t.meta.copy(color = Pi.c.fg, fontFamily = FontFamily.Monospace),
                        cursorBrush = SolidColor(Pi.c.fg),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (jump.isEmpty()) Text(stringResource(R.string.picker_path_hint), style = Pi.t.meta.copy(color = Pi.c.fg3))
                }
                Spacer(Modifier.width(8.dp))
                QuietButton(stringResource(R.string.picker_go), { open(jump.trim()) }, enabled = jump.isNotBlank())
            }
            failure?.let {
                Text(
                    stringResource(R.string.git_action_failed, it),
                    style = Pi.t.meta.copy(color = Pi.c.bad),
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            Hairline(Modifier.padding(top = 8.dp))
            val data = listing
            when {
                data == null -> Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 16.dp) }
                else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 380.dp)) {
                    if (data.path.isEmpty()) {
                        item("roots-label") { SectionLabel(stringResource(R.string.picker_roots), Modifier.padding(start = 20.dp, top = 8.dp, bottom = 2.dp)) }
                        items(data.roots, key = { "root:${it.path}" }) { root ->
                            PickerRow(name = root.name, path = root.path, repo = false, busy = pending == root.path || loading, onOpen = { open(root.path) }, onPick = { pick(root.path) })
                        }
                    }
                    items(data.dirs, key = { it.path }) { dir ->
                        PickerRow(
                            name = dir.name,
                            path = dir.path,
                            repo = dir.repo,
                            busy = pending == dir.path || loading,
                            onOpen = { open(dir.path) },
                            onPick = { pick(dir.path) },
                        )
                    }
                    if (data.dirs.isEmpty() && data.path.isNotEmpty()) {
                        item("empty") {
                            Text(
                                stringResource(R.string.picker_empty),
                                style = Pi.t.meta.copy(color = Pi.c.fg3),
                                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                            )
                        }
                    }
                    if (data.truncated) {
                        item("trunc") {
                            Text(stringResource(R.string.picker_truncated), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(16.dp))
                        }
                    }
                }
            }
        }
    }

}

@Composable
private fun PickerRow(name: String, path: String, repo: Boolean, busy: Boolean, onOpen: () -> Unit, onPick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpen).padding(start = 20.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PiIcon(if (repo) PiIcons.Branch else PiIcons.Folder, if (repo) Pi.c.blue else Pi.c.fg3, 14.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = Pi.t.body.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(path, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (busy) Spinner(Pi.c.fg3, 14.dp) else QuietButton(stringResource(R.string.picker_use), onPick)
    }
    Hairline()
}
