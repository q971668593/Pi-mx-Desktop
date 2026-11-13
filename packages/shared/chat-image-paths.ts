export type ChatImageRef = { path: string; name: string }

const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp)$/i
const IMAGE_PATH = /(?:file:\/\/|\b[A-Za-z]:[\/\\]|\\\\|\/)(?:[^\r\n<>|"'`])+?\.(?:png|jpe?g|webp|gif|bmp)\b/gi

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
    if (IMAGE_EXTENSION.test(path)) found.set(path, { path, name: imageName(path, label) })
  }
  for (const match of text.matchAll(IMAGE_PATH)) add(match[0])
  for (const match of text.matchAll(/!\[([^\]\n]{0,240})\]\(([^)\n]+)\)/g)) add(match[2], match[1])
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
