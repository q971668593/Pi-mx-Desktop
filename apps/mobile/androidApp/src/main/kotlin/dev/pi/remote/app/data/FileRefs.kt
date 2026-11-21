package dev.pi.remote.app.data

/**
 * 从回复文本里挑出可打开的文件引用（项目内相对路径或绝对路径）。
 *
 * 手机上没有"工作目录"的直觉，所以只要看起来像文件、扩展名在白名单里，就做成可点的小卡片：
 * 点了走 `file.read`（文本/图片都能看），生成的海报、说明文档、日志都能一眼打开。
 */
object FileRefs {
    private val EXTS = listOf(
        "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif",
        "md", "markdown", "txt", "json", "jsonl", "yaml", "yml", "toml", "ini", "env", "log", "csv",
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "kt", "kts", "java", "py", "go", "rs", "rb", "php", "cs", "c", "h", "cpp", "hpp",
        "sh", "bash", "ps1", "bat", "sql", "html", "css", "scss", "xml", "gradle",
    )
    private val pattern = Regex(
        """((?:[A-Za-z]:[\/])?[^\s"'`()\[\]<>{},，。；：！？]+?\.(?:${EXTS.joinToString("|")}))""",
        RegexOption.IGNORE_CASE,
    )
    private val trim = charArrayOf('"', '\'', '`', '(', ')', '[', ']', '，', '。', '；', '：', '、', '…', '<', '>', ':')

    fun find(text: String, max: Int = 4): List<String> =
        pattern.findAll(text)
            .map { it.groupValues[1].trim(*trim) }
            .filter { it.isNotEmpty() && !it.startsWith("http") && !it.startsWith("data:") && !it.contains("://") }
            .distinct()
            .take(max)
            .toList()

    fun isImage(path: String): Boolean = path.substringAfterLast('.', "").lowercase() in setOf("png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif")
}
