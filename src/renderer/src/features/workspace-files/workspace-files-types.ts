export type FsEntry = {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  mtimeMs?: number
}

export const PI_FILE_PATH_MIME = 'application/x-pi-file-path'

export function setPiFilePathDrag(dt: DataTransfer, path: string, name: string, isDirectory = false) {
  dt.setData(PI_FILE_PATH_MIME, JSON.stringify({ path, name, isDirectory }))
  dt.setData('text/plain', path)
  dt.effectAllowed = 'copy'
}

export function readPiFilePathDrop(
  dt: DataTransfer,
): { path: string; name: string; isDirectory: boolean } | null {
  const raw = dt.getData(PI_FILE_PATH_MIME)
  if (raw) {
    try {
      const o = JSON.parse(raw) as { path?: string; name?: string; isDirectory?: boolean }
      if (o.path)
        return {
          path: o.path,
          name: o.name || o.path.split(/[\\/]/).pop() || o.path,
          isDirectory: o.isDirectory === true,
        }
    } catch (e) {
      /* fall through */
    }
  }
  // 系统资源管理器 / Finder 拖进来时只有 uri-list：转成路径再走同一套「作为引用插入」的逻辑
  const uri = dt
    .getData('text/uri-list')
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))
  if (uri?.toLowerCase().startsWith('file://')) {
    const path = decodeFileUri(uri)
    if (path) return { path, name: path.split(/[\\/]/).pop() || path, isDirectory: false }
  }
  const plain = dt.getData('text/plain')?.trim()
  if (plain && (plain.includes('/') || plain.includes('\\'))) {
    const name = plain.split(/[\\/]/).pop() || plain
    return { path: plain, name, isDirectory: false }
  }
  return null
}

/** `file:///C:/a/b.png` / `file:///home/u/a.png` → 本地路径。 */
function decodeFileUri(uri: string): string {
  const raw = uri.slice('file://'.length)
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    /* keep raw */
  }
  // Windows: `/C:/a` → `C:/a`
  if (/^\/[A-Za-z]:/.test(decoded)) return decoded.slice(1)
  return decoded
}