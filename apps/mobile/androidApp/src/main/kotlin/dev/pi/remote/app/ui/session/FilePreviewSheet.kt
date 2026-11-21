package dev.pi.remote.app.ui.session

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.data.FileRefs
import dev.pi.remote.app.data.MediaExport
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiSheet
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.protocol.FileReadResult
import kotlinx.coroutines.launch

/**
 * 点开任意文件引用：文本按等宽只读展示，图片直接显示并可长按「保存到相册 / 分享」。
 * 走的是同一条 `file.read`，所以生图产物、说明文档、日志都能在手机上打开。
 */
@Composable
fun FilePreviewSheet(repo: RemoteRepository, sessionKey: String, path: String, onDismiss: () -> Unit) {
    var file by remember(path) { mutableStateOf<FileReadResult?>(null) }
    var failed by remember(path) { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(path) {
        val r = repo.readFile(sessionKey, path)
        file = r.getOrNull()
        failed = file == null
    }

    PiSheet(onDismiss) {
        Column(Modifier.fillMaxWidth().heightIn(max = 620.dp).padding(bottom = 20.dp)) {
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp, top = 4.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(path.substringAfterLast('/').substringAfterLast('\\'), style = Pi.t.bodyMedium.copy(color = Pi.c.fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(path, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconAction(PiIcons.X, stringResource(R.string.close), onDismiss)
            }
            Hairline()
            val f = file
            when {
                f == null && !failed -> Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) { Spinner(Pi.c.fg3, 18.dp) }
                f == null -> Text(stringResource(R.string.files_failed), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
                f.kind == "image" && f.data != null -> {
                    val bitmap = remember(f.data) {
                        val bytes = android.util.Base64.decode(f.data, android.util.Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    }
                    if (bitmap != null) {
                        Box(
                            Modifier.fillMaxWidth().padding(14.dp)
                                .pointerInput(bitmap) {
                                    detectTapGestures(onLongPress = {
                                        val uri = MediaExport.saveToGallery(context, bitmap, path.substringAfterLast('/'))
                                        if (uri != null) android.widget.Toast.makeText(context, R.string.image_saved, android.widget.Toast.LENGTH_SHORT).show()
                                    })
                                },
                        ) {
                            Image(bitmap.asImageBitmap(), contentDescription = path, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(Pi.radius)))
                        }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            androidx.compose.material3.TextButton(onClick = {
                                val uri = MediaExport.saveToGallery(context, bitmap, path.substringAfterLast('/'))
                                if (uri != null) android.widget.Toast.makeText(context, R.string.image_saved, android.widget.Toast.LENGTH_SHORT).show()
                            }) { Text(stringResource(R.string.image_save)) }
                            androidx.compose.material3.TextButton(onClick = { MediaExport.shareBitmap(context, bitmap, path.substringAfterLast('/')) }) {
                                Text(stringResource(R.string.image_share))
                            }
                            Spacer(Modifier.weight(1f))
                            Text(stringResource(R.string.image_longpress_hint), style = Pi.t.meta.copy(color = Pi.c.fg3))
                        }
                    } else Text(stringResource(R.string.projfiles_image_failed), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
                }
                f.kind == "text" -> Box(Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text(f.text.orEmpty(), style = Pi.t.meta.copy(fontFamily = FontFamily.Monospace, color = Pi.c.fg))
                }
                else -> Text(stringResource(R.string.projfiles_binary), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
            }
        }
    }
}

/** 回复正文下面的文件小卡片：一行最多 3 个，点开就是 [FilePreviewSheet]。 */
@Composable
fun FileRefChips(paths: List<String>, onOpen: (String) -> Unit) {
    if (paths.isEmpty()) return
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (path in paths.take(3)) {
            Row(
                Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface)
                    .clickable(role = Role.Button) { onOpen(path) }.padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(if (FileRefs.isImage(path)) PiIcons.Image else PiIcons.File, Pi.c.fg3, 13.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    path.substringAfterLast('/').substringAfterLast('\\'),
                    style = Pi.t.meta.copy(color = Pi.c.fg2), maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
