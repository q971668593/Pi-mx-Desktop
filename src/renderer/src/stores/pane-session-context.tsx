import { createContext, useContext, type ReactNode } from 'react'
import {
  EMPTY_SESSION_STATE,
  selectSessionState,
  selectViewSession,
  sessionKeyOf,
  type SessionState,
} from '@renderer/stores/session-state'
import { useUIStore } from '@renderer/stores/ui-store'

export interface PaneSessionBinding {
  isActive: boolean
  paneId: string
  sessionFile: string | null
  sessionId: string | null
  workspace: string | null
}

const PaneSessionContext = createContext<PaneSessionBinding | null>(null)

export function PaneSessionProvider({
  value,
  children,
}: {
  value: PaneSessionBinding
  children: ReactNode
}) {
  return <PaneSessionContext.Provider value={value}>{children}</PaneSessionContext.Provider>
}

export function usePaneSessionBinding(): PaneSessionBinding | null {
  return useContext(PaneSessionContext)
}

export function useIsActivePane(): boolean {
  return useContext(PaneSessionContext)?.isActive ?? true
}

export function usePaneSessionIdentity() {
  const binding = useContext(PaneSessionContext)
  const isActive = binding?.isActive ?? true
  const storeSessionFile = useUIStore((s) => s.historySessionFile)
  const storeSessionId = useUIStore((s) => s.currentSessionId)
  const storeWorkspace = useUIStore((s) => s.currentWorkspace)
  const storeViewSessionKey = useUIStore((s) => s.viewSessionKey)

  if (isActive) {
    return {
      isActive: true,
      paneId: binding?.paneId ?? 'main',
      sessionFile: storeSessionFile,
      sessionId: storeSessionId,
      workspace: storeWorkspace,
      sessionKey: storeSessionFile
        ? sessionKeyOf(storeSessionFile) || storeViewSessionKey
        : storeViewSessionKey,
    }
  }

  const inactiveFile = binding?.sessionFile ?? null
  return {
    isActive: false,
    paneId: binding!.paneId,
    sessionFile: inactiveFile,
    sessionId: binding?.sessionId ?? null,
    workspace: binding?.workspace ?? null,
    sessionKey: inactiveFile ? sessionKeyOf(inactiveFile) || null : null,
  }
}

export function usePaneSessionState<T>(selector: (session: SessionState) => T): T {
  const binding = useContext(PaneSessionContext)
  const active = binding?.isActive ?? true
  const inactiveFile = active ? null : binding?.sessionFile ?? null
  return useUIStore((s) =>
    selector(active ? selectViewSession(s) : (selectSessionState(s, inactiveFile) ?? EMPTY_SESSION_STATE)),
  )
}
