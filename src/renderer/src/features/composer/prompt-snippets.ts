import { useSyncExternalStore } from 'react'

export interface PromptSnippet {
  id: string
  title: string
  content: string
  titleKey?: string
  contentKey?: string
}

const STORAGE_KEY = 'pi-desktop:prompt-snippets:v1'
const listeners = new Set<() => void>()

export const DEFAULT_PROMPT_SNIPPETS: PromptSnippet[] = [
  {
    id: 'builtin-review',
    title: 'Code review',
    titleKey: 'composer:snippets.defaults.reviewTitle',
    content: 'Review the current changes for bugs, edge cases, and regressions. Keep findings concise and actionable.',
    contentKey: 'composer:snippets.defaults.reviewContent',
  },
  {
    id: 'builtin-root-cause',
    title: 'Root-cause analysis first',
    titleKey: 'composer:snippets.defaults.rootCauseTitle',
    content: 'Analyze the root cause and cite exact file/line evidence before making any edits.',
    contentKey: 'composer:snippets.defaults.rootCauseContent',
  },
  {
    id: 'builtin-commit',
    title: 'Write commit message',
    titleKey: 'composer:snippets.defaults.commitTitle',
    content: 'Summarize the current git diff into a concise Conventional Commits message.',
    contentKey: 'composer:snippets.defaults.commitContent',
  },
  {
    id: 'builtin-tests',
    title: 'Add unit tests',
    titleKey: 'composer:snippets.defaults.testsTitle',
    content: 'Add focused unit tests covering happy paths and edge cases for the modified module, then run them.',
    contentKey: 'composer:snippets.defaults.testsContent',
  },
]

function readStoredSnippets(): PromptSnippet[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw == null) return DEFAULT_PROMPT_SNIPPETS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_PROMPT_SNIPPETS
    return parsed.filter(
      (item): item is PromptSnippet =>
        !!item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.content === 'string',
    )
  } catch {
    return DEFAULT_PROMPT_SNIPPETS
  }
}

let cachedSnippets: PromptSnippet[] = readStoredSnippets()

function commitSnippets(next: PromptSnippet[]): void {
  cachedSnippets = next
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
  } catch {
    /* ignore storage quota errors */
  }
  for (const listener of listeners) listener()
}

export function reloadPromptSnippets(): void {
  cachedSnippets = readStoredSnippets()
  for (const listener of listeners) listener()
}

export function addPromptSnippet(input: { title: string; content: string }): PromptSnippet | null {
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title || !content) return null
  const created: PromptSnippet = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    content,
  }
  commitSnippets([created, ...cachedSnippets])
  return created
}

export function deletePromptSnippet(id: string): void {
  const next = cachedSnippets.filter((s) => s.id !== id)
  if (next.length !== cachedSnippets.length) commitSnippets(next)
}

export function updatePromptSnippet(id: string, input: { title: string; content: string }): boolean {
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title || !content) return false
  const index = cachedSnippets.findIndex((s) => s.id === id)
  if (index < 0) return false
  // Drop i18n keys: an edited snippet becomes a literal user override
  // so it no longer follows locale text.
  const next = [...cachedSnippets]
  next[index] = { ...next[index], title, content, titleKey: undefined, contentKey: undefined }
  commitSnippets(next)
  return true
}

export function resetPromptSnippets(): void {
  commitSnippets(DEFAULT_PROMPT_SNIPPETS)
}

export function usePromptSnippets(): PromptSnippet[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => cachedSnippets,
    () => cachedSnippets,
  )
}
