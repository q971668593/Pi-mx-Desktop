import { useUIStore } from '@renderer/stores/ui-store'

/** Formats a message excerpt as a blockquote ready for follow-up in the composer. */
export function formatQuotedReply(text: string): string {
  const cleaned = text.trim()
  if (!cleaned) return ''
  return `${cleaned
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\n`
}

/** Places text into the composer (appending by default) without modifying session capabilities. */
export function insertTextIntoComposer(text: string, mode: 'append' | 'replace' = 'append'): void {
  if (!text) return
  useUIStore.setState({
    browserChatExpand: false,
    filesPreviewChatExpand: false,
    composerPrefill: text,
    composerPrefillMode: mode,
  })
}
