export type SandboxEntry = {
  id: string
  path: string
  label: string
  createdAt: number
  kind: 'sandbox'
  sessionId?: string
  sessionFile?: string
}

export type SessionItem = {
  sessionId: string
  sessionFile?: string
  parentSessionFile?: string
  /** Source session this one was forked/cloned from (listed flat, not nested). */
  forkedFromSessionFile?: string
  title: string
  firstMessage?: string
  workspaceId?: string
  updatedAt: number
  /** User's newest send time. Sidebar order and "N 分钟前" use this — never the assistant's
   *  last activity, which would keep resetting the label while the agent is still working. */
  lastUserMessageAt?: number
  messageCount?: number
  modelId: string
}

export function diskProjectName(path: string) {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

export function isSandboxPath(path: string) {
  return path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}