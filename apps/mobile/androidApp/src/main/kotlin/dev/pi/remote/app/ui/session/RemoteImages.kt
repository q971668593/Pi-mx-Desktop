package dev.pi.remote.app.ui.session

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.pi.remote.R
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Motion
import dev.pi.remote.app.ui.Spinner

/**
 * 聊天里的图片：工具输出（生图、下载、截图）里出现的项目内图片路径，直接在时间线上显示缩略图，
 * 点开看大图。走 `file.read`，与「项目文件」面板同一通道，没有新增协议。
 */
object ImagePaths {
    private val IMAGE_EXT = "png|jpe?g|webp|gif|bmp|svg|avif"
    private val pattern = Regex(
        """((?:[A-Za-z]:[\\/])?[^\s"'`()\[\]，。；：！？]+?\.(?:$IMAGE_EXT))""",
        RegexOption.IGNORE_CASE,
    )
    private val trimChars = charArrayOf('"', '\'', '`', '(', ')', '[', ']', '，', '。', '；', '：', '—', '…', '<', '>')

    /** Project-relative (or absolute) image paths mentioned in a piece of text, de-duplicated. */
    fun find(text: String, max: Int = 3): List<String> =
        pattern.findAll(text)
            .map { it.groupValues[1].trim(*trimChars) }
            .filter { it.isNotEmpty() && !it.startsWith("http") && !it.startsWith("data:") }
            .distinct()
            .take(max)
            .toList()
}

@Composable
fun RemoteImageStrip(
    paths: List<String>,
    load: suspend (String) -> ImageBitmap?,
    onOpen: (ImageBitmap, String) -> Unit,
    size: Dp = 132.dp,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = paths.isNotEmpty(),
        enter = fadeIn(tween(Motion.normal)),
        exit = fadeOut(tween(Motion.fast)),
    ) {
        Row(
            modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (path in paths) {
                var bitmap by remember(path) { mutableStateOf<ImageBitmap?>(null) }
                var failed by remember(path) { mutableStateOf(false) }
                LaunchedEffect(path) {
                    val loaded = runCatching { load(path) }.getOrNull()
                    bitmap = loaded
                    failed = loaded == null
                }
                val shape = RoundedCornerShape(Pi.radius)
                Box(
                    Modifier.size(size).clip(shape).background(Pi.c.surface)
                        .border(1.dp, Pi.c.line, shape)
                        .clickable(enabled = bitmap != null, role = Role.Image) { bitmap?.let { onOpen(it, path) } },
                    contentAlignment = Alignment.Center,
                ) {
                    val b = bitmap
                    if (b != null) {
                        Image(b, path.substringAfterLast('/'), contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    } else if (failed) {
                        PiIcon(PiIcons.Image, Pi.c.fg3, 16.dp)
                    } else {
                        Spinner(Pi.c.fg3, 14.dp)
                    }
                }
            }
        }
    }
}

/** 全屏看图：点任意位置关闭，底部显示文件名。 */
@Composable
fun ImagePreviewDialog(bitmap: ImageBitmap, path: String, onDismiss: () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f))
            .clickable(interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, indication = null, onClick = onDismiss),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            bitmap,
            contentDescription = path.substringAfterLast('/'),
            contentScale = ContentScale.Fit,
            modifier = Modifier.padding(16.dp).widthIn(max = 1200.dp),
        )
        Text(
            path.substringAfterLast('/'),
            style = Pi.t.meta.copy(color = Color.White.copy(alpha = 0.85f)),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp, start = 24.dp, end = 24.dp),
        )
    }
}
