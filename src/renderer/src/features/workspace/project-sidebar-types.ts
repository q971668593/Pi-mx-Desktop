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
  interruptedAt?: number
  messageCount?: number
  modelId: string
  /** 工作团队开出来的会话：角色会话（role）或派发会话（run）；普通对话没有这个字段。 */
  team?: { role: string; kind: 'role' | 'run' }
}

export function diskProjectName(path: string) {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
  return /^[a-z\d]+(?:[-_][a-z\d]+)+$/i.test(name) ? name.replace(/[-_]/g, ' ') : name
}

export function isSandboxPath(path: string) {
  return path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}
