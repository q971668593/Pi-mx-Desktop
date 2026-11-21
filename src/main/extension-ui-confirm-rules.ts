import { normalizeSessionFileKey } from '@shared/session-file-key'

/**
 * 「本次会话都允许」：同一会话里同名确认（扩展、权限类提问）不再反复弹。
 *
 * 只存在内存里，随会话销毁；键是「会话 + 标题」，值是真/假。
 * 由确认弹窗上的勾选框写入，Worker 的下一次同类请求直接被主进程应答。
 */
const rules = new Map<string, boolean>()

const keyOf = (sessionFile: string | undefined, title: string): string =>
  `${normalizeSessionFileKey(sessionFile ?? '')}::${title.trim()}`

export function rememberConfirmRule(sessionFile: string | undefined, title: string, confirmed: boolean): void {
  if (!title.trim()) return
  rules.set(keyOf(sessionFile, title), confirmed)
}

export function confirmRuleFor(sessionFile: string | undefined, title: string): boolean | undefined {
  return rules.get(keyOf(sessionFile, title))
}

/** 会话被清掉时一起忘掉规则，避免下次同名确认被静默放行。 */
export function forgetConfirmRules(sessionFile: string): void {
  const prefix = `${normalizeSessionFileKey(sessionFile)}::`
  for (const key of [...rules.keys()]) if (key.startsWith(prefix)) rules.delete(key)
}

export function clearConfirmRules(): void {
  rules.clear()
}
