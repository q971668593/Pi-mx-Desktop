package dev.pi.remote.app.ui.session

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color as AColor
import android.util.Base64
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.pi.remote.R
import dev.pi.remote.app.data.FileRefs
import dev.pi.remote.app.data.MediaExport
import dev.pi.remote.app.data.RemoteRepository
import dev.pi.remote.app.theme.Pi
import dev.pi.remote.app.theme.PiIcon
import dev.pi.remote.app.theme.PiIcons
import dev.pi.remote.app.ui.Hairline
import dev.pi.remote.app.ui.IconAction
import dev.pi.remote.app.ui.PiUriHandler
import dev.pi.remote.app.ui.QuietButton
import dev.pi.remote.app.ui.Segmented
import dev.pi.remote.app.ui.Spinner
import dev.pi.remote.app.ui.rich.MermaidSource
import dev.pi.remote.app.ui.rich.RichContent
import dev.pi.remote.app.ui.rich.highlight
import dev.pi.remote.protocol.FileReadResult
import kotlin.math.roundToInt
import androidx.compose.ui.res.stringResource

private const val MAX_RICH_MD_CHARS = 120_000

/**
 * 全屏文件查看器：
 * - Markdown (`.md`/`.markdown`/`.mdx`) 默认渲染完整排版 + Mermaid + 公式，可切换源码，文档内链接可继续点开；
 * - HTML (`.html`/`.htm`) 使用支持 JS 与缩放的安全 WebView 交互预览，可切换高亮源码；
 * - 图片（PNG/JPG/WebP/GIF/BMP/SVG/AVIF）支持双指/双击缩放、拖动、长按/按钮保存到相册与分享；
 * - 其余文本/代码按语言做轻量语法高亮并支持选中复制。
 */
