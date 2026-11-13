import { useCallback, useEffect, useMemo, useState } from 'react'
import { workspacePathKey } from '@shared/workspace-path'
import { getFileDraft } from './file-edit-guard'

export type PreviewTab = {
  id: string
  rel: string
  name: string
  pinned?: boolean
}

function nextTabId() {
  return `ft-${crypto.randomUUID()}`
}

export function useFilePreviewTabs(workspace: string | null) {
  const storageKey = `pi-desktop:file-tabs:${workspacePathKey(workspace)}`
  const [initial] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}') as { tabs?: PreviewTab[]; activeId?: string }
      return { tabs: Array.isArray(stored.tabs) ? stored.tabs.filter((tab) => typeof tab.id === 'string' && typeof tab.rel === 'string' && typeof tab.name === 'string') : [], activeId: stored.activeId || null }
    } catch { return { tabs: [] as PreviewTab[], activeId: null } }
  })
  const [tabs, setTabs] = useState<PreviewTab[]>(initial.tabs)
  const [activeId, setActiveId] = useState<string | null>(initial.activeId)

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ tabs, activeId })) } catch { void 0 }
  }, [storageKey, tabs, activeId])

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId])

  const openFile = useCallback((rel: string, name: string, _mode: 'replace' | 'new-tab') => {
    setTabs((prev) => {
        const hit = prev.find((t) => t.rel === rel)
        if (hit) {
          setActiveId(hit.id)
          return prev
        }
        const id = nextTabId()
        setActiveId(id)
        const unpinned = prev.filter((tab) => !tab.pinned)
        const evicted = unpinned.length >= 5 ? unpinned.find((tab) => !workspace || !getFileDraft(workspace, tab.rel))?.id : null
        return [...prev.filter((tab) => tab.id !== evicted), { id, rel, name }]
    })
  }, [workspace])

  const togglePin = useCallback((id: string) => {
    setTabs((prev) => prev.map((tab) => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab))
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx < 0) return prev
      const next = prev.filter((t) => t.id !== id)
      if (activeId === id) {
        const neighbor = next[Math.min(idx, next.length - 1)]
        setActiveId(neighbor?.id ?? null)
      }
      return next
    })
  }, [activeId])

  const activateTab = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const reorderTabs = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId)
      const to = prev.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const renameTabRel = useCallback((oldRel: string, newRel: string, newName: string) => {
    setTabs((prev) => prev.map((tab) => tab.rel === oldRel ? { ...tab, rel: newRel, name: newName } : tab.rel.startsWith(`${oldRel}/`) ? { ...tab, rel: `${newRel}${tab.rel.slice(oldRel.length)}` } : tab))
  }, [])

  const resetTabs = useCallback(() => {
    setTabs([])
    setActiveId(null)
  }, [])

  return {
    tabs,
    activeId,
    activeTab,
    openFile,
    closeTab,
    activateTab,
    reorderTabs,
    togglePin,
    renameTabRel,
    resetTabs,
  }
}
