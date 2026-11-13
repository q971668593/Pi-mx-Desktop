import { describe, expect, it } from 'vitest'
import { findChatImagePaths, findChatImageRefs, plainTextFromNode } from './chat-image-paths'

describe('chat image paths', () => {
  it('keeps generated paths with spaces and file URLs', () => {
    const text = [
      'Generated with model, saved to:',
      '- C:\\Users\\demo\\generated-images\\my poster.png',
      '- file:///C:/Users/demo/a%20b.webp',
      'See /tmp/my poster.gif too.',
    ].join('\n')
    expect(findChatImagePaths(text)).toEqual([
      'C:\\Users\\demo\\generated-images\\my poster.png',
      'C:\\Users\\demo\\a b.webp',
      '/tmp/my poster.gif',
    ])
  })

  it('uses a markdown label and collects text from mixed nodes', () => {
    const refs = findChatImageRefs('![Festival poster](C:\\art\\poster.png)')
    expect(refs).toEqual([{ path: 'C:\\art\\poster.png', name: 'Festival poster' }])
    expect(plainTextFromNode(['Saved ', { props: { children: 'C:\\art\\poster.png' } }])).toBe('Saved C:\\art\\poster.png')
  })
})