@Composable
fun FilePreviewSheet(
    repo: RemoteRepository,
    sessionKey: String,
    path: String,
    mermaid: MermaidSource? = null,
    onOpenLink: (String) -> Unit = {},
    onQuote: ((String) -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    var file by remember(path) { mutableStateOf<FileReadResult?>(null) }
    var failed by remember(path) { mutableStateOf(false) }
    var retryTick by remember(path) { mutableIntStateOf(0) }
    var viewMode by remember(path) { mutableStateOf("preview") }
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    LaunchedEffect(path, retryTick) {
        failed = false
        val r = repo.readFile(sessionKey, path)
        file = r.getOrNull()
        failed = file == null
    }

    val f = file
    val displayPath = f?.path ?: path
    val isRichDoc = f != null && (
        (f.kind == "text" && (FileRefs.isMarkdown(displayPath) || FileRefs.isHtml(displayPath) || FileRefs.isSvg(displayPath))) ||
            (f.kind == "image" && FileRefs.isSvg(displayPath))
        )
    val bitmap = remember(f?.kind, f?.data, displayPath) {
        if (f?.kind == "image" && !FileRefs.isSvg(displayPath) && f.data != null) {
            runCatching {
                val bytes = Base64.decode(f.data, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }.getOrNull()
        } else null
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Pi.c.bg).systemBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 6.dp, end = 6.dp, top = 2.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(PiIcons.X, stringResource(R.string.close), onDismiss)
                Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                    Text(
                        displayPath.substringAfterLast('/').substringAfterLast('\\'),
                        style = Pi.t.bodyMedium.copy(color = Pi.c.fg),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val metaText = if (f != null) {
                        buildString {
                            append(formatFileSize(f.size))
                            if (f.truncated) append(" · ").append(stringResource(R.string.projfiles_truncated))
                            append(" · ").append(displayPath)
                        }
                    } else displayPath
                    Text(metaText, style = Pi.t.meta.copy(color = Pi.c.fg3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (isRichDoc) {
                    Segmented(
                        listOf("preview" to stringResource(R.string.file_preview_mode), "source" to stringResource(R.string.file_source_mode)),
                        viewMode,
                        { viewMode = it },
                    )
                }
                if (onQuote != null) {
                    IconAction(PiIcons.At, stringResource(R.string.file_quote), {
                        onQuote(displayPath)
                        android.widget.Toast.makeText(context, R.string.file_quoted_toast, android.widget.Toast.LENGTH_SHORT).show()
                    })
                }
                val fileText = f?.text
                if (f?.kind == "text" && fileText != null) {
                    IconAction(PiIcons.Copy, stringResource(R.string.copy), { clipboard.setText(AnnotatedString(fileText)) })
                    IconAction(PiIcons.Share, stringResource(R.string.msg_share), { shareText(context, fileText) })
                } else if (bitmap != null) {
                    IconAction(PiIcons.Share, stringResource(R.string.image_share), {
                        MediaExport.shareBitmap(context, bitmap, displayPath.substringAfterLast('/').substringAfterLast('\\'))
                    })
                }
            }
            Hairline()
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    f == null && !failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner(Pi.c.fg3, 20.dp) }
                    f == null -> Column(
                        Modifier.fillMaxSize().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(stringResource(R.string.file_open_failed), style = Pi.t.body.copy(color = Pi.c.fg2))
                        Spacer(Modifier.padding(top = 8.dp))
                        QuietButton(stringResource(R.string.file_retry), { retryTick++ })
                    }
                    else -> RichFileContent(
                        file = f,
                        viewMode = viewMode,
                        mermaid = mermaid,
                        bitmap = bitmap,
                        onOpenFileLink = { target ->
                            val norm = FileRefs.normalizePath(target)
                            if (norm.isNotEmpty()) onOpenLink(norm)
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }
}

/**
 * 可复用的富文件渲染体：供全屏查看器、`FilesTab` 与 `FilesSheet` 共用。
 */
@Composable
fun RichFileContent(
    file: FileReadResult,
    viewMode: String = "preview",
    mermaid: MermaidSource? = null,
    bitmap: Bitmap? = null,
    onOpenFileLink: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val path = file.path
    val previewMode = viewMode == "preview"
    val isSvg = FileRefs.isSvg(path)
    val isMd = file.kind == "text" && FileRefs.isMarkdown(path)
    val isHtml = file.kind == "text" && FileRefs.isHtml(path)

    when {
        isSvg && previewMode -> {
            val svgText = remember(file.kind, file.text, file.data) {
                when {
                    file.kind == "text" -> file.text
                    file.kind == "image" && file.data != null -> runCatching { String(Base64.decode(file.data, Base64.DEFAULT), Charsets.UTF_8) }.getOrNull()
                    else -> null
                }
            }
            if (svgText != null) {
                val isDark = Pi.c.dark
                val htmlDoc = remember(svgText, isDark) {
                    val bg = if (isDark) "#141416" else "#ffffff"
                    """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"><style>html,body{margin:0;padding:16px;min-height:100vh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:$bg}svg{max-width:100%;height:auto}</style></head><body>$svgText</body></html>"""
                }
                HtmlFileWebView(htmlDoc, modifier.fillMaxSize())
            } else {
                Text(stringResource(R.string.projfiles_image_failed), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
            }
        }
        isSvg && file.kind == "text" -> {
            CodeSourceView(file.text.orEmpty(), "xml", modifier)
        }
        file.kind == "image" -> {
            val decoded = bitmap ?: remember(file.data) {
                file.data?.let {
                    runCatching {
                        val bytes = Base64.decode(it, Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    }.getOrNull()
                }
            }
            if (decoded != null) {
                Column(modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        ZoomableFileBitmap(decoded, path)
                    }
                    Hairline()
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val fileName = path.substringAfterLast('/').substringAfterLast('\\')
                        TextButton(onClick = {
                            val uri = MediaExport.saveToGallery(context, decoded, fileName)
                            if (uri != null) android.widget.Toast.makeText(context, R.string.image_saved, android.widget.Toast.LENGTH_SHORT).show()
                        }) { Text(stringResource(R.string.image_save)) }
                        TextButton(onClick = { MediaExport.shareBitmap(context, decoded, fileName) }) {
                            Text(stringResource(R.string.image_share))
                        }
                        Spacer(Modifier.weight(1f))
                        Text(stringResource(R.string.image_longpress_hint), style = Pi.t.meta.copy(color = Pi.c.fg3))
                    }
                }
            } else {
                Text(stringResource(R.string.projfiles_image_failed), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
            }
        }
        isHtml && previewMode -> {
            val html = remember(file.text) { ensureMobileHtml(file.text.orEmpty()) }
            HtmlFileWebView(html, modifier.fillMaxSize())
        }
        isMd && previewMode -> {
            val text = file.text.orEmpty()
            if (text.length > MAX_RICH_MD_CHARS) {
                Column(modifier.fillMaxSize()) {
                    Text(
                        stringResource(R.string.file_too_large_preview),
                        style = Pi.t.meta.copy(color = Pi.c.fg3),
                        modifier = Modifier.fillMaxWidth().background(Pi.c.surface).padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                    CodeSourceView(text, "markdown", Modifier.weight(1f).fillMaxWidth())
                }
            } else {
                val uriHandler = remember(context, onOpenFileLink) {
                    PiUriHandler(context) { raw ->
                        if (FileRefs.isLikelyFileUri(raw)) {
                            onOpenFileLink(raw)
                            true
                        } else false
                    }
                }
                CompositionLocalProvider(LocalUriHandler provides uriHandler) {
                    SelectionContainer(modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 16.dp)) {
                            RichContent(text, streaming = false, mermaid = mermaid)
                        }
                    }
                }
            }
        }
        file.kind == "text" -> {
            val lang = remember(path) { FileRefs.extOf(path) }
            CodeSourceView(file.text.orEmpty(), lang, modifier)
        }
        else -> {
            Text(stringResource(R.string.projfiles_binary), style = Pi.t.meta.copy(color = Pi.c.fg3), modifier = Modifier.padding(20.dp))
        }
    }
}

@Composable
private fun CodeSourceView(text: String, language: String, modifier: Modifier = Modifier) {
    val tokens = Pi.c
    val highlighted = remember(text, language, tokens) { highlight(text, language, tokens) }
    SelectionContainer(modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Text(highlighted, style = Pi.t.monoSmall.copy(color = Pi.c.fg), softWrap = false)
        }
    }
}

private fun ensureMobileHtml(raw: String): String {
    if (raw.contains("name=\"viewport\"", ignoreCase = true) || raw.contains("name='viewport'", ignoreCase = true)) return raw
    val vp = "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    val headIdx = raw.indexOf("<head>", ignoreCase = true)
    if (headIdx >= 0) return raw.substring(0, headIdx + 6) + vp + raw.substring(headIdx + 6)
    return "<!doctype html><html><head><meta charset=\"utf-8\">$vp</head><body>$raw</body></html>"
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun HtmlFileWebView(html: String, modifier: Modifier = Modifier) {
    if (LocalInspectionMode.current) {
        Box(modifier.background(Pi.c.surface))
        return
    }
    val pageKey = remember(html) { html.hashCode() }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                setBackgroundColor(AColor.TRANSPARENT)
                settings.javaScriptEnabled = true
                // Allow CDN scripts/styles (e.g. Tailwind/Chart.js in prototypes) while blocking local file/content access.
                settings.blockNetworkLoads = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = true
                settings.setGeolocationEnabled(false)
                settings.builtInZoomControls = true
                settings.displayZoomControls = false
                settings.useWideViewPort = true
                settings.loadWithOverviewMode = true
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                }
            }
        },
        update = { view ->
            if (view.tag != pageKey) {
                view.tag = pageKey
                view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
            }
        },
        onRelease = { it.destroy() },
    )
}

