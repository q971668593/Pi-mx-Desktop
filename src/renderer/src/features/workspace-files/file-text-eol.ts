/**
 * CodeMirror 的文档只保留 `\n`（`Text.of(value.split(/\r\n?|\n/))`），所以 CRLF 文件
 * 一进编辑器文本就变成 LF。判断"用户是否真的改过"必须忽略换行差异，否则打开编辑模式
 * 什么都没改也会标成未保存。
 */
export function normalizeEol(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

/** 保存时沿用原文件的换行风格，避免只改一个字就把整个 CRLF 文件重写成 LF。 */
export function withEolOf(source: string, text: string): string {
  if (!source.includes('\r\n') || text.includes('\r')) return text
  return text.replace(/\n/g, '\r\n')
}
