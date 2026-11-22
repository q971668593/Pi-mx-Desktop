package dev.pi.remote.app.ui.session

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.rich.RichContent
import dev.pi.remote.net.HostConnection
import dev.pi.remote.protocol.TeamBoardResult
import dev.pi.remote.protocol.TeamBoardTask

private const val BOARD_PATH = ".文档/开发规范/看板/当前批次.md"
private val boardStatuses = mapOf(
    "待办" to R.string.team_todo,
    "进行中" to R.string.team_active,
    "待审查" to R.string.team_review,
    "阻塞" to R.string.team_blocked,
    "实现完成" to R.string.team_implemented,
    "已验收" to R.string.team_accepted,
)

@Composable
internal fun TeamBoardTab(repo: RemoteRepository, sessionKey: String) {
    var result by remember(sessionKey) { mutableStateOf<Result<TeamBoardResult>?>(null) }
    var refresh by remember(sessionKey) { mutableStateOf(0) }
    var loading by remember(sessionKey) { mutableStateOf(true) }
    var filter by remember(sessionKey) { mutableStateOf<String?>(null) }
    var detailId by remember(sessionKey) { mutableStateOf<String?>(null) }
    var sourceOpen by remember(sessionKey) { mutableStateOf(false) }
    LaunchedEffect(repo, sessionKey, refresh) {
        loading = true
        result = repo.teamBoard(sessionKey)
        loading = false
    }
    if (sourceOpen) TeamSource(repo, sessionKey, onDismiss = { sourceOpen = false })

    val board = result?.getOrNull()
    if (board == null) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (loading) {
                Spinner(Pi.c.fg3, 18.dp)
            } else {
                val code = (result?.exceptionOrNull() as? HostConnection.CallException)?.code
                val message = when (code) {
                    "not_found" -> stringResource(R.string.panel_team_empty, BOARD_PATH)
                    "not_supported" -> stringResource(R.string.team_upgrade)
                    else -> stringResource(R.string.team_load_failed)
                }
                Text(message, style = Pi.t.body.copy(color = Pi.c.fg2))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (code != "not_supported") QuietButton(stringResource(R.string.conn_retry), { refresh++ })
                    if (code != "not_found") QuietButton(stringResource(R.string.team_source), { sourceOpen = true })
                }
            }
        }
        return
    }

    val counts = remember(board) { board.tasks.groupingBy { it.status }.eachCount() }
    val visible = remember(board, filter) { if (filter == null) board.tasks else board.tasks.filter { it.status == filter } }
    board.tasks.firstOrNull { it.id == detailId }?.let { task -> TeamTaskDetail(task) { detailId = null } }
    LazyColumn(
        Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Pi.c.surface).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(board.batch.ifBlank { stringResource(R.string.panel_tab_team) }, style = Pi.t.title.copy(color = Pi.c.fg))
                if (board.goal.isNotBlank()) Text(board.goal, style = Pi.t.secondary.copy(color = Pi.c.fg2))
                val accepted = counts["已验收"] ?: 0
                val progress = if (board.tasks.isEmpty()) 0f else accepted.toFloat() / board.tasks.size
                Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(Pi.c.line)) {
                    Box(Modifier.fillMaxWidth(progress).height(6.dp).background(Pi.c.blue))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.team_progress, accepted, board.tasks.size), style = Pi.t.meta.copy(color = Pi.c.fg2), modifier = Modifier.weight(1f))
                    val blocked = counts["阻塞"] ?: 0
                    if (blocked > 0) Text(stringResource(R.string.team_blocked_count, blocked), style = Pi.t.meta.copy(color = Pi.c.bad))
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                QuietButton(stringResource(R.string.team_source), { sourceOpen = true })
                QuietButton(stringResource(R.string.team_refresh), { refresh++ }, enabled = !loading)
                if (loading) Spinner(Pi.c.fg3, 14.dp)
            }
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TeamFilter(stringResource(R.string.team_all), board.tasks.size, filter == null) { filter = null }
                boardStatuses.forEach { (status, label) ->
                    TeamFilter(stringResource(label), counts[status] ?: 0, filter == status) { filter = status }
                }
            }
        }
        if (visible.isEmpty()) item {
            Text(stringResource(R.string.team_no_tasks), style = Pi.t.secondary.copy(color = Pi.c.fg3), modifier = Modifier.padding(8.dp))
        }
        items(visible, key = { it.id }) { task ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Pi.c.surface)
                    .clickable(role = Role.Button) { detailId = task.id }.padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(task.title.ifBlank { task.id }, style = Pi.t.bodyMedium.copy(color = Pi.c.fg))
                    Text(listOf(task.id, task.role).filter { it.isNotBlank() }.joinToString(" · "), style = Pi.t.meta.copy(color = Pi.c.fg2))
                }
                TeamStatus(task.status)
                PiIcon(PiIcons.ChevronRight, Pi.c.fg3, 14.dp)
            }
        }
    }
}