@Composable
private fun ZoomableFileBitmap(bitmap: Bitmap, path: String) {
    val context = LocalContext.current
    var scale by remember(path) { mutableFloatStateOf(1f) }
    var offset by remember(path) { mutableStateOf(Offset.Zero) }
    var boxSize by remember { mutableStateOf(IntSize.Zero) }

    fun clamp(o: Offset, s: Float): Offset {
        val maxX = (boxSize.width * (s - 1)) / 2f
        val maxY = (boxSize.height * (s - 1)) / 2f
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }

    Box(
        Modifier.fillMaxSize()
            .onSizeChanged { boxSize = it }
            .pointerInput(path, bitmap) {
                detectTapGestures(
                    onDoubleTap = {
                        if (scale > 1.05f) {
                            scale = 1f
                            offset = Offset.Zero
                        } else {
                            scale = 2.5f
                        }
                    },
                    onLongPress = {
                        val uri = MediaExport.saveToGallery(context, bitmap, path.substringAfterLast('/').substringAfterLast('\\'))
                        if (uri != null) android.widget.Toast.makeText(context, R.string.image_saved, android.widget.Toast.LENGTH_SHORT).show()
                    },
                )
            }
            .pointerInput(path) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val zoom = event.calculateZoom()
                        val pan = event.calculatePan()
                        if (zoom != 1f || scale > 1.01f) {
                            val nextScale = (scale * zoom).coerceIn(1f, 5f)
                            scale = nextScale
                            offset = if (nextScale <= 1.01f) Offset.Zero else clamp(offset + pan, nextScale)
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Image(
            bitmap.asImageBitmap(),
            contentDescription = path,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().padding(12.dp).graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
        )
    }
}

private fun formatFileSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> "${(bytes / (1024.0 * 1024.0) * 10).roundToInt() / 10.0} MB"
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}

/** 回复正文下面的文件小卡片：自动换行，最多 6 个，点开就是全屏 [FilePreviewSheet]。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FileRefChips(paths: List<String>, onOpen: (String) -> Unit) {
    if (paths.isEmpty()) return
    FlowRow(
        Modifier.fillMaxWidth().padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (path in paths.take(6)) {
            val isImg = FileRefs.isImage(path)
            val isMd = FileRefs.isMarkdown(path)
            val isHtml = FileRefs.isHtml(path)
            val tag = when {
                isMd -> "MD"
                isHtml -> "HTML"
                isImg -> null
                else -> FileRefs.extOf(path).uppercase().takeIf { it.isNotEmpty() && it.length <= 4 }
            }
            Row(
                Modifier.heightIn(min = 34.dp).clip(RoundedCornerShape(Pi.radius)).background(Pi.c.surface)
                    .border(1.dp, Pi.c.line, RoundedCornerShape(Pi.radius))
                    .clickable(role = Role.Button) { onOpen(path) }.padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PiIcon(if (isImg) PiIcons.Image else PiIcons.File, if (isMd || isHtml) Pi.c.blue else Pi.c.fg3, 13.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    path.substringAfterLast('/').substringAfterLast('\\'),
                    style = Pi.t.meta.copy(color = Pi.c.fg),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (tag != null) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        tag,
                        style = Pi.t.small.copy(color = if (isMd || isHtml) Pi.c.blue else Pi.c.fg3),
                        maxLines = 1,
                    )
                }
            }
        }
    }
}
