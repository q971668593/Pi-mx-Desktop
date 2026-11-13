import { useMemo, type ReactNode } from 'react'
import { enrichPlainTextWithPaths } from '@renderer/features/timeline/markdown-inline-paths'
import { ClipboardImageChip } from '@renderer/features/timeline/clipboard-image-chip'

/**
 * 粘贴/拖入的图片在会话文件里只是一条临时路径（`…/clipboard-images/pi-clipboard-*.png`），
 * 历史消息没有结构化 segments，于是气泡里就成了一串路径文字。
 * 这里在渲染时把这类路径切出来，直接画成图片；其余文字仍然走路径增强。
 */
const TEMP_IMAGE_RE = /[^\s"'<>|]*clipboard-images[\\/][^\s"'<>|]+\.(?:png|jpe?g|webp|gif|bmp)/gi

type Part = { kind: 'text'; value: string } | { kind: 'image'; path: string }

function fileName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

export function splitTempImagePaths(text: string): Part[] {
  const parts: Part[] = []
  let last = 0
  const re = new RegExp(TEMP_IMAGE_RE.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push({ kind: 'text', value: text.slice(last, match.index) })
    parts.push({ kind: 'image', path: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) })
  return parts
}

export function UserMessageText({ text }: { text: string }): ReactNode {
  const parts = useMemo(() => splitTempImagePaths(text), [text])
  const hasImage = parts.some((part) => part.kind === 'image')
  if (!hasImage) return <>{enrichPlainTextWithPaths(text)}</>
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'image') {
          return (
            <ClipboardImageChip
              key={`img-${index}`}
              path={part.path}
              name={fileName(part.path)}
              className="mx-0.5"
            />
          )
        }
        // 图片被切走后留下的空白不需要渲染成空文本行
        const value = part.value.replace(/^[\s，,。.；;]+|[\s]+$/g, ' ')
        if (!value.trim()) return null
        return <span key={`txt-${index}`}>{enrichPlainTextWithPaths(value)}</span>
      })}
    </>
  )
}
