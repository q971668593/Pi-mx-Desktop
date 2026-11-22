import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

function extractUserMarkdown(item: TimelineItem): string {
  const raw = String(item.text ?? '').trim()
  if (raw) return raw
  if (Array.isArray(item.segments)) {
    return item.segments
      .map((seg) => {
        if (seg.type === 'text') return seg.text
        if (seg.type === 'clipboard-image') return `![${seg.name}]`
        if (seg.type === 'file') return `@${seg.attachment.path || seg.attachment.name}`
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

export function formatTimelineAsMarkdown(
  items: TimelineItem[],
  opts?: { title?: string; includeTools?: boolean },
): string {
  const sections: string[] = []
  if (opts?.title?.trim()) {
    sections.push(`# ${opts.title.trim()}`)
  }

  for (const item of items) {
    if (item.type === 'user-message') {
      const body = extractUserMarkdown(item)
      if (body) sections.push(`## User\n\n${body}`)
    } else if (item.type === 'assistant-message') {
      const body = String(item.text ?? '').trim()
      if (body) sections.push(`## Assistant\n\n${body}`)
    } else if (opts?.includeTools && item.type === 'tool-call') {
      const name = String(item.toolName || 'tool')
      sections.push(`> Tool: \`${name}\``)
    }
  }

  return sections.join('\n\n')
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  return cleaned || 'conversation'
}

export async function exportCurrentSessionMarkdown(mode: 'copy' | 'download'): Promise<boolean> {
  const st = useUIStore.getState()
  const activeSession = st.sessions.find(
    (s) =>
      (st.historySessionFile && sessionFilesEqual(s.sessionFile, st.historySessionFile)) ||
      (st.currentSessionId && s.sessionId === st.currentSessionId),
  )
  const title = activeSession?.title || activeSession?.firstMessage || undefined
  const md = formatTimelineAsMarkdown(st.timelineItems, { title, includeTools: false })
  if (!md.trim()) {
    toast.warning(i18n.t('common:commandPalette.exportEmpty'))
    return false
  }

  if (mode === 'copy') {
    try {
      await navigator.clipboard.writeText(md)
      toast.success(i18n.t('common:commandPalette.exportedCopy'))
      return true
    } catch {
      toast.error(i18n.t('common:commandPalette.exportFailed'))
      return false
    }
  }

  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFilename(title || 'conversation')}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(i18n.t('common:commandPalette.exportedFile'))
    return true
  } catch {
    toast.error(i18n.t('common:commandPalette.exportFailed'))
    return false
  }
}
