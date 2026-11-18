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

  it('finds workspace-relative paths, which is what image tools and read return', () => {
    // 现场：生图工具写到 generated-images/route-plan-a.png，时间线里只有一行「读了 …」没有图
    expect(findChatImagePaths('三张示意草图好了：generated-images/route-plan-a.png')).toEqual([
      'generated-images/route-plan-a.png',
    ])
    expect(findChatImagePaths('./docs/img/a.webp 和 web/src/assets/b.PNG')).toEqual([
      './docs/img/a.webp',
      'web/src/assets/b.PNG',
    ])
  })

  it('does not invent extra relative refs inside absolute paths, and leaves URLs to markdown', () => {
    expect(findChatImagePaths('C:\\art\\poster.png')).toEqual(['C:\\art\\poster.png'])
    expect(findChatImagePaths('/home/u/out/a.png')).toEqual(['/home/u/out/a.png'])
    // 远程图由 markdown 的 <img> 渲染；当成工作区文件去读只会得到一张坏卡片
    expect(findChatImagePaths('https://cdn.example.com/x/a.png')).toEqual([])
  })

  it('keeps the markdown caption when the same path is scanned again as a bare path', () => {
    const refs = findChatImageRefs('![三张排版图](generated-images/route-plan-a.png)')
    expect(refs).toEqual([{ path: 'generated-images/route-plan-a.png', name: '三张排版图' }])
  })
})
