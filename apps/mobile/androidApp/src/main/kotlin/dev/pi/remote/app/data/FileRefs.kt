package dev.pi.remote.app.data

import java.net.URLDecoder

/**
 * 从回复文本里挑出可打开的文件引用（Markdown 链接、`file://` URI、项目内相对路径或电脑绝对路径）。
 *
 * 手机上没有"工作目录"的直觉，所以只要看起来像文件、扩展名在白名单里，就做成可点的小卡片与可点链接：
 * 点了走 `file.read`（Markdown 渲染、HTML 交互预览、图片缩放、代码高亮都能一眼打开）。
 */
object FileRefs {
    private val IMAGE_EXTS = setOf("png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif", "ico")
    private val MD_EXTS = setOf("md", "markdown", "mdx")
    private val HTML_EXTS = setOf("html", "htm")
    private val EXTS = listOf(
        "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif", "ico",
        "md", "markdown", "mdx", "html", "htm", "txt", "json", "jsonc", "jsonl", "yaml", "yml", "toml", "ini", "env", "log", "csv",
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "astro", "kt", "kts", "java", "py", "go", "rs", "rb", "php",
        "cs", "c", "h", "cpp", "hpp", "dart", "swift", "ex", "exs",
        "sh", "bash", "ps1", "bat", "sql", "css", "scss", "xml", "gradle", "pdf",
    )
    private val EXT_SET = EXTS.toSet()

    // Markdown links: [label](target) or ![alt](target)
    private val mdLinkPattern = Regex("""!?\[[^\]]*\]\(([^)\r\n]+)\)""")

    // Bare paths (Windows drive, Unix root, or relative path with whitelisted extension)
    private val pathPattern = Regex(
        """((?:[A-Za-z]:[\\/]|/)?[^\s"'`()\[\]<>{},，。；：！？]+?\.(?:${EXTS.joinToString("|")}))""",
        RegexOption.IGNORE_CASE,
    )
    private val trim = charArrayOf('"', '\'', '`', '(', ')', '[', ']', '，', '。', '；', '：', '、', '…', '<', '>', ':')

    fun normalizePath(raw: String): String {
        var s = raw.trim().trim(*trim)
        if (s.isEmpty()) return ""
        // Strip optional markdown link title: path "title"
        if (!s.contains("://") && s.contains(" \"")) s = s.substringBefore(" \"").trim()
        if (s.startsWith("file://", ignoreCase = true)) {
            s = s.removePrefix("file://").removePrefix("FILE://")
            if (s.startsWith("localhost/", ignoreCase = true)) s = s.removePrefix("localhost").removePrefix("LOCALHOST")
            if (s.length >= 3 && s[0] == '/' && s[1].isLetter() && s[2] == ':') s = s.substring(1)
            s = runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrDefault(s)
        }
        s = s.substringBefore('#').substringBefore('?')
        // Strip trailing :line or :line:col while preserving Windows C:\...
        val lineCol = Regex("""^(.{2,}?):\d+(?::\d+)?$""").matchEntire(s)
        if (lineCol != null) s = lineCol.groupValues[1]
        return s.trim(*trim)
    }

    fun isLikelyFileUri(uri: String): Boolean {
        val raw = uri.trim()
        if (raw.isEmpty() || raw.startsWith("#")) return false
        val lower = raw.lowercase()
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:") ||
            lower.startsWith("tel:") || lower.startsWith("geo:") || lower.startsWith("sms:") ||
            lower.startsWith("data:") || lower.startsWith("javascript:")
        ) return false
        if (lower.startsWith("file://")) return true
        if ("://" in raw) return false
        val clean = normalizePath(raw)
        if (clean.isEmpty()) return false
        val ext = clean.substringAfterLast('.', "").lowercase()
        return ext in EXT_SET || '/' in clean || '\\' in clean
    }

    fun find(text: String, max: Int = 8): List<String> {
        val out = LinkedHashSet<String>()
        for (m in mdLinkPattern.findAll(text)) {
            val target = m.groupValues[1].trim()
            if (isLikelyFileUri(target)) {
                val norm = normalizePath(target)
                if (norm.isNotEmpty()) out += norm
            }
            if (out.size >= max) return out.toList()
        }
        for (m in pathPattern.findAll(text)) {
            val raw = m.groupValues[1]
            if (raw.startsWith("http", ignoreCase = true) || raw.startsWith("data:", ignoreCase = true) || raw.contains("://")) continue
            val norm = normalizePath(raw)
            if (norm.isNotEmpty()) out += norm
            if (out.size >= max) break
        }
        return out.toList()
    }

    fun extOf(path: String): String = normalizePath(path).substringAfterLast('.', "").lowercase()

    fun isImage(path: String): Boolean = extOf(path) in IMAGE_EXTS

    fun isMarkdown(path: String): Boolean = extOf(path) in MD_EXTS

    fun isHtml(path: String): Boolean = extOf(path) in HTML_EXTS

    fun isSvg(path: String): Boolean = extOf(path) == "svg"
}
