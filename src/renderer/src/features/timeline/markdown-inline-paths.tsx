import { memo, type ReactNode } from 'react'
import { splitPaths } from '@renderer/lib/file-path-text'
import { FilePathChip } from '@renderer/features/timeline/file-path-chip'

/** Plain text with the file references it mentions turned into links (Files panel on click). */
export const MarkdownPathText = memo(function MarkdownPathText({ text }: { text: string }) {
  const segments = splitPaths(text)
  if (segments.length === 1 && segments[0].kind === 'text') return <>{text}</>
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'path'
          ? <FilePathChip key={`${index}-${segment.path}`} text={segment.path} variant="inline" />
          : <span key={index}>{segment.text}</span>,
      )}
    </>
  )
})

/**
 * Paragraph children are strings only when the text has no inline formatting. Wrap the string
 * runs and leave elements (bold, links, inline code) to their own renderers.
 */
export function enrichChildrenWithPaths(children: ReactNode): ReactNode {
  if (typeof children === 'string') return <MarkdownPathText text={children} />
  if (!Array.isArray(children)) return children
  return children.map((child, index) =>
    typeof child === 'string' ? <MarkdownPathText key={index} text={child} /> : child,
  )
}

export function enrichPlainTextWithPaths(text: string): ReactNode {
  return <MarkdownPathText text={text} />
}