@Composable
private fun TeamFilter(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp))
            .background(if (selected) Pi.c.blue.copy(alpha = 0.14f) else Pi.c.surface)
            .selectable(selected, role = Role.Tab, onClick = onClick).padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("$label $count", style = Pi.t.secondary.copy(color = if (selected) Pi.c.blue else Pi.c.fg2))
    }
}

@Composable
private fun TeamStatus(status: String) {
    val color = when (status) {
        "阻塞" -> Pi.c.bad
        "待审查" -> Pi.c.warn
        "进行中" -> Pi.c.blue
        else -> Pi.c.fg2
    }
    Text(boardStatuses[status]?.let { stringResource(it) } ?: status, style = Pi.t.meta.copy(color = color))
}

@Composable
private fun TeamTaskDetail(task: TeamBoardTask, onDismiss: () -> Unit) {
    PiSheet(onDismiss) {
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(task.title.ifBlank { task.id }, style = Pi.t.title.copy(color = Pi.c.fg))
            Text(listOf(task.id, task.role).filter { it.isNotBlank() }.joinToString(" · "), style = Pi.t.secondary.copy(color = Pi.c.fg2))
            TeamStatus(task.status)
            TaskField(R.string.team_dependencies, task.dependsOn.joinToString(", "))
            TaskField(R.string.team_input, task.input)
            TaskField(R.string.team_output, task.output)
            TaskField(R.string.team_block_reason, task.blockType)
            TaskField(R.string.team_note, task.note)
            TaskField(R.string.team_approval, task.approval)
            if (task.acceptance.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.team_acceptance), style = Pi.t.meta.copy(color = Pi.c.fg2))
                    task.acceptance.forEach { item ->
                        val status = stringResource(if (item.done) R.string.team_check_done else R.string.team_check_open)
                        Text(stringResource(R.string.team_check_item, status, item.text), style = Pi.t.body.copy(color = Pi.c.fg))
                    }
                }
            }
            val dispatch = when (task.dispatch) {
                "starting" -> R.string.team_dispatched_starting
                "running" -> R.string.team_active
                "done" -> R.string.team_dispatch_done
                "failed" -> R.string.team_dispatch_failed
                "cancelled" -> R.string.team_dispatch_cancelled
                "stale" -> R.string.team_dispatch_stale
                else -> null
            }
            if (dispatch != null) TaskField(R.string.team_dispatch, stringResource(dispatch))
        }
    }
}

@Composable
private fun TaskField(@StringRes label: Int, value: String) {
    if (value.isBlank()) return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(label), style = Pi.t.meta.copy(color = Pi.c.fg2))
        Text(value, style = Pi.t.body.copy(color = Pi.c.fg))
    }
}

@Composable
private fun TeamSource(repo: RemoteRepository, sessionKey: String, onDismiss: () -> Unit) {
    var loading by remember(sessionKey) { mutableStateOf(true) }
    var source by remember(sessionKey) { mutableStateOf<String?>(null) }
    LaunchedEffect(repo, sessionKey) {
        source = repo.readFile(sessionKey, BOARD_PATH).getOrNull()?.takeIf { it.kind == "text" && !it.truncated }?.text
        loading = false
    }
    PiSheet(onDismiss) {
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.team_source), style = Pi.t.title.copy(color = Pi.c.fg))
            val text = source
            when {
                loading -> Spinner(Pi.c.fg3, 18.dp)
                text == null -> Text(stringResource(R.string.team_load_failed), style = Pi.t.secondary.copy(color = Pi.c.fg2))
                else -> RichContent(text, streaming = false)
            }
        }
    }
}
