import { describe, expect, it } from 'vitest'
import { splitTempImagePaths } from './user-message-text'

const winPath = 'C:\\Users\\mashiyi\\AppData\\Roaming\\pi-desktop\\clipboard-images\\pi-clipboard-bcd41995-0b39-4a50-96d8-e49aff4939ab.png'

describe('splitTempImagePaths', () => {
  it('turns a pasted image path into an image part', () => {
    const parts = splitTempImagePaths(`${winPath} 另外还有一件事`)
    expect(parts[0]).toEqual({ kind: 'image', path: winPath })
    expect(parts[1]).toEqual({ kind: 'text', value: ' 另外还有一件事' })
  })

  it('handles image-only messages', () => {
    const parts = splitTempImagePaths(winPath)
    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('image')
  })

  it('handles posix paths', () => {
    const posix = '/home/u/.config/pi-desktop/clipboard-images/pi-clipboard-1.png'
    expect(splitTempImagePaths(`${posix} hi`)[0]).toEqual({ kind: 'image', path: posix })
  })

  it('leaves ordinary text alone', () => {
    const parts = splitTempImagePaths('普通消息，没有图片')
    expect(parts).toEqual([{ kind: 'text', value: '普通消息，没有图片' }])
  })

  it('does not treat workspace images as clipboard temp images', () => {
    const parts = splitTempImagePaths('看 @doc/assets/readme/en/hero-light.png 这张')
    expect(parts).toEqual([{ kind: 'text', value: '看 @doc/assets/readme/en/hero-light.png 这张' }])
  })

  it('finds several images in one message', () => {
    const parts = splitTempImagePaths(`${winPath}\n/home/u/clipboard-images/pi-clipboard-2.webp`)
    expect(parts.filter((part) => part.kind === 'image')).toHaveLength(2)
  })
})
