import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Copy, FileText } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'
import { useUIStore } from '@renderer/stores/ui-store'
import { workspacePathKey } from '@shared/workspace-path'
import { cn } from '@renderer/lib/utils'
import { singleFilePath } from '@renderer/lib/file-path-text'

/**
 * Bare file names (`清单.xlsx`) only exist relative to some directory the assistant had in mind.
 * Resolve them against the workspace index: exactly one match → usable link, otherwise plain text.
 */
const cache = new Map<string, string | null>()
const inFlight = new Map<string, Promise<string | null>>()
const keyOf = (root: string, name: string) => `${workspacePathKey(root)}\u0000${name}`

function resolveOne(root: string, name: string): Promise<string | null> {
  const key = keyOf(root, name)
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null)
  const running = inFlight.get(key)
  if (running) return running
  const request = ipcClient
    .invoke('workspace.fs.resolveFileNames', { workspaceRoot: root, names: [name] })
    .then((res) => {
      const matches: string[] = res?.matches?.[name] ?? []
      const value = matches.length === 1 ? matches[0] : null
      cache.set(key, value)
      return value
    })
    .catch(() => {
      cache.set(key, null)
      return null
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

export function clearResolvedPathCacheForTests(): void {
  cache.clear()
  inFlight.clear()
}

/** Workspace-relative path for a bare file name, or null while unresolved/ambiguous. */
export function useResolvedWorkspacePath(name: string | null): string | null {
  const root = useUIStore((s) => s.currentWorkspace)
  const key = root && name ? keyOf(root, name) : ''
  const [resolved, setResolved] = useState<{ key: string; value: string | null } | null>(null)
  useEffect(() => {
    if (!key || !root || !name) return
    const cached = cache.get(key)
    if (cached !== undefined) {
      setResolved({ key, value: cached })
      return
    }
    let alive = true
    void resolveOne(root, name).then((value) => {
      if (alive) setResolved({ key, value })
    })
    return () => {
      alive = false
    }
  }, [key, root, name])
  if (!key) return null
  return resolved?.key === key ? resolved.value : cache.get(key) ?? null
}

/**
 * Open a file the assistant mentioned: inside the workspace the Files panel is the destination,
 * outside it the OS viewer is (the Files panel cannot read outside the workspace).
 */
export async function openMentionedFile(path: string): Promise<void> {
  const value = singleFilePath(path) ?? path.trim()
  if (!value) return
  if (openWorkspaceRelativePath(value)) return
  const result = await ipcClient.invoke('shell.openPath', { path: value }).catch(() => null)
  if (!result?.ok) throw new Error(result?.error || 'open_failed')
}

type Variant = 'inline' | 'block'

/**
 * A clickable file reference inside assistant output (inline code, code block, table cell).
 * Blue link styling matches markdown links; the whole text stays selectable/copyable.
 */
export function FilePathChip({ text, variant = 'inline', className }: { text: string; variant?: Variant; className?: string }) {
  const { t } = useTranslation('timeline')
  const path = singleFilePath(text)
  const needsResolution = !!path && !/[\\/]/.test(path)
  const resolved = useResolvedWorkspacePath(needsResolution ? path : null)
  const [copied, setCopied] = useState(false)
  if (!path) return <>{text}</>
  // A bare name that resolves to nothing (ambiguous or absent) stays plain text.
  if (needsResolution && !resolved) return <>{text}</>

  const open = () => {
    void openMentionedFile(resolved ?? path).catch(() => toast.error(t('path.openFailed')))
  }
  const copy = (event: React.MouseEvent) => {
    event.stopPropagation()
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (variant === 'block') {
    return (
      <div
        className={cn(
          'group my-2 flex items-center gap-2 overflow-hidden rounded-md border border-border/35 px-2.5 py-1.5',
          className,
        )}
        style={{ background: 'color-mix(in srgb, var(--bg-2) 55%, transparent)' }}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
        <button
          type="button"
          onClick={open}
          title={t('path.openInFiles')}
          className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-primary hover:underline"
        >
          {path}
        </button>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t('copied') : t('copy')}
          title={copied ? t('copied') : t('copy')}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-secondary/50 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      title={t('path.openInFiles')}
      className={cn(
        'mx-0.5 inline rounded px-1 py-px font-mono text-[0.9em] text-primary hover:underline',
        className,
      )}
      style={{ background: 'color-mix(in srgb, var(--brand) 10%, transparent)' }}
    >
      {resolved ? path : text}
    </button>
  )
}
