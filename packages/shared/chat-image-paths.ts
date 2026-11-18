export type ChatImageRef = { path: string; name: string }

const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp)$/i
/**
 * 绝对路径：file URL / 盘符 / UNC / POSIX 根路径。
 * POSIX 分支加了前置断言：开头的 `/` 必须真的在路径开头，否则相对路径的尾巴
 * （`generated-images/a.png` 里的 `/a.png`）会被当成根路径，变成两个错误的 ref。
 */
const IMAGE_PATH =
  /file:\/\/[^\r\n<>|"'`]+?\.(?:png|jpe?g|webp|gif|bmp)\b|(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\r\n<>|"'`]+?\.(?:png|jpe?g|webp|gif|bmp)\b|\\\\[^\r\n<>|"'`]+?\.(?:png|jpe?g|webp|gif|bmp)\b|(?<![.:/\w\\-])\/[^\r\n<>|"'`]*?\.(?:png|jpe?g|webp|gif|bmp)\b/gi
/**
 * 工作区内相对路径（`generated-images/route-plan-a.png`）。
 *
 * 生图工具/`read` 的产出一律是相对路径，旧实现只认绝对路径，于是 AI 生成完的图
 * 在时间线里只有一行「读了 xxx.png」、永远不出现缩略图。
 * 前置断言排除绝对路径/URL 的中间段（`C:\a\b.png` 不会被再认成 `a\b.png`）。
 */
const RELATIVE_IMAGE_PATH =
  /(?<![.:/\\\w-])(?:\.{1,2}[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]+\.(?:png|jpe?g|webp|gif|bmp)\b/gi

function cleanImagePath(value: string): string {
  let path = value.trim().replace(/^["'`(<\[]+|["'`)>,.;:!?\]]+$/g, '')
  if (path.toLowerCase().startsWith('file://')) {
    const raw = path.slice(7)
    try { path = decodeURIComponent(raw) } catch { path = raw }
    if (path.startsWith('/') && /^\/[A-Za-z]:/.test(path)) path = path.slice(1)
    if (/^[A-Za-z]:/.test(path)) path = path.replace(/\//g, '\\')
  }
  return path
}

function imageName(path: string, label?: string): string {
  const fallback = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
  return label?.trim() || fallback
}

export function findChatImageRefs(text: string): ChatImageRef[] {
  const found = new Map<string, ChatImageRef>()
  const add = (value: string, label?: string) => {
    const path = cleanImagePath(value)
    if (!IMAGE_EXTENSION.test(path)) return
    // 先到的优先：markdown 写法带 caption，别被后面的裸路径扫描覆盖掉
    if (!found.has(path)) found.set(path, { path, name: imageName(path, label) })
  }
  // 顺序有意义：markdown（带标题）→ 绝对路径 → 工作区相对路径
  for (const match of text.matchAll(/!\[([^\]\n]{0,240})\]\(([^)\n]+)\)/g)) add(match[2], match[1])
  for (const match of text.matchAll(IMAGE_PATH)) add(match[0])
  for (const match of text.matchAll(RELATIVE_IMAGE_PATH)) add(match[0])
  return [...found.values()]
}

export function findChatImagePaths(text: string): string[] {
  return findChatImageRefs(text).map((item) => item.path)
}

export function plainTextFromNode(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plainTextFromNode).join('')
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: unknown } }).props
    return plainTextFromNode(props?.children)
  }
  return ''
}
