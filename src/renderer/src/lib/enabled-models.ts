import { ipcClient } from '@renderer/lib/ipc-client'
import { minimatch } from 'minimatch'

/** Pi's enabledModels is a shared global model scope. Empty or absent means all models. */
let scope: string[] | undefined
let revision = 0
const listeners = new Set<(value: string[] | undefined) => void>()

export function publishEnabledModels(value: string[] | undefined): void {
  revision++
  scope = value?.length ? [...value] : undefined
  for (const listener of listeners) listener(scope)
}

export function peekEnabledModels(): string[] | undefined { return scope }
export function subscribeEnabledModels(listener: (value: string[] | undefined) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export async function refreshEnabledModels(): Promise<void> {
  const started = revision
  try {
    const res = await ipcClient.invoke('pi.settings.get')
    if (started !== revision || !res?.settings) return
    const raw = (res?.settings as { enabledModels?: unknown } | undefined)?.enabledModels
    publishEnabledModels(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : undefined)
  } catch {
    // Keep the last confirmed selection when settings are temporarily unavailable.
  }
}

/** Resolve scopes against the complete catalog: exact ids first, then Pi-style glob/fuzzy references. */
export function filterEnabledModels<T extends { provider: string; id: string; name?: string }>(models: T[], patterns?: readonly string[]): T[] {
  if (!patterns?.length) return models
  const selected = new Set<T>()
  for (const original of patterns) {
    const text = original.trim()
    if (!text) continue
    const exact = (value: string) => {
      const lower = value.toLowerCase()
      const named = models.filter((m) => `${m.provider}/${m.id}`.toLowerCase() === lower)
      return named.length ? named : models.filter((m) => m.id.toLowerCase() === lower)
    }
    // A model id may itself end in :high; exact references take precedence over thinking suffixes.
    let matches = exact(text)
    const base = text.replace(/:(off|minimal|low|medium|high|xhigh|max)$/i, '')
    if (!matches.length) matches = exact(base)
    if (!matches.length && /[*?[\]]/.test(base)) {
      matches = models.filter((m) => minimatch(`${m.provider}/${m.id}`, base, { nocase: true }) || minimatch(m.id, base, { nocase: true }))
    } else if (!matches.length) {
      const lower = base.toLowerCase()
      const provider = [...new Set(models.map((m) => m.provider))]
        .filter((id) => lower.startsWith(`${id.toLowerCase()}/`))
        .sort((a, b) => b.length - a.length)[0]
      const query = provider ? lower.slice(provider.length + 1) : lower
      const fuzzy = models.filter((m) => (!provider || m.provider === provider) &&
        (m.id.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query)))
      const aliases = fuzzy.filter((m) => m.id.endsWith('-latest') || !/-\d{8}$/.test(m.id))
      const best = [...(aliases.length ? aliases : fuzzy)].sort((a, b) => b.id.localeCompare(a.id))[0]
      if (best) matches = fuzzy.filter((m) => m.id === best.id)
    }
    matches.forEach((m) => selected.add(m))
  }
  return models.filter((model) => selected.has(model))
}
