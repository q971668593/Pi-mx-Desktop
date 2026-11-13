import { workspacePathKey } from '@shared/workspace-path'

type FileDraft = { original: string; value: string }
const drafts = new Map<string, FileDraft>()
const keyFor = (workspace: string, path: string) => `${workspacePathKey(workspace)}\0${path.replace(/\\/g, '/')}`

export function getFileDraft(workspace: string, path: string): FileDraft | undefined {
  return drafts.get(keyFor(workspace, path))
}

export function putFileDraft(workspace: string, path: string, original: string, value: string): void {
  const key = keyFor(workspace, path)
  if (original === value) drafts.delete(key)
  else drafts.set(key, { original, value })
}

export function clearFileDraft(workspace: string, path: string): void {
  drafts.delete(keyFor(workspace, path))
}

export function moveFileDrafts(workspace: string, oldPath: string, newPath: string): void {
  const oldKey = keyFor(workspace, oldPath)
  const newKey = keyFor(workspace, newPath)
  for (const [key, draft] of drafts) {
    if (key !== oldKey && !key.startsWith(`${oldKey}/`)) continue
    drafts.delete(key)
    drafts.set(`${newKey}${key.slice(oldKey.length)}`, draft)
  }
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', (event) => {
  if (!drafts.size) return
  event.preventDefault()
  event.returnValue = ''
})
