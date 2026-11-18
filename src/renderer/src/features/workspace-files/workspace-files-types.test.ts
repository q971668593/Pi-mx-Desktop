import { describe, expect, it } from 'vitest'
import { PI_FILE_PATH_MIME, readPiFilePathDrop, setPiFilePathDrag } from './workspace-files-types'

function dataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const store = new Map(Object.entries(initial))
  return {
    // types 是只读的实时视图（和浏览器一致）：setData 之后立刻能读到
    get types() {
      return [...store.keys()]
    },
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
  } as unknown as DataTransfer
}

describe('file tree drag payload', () => {
  it('round-trips a file and a folder through the app-internal drag', () => {
    const file = dataTransfer()
    setPiFilePathDrag(file, 'C:/proj/src/a.ts', 'a.ts', false)
    expect(readPiFilePathDrop(file)).toEqual({ path: 'C:/proj/src/a.ts', name: 'a.ts', isDirectory: false })

    const dir = dataTransfer()
    setPiFilePathDrag(dir, 'C:/proj/docs', 'docs', true)
    expect(readPiFilePathDrop(dir)).toEqual({ path: 'C:/proj/docs', name: 'docs', isDirectory: true })
  })

  it('accepts the uri-list an OS drag leaves behind when no custom MIME is present', () => {
    const uriList = dataTransfer({
      'text/uri-list': '# comment\r\nfile:///C:/proj/out/route-plan-a.png\r\n',
    })
    expect(readPiFilePathDrop(uriList)).toEqual({
      path: 'C:/proj/out/route-plan-a.png',
      name: 'route-plan-a.png',
      isDirectory: false,
    })

    const posix = dataTransfer({ 'text/uri-list': 'file:///home/u/out/a.png' })
    expect(readPiFilePathDrop(posix)?.path).toBe('/home/u/out/a.png')
  })

  it('decodes percent-encoded uris and ignores plain text that is not a path', () => {
    const encoded = dataTransfer({ 'text/uri-list': 'file:///C:/proj/my%20poster.png' })
    expect(readPiFilePathDrop(encoded)?.path).toBe('C:/proj/my poster.png')

    const text = dataTransfer({ 'text/plain': 'just some words' })
    expect(readPiFilePathDrop(text)).toBeNull()
    // 自研 MIME 缺失但 text/plain 是绝对路径时仍可用
    const plainPath = dataTransfer({ 'text/plain': 'C:/proj/a.ts' })
    expect(readPiFilePathDrop(plainPath)?.path).toBe('C:/proj/a.ts')
    expect(PI_FILE_PATH_MIME).toBe('application/x-pi-file-path')
  })
})
