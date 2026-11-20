import { workspacePathsEqual } from './workspace-path'

/**
 * 侧栏项目（MRU）列表上限。
 *
 * 历史上这里是 10，于是打开第 11 个项目时最老的一个被静默丢掉——用户看到的就是
 * “重启/更新后项目莫名少了一个”。项目列表属于用户资产，宁可变长也别悄悄截断；
 * 40 已经远超侧栏可用性，同时还能防止配置无限膨胀。
 */
export const RECENT_PROJECTS_CAP = 40

/** 只截断，不去重（给“恢复项目/写回设置”这类已有列表用）。 */
export function capRecentProjects(list: string[]): string[] {
  return list.length > RECENT_PROJECTS_CAP ? list.slice(0, RECENT_PROJECTS_CAP) : list
}

/**
 * 计算 addRecentProject 之后的新列表。
 * fixedOrder=true：顺序固定，已有项目保持不变，新项目追加到末尾（超出上限时丢弃最旧的）；
 * fixedOrder=false（默认）：最近使用优先，项目移到最前（超出上限时丢弃最旧的）。
 */
export function nextRecentProjects(recent: string[], path: string, fixedOrder: boolean): string[] {
  const list = Array.isArray(recent) ? recent : []
  if (fixedOrder) {
    if (list.some((p) => workspacePathsEqual(p, path))) return list
    return [...list, path].slice(-RECENT_PROJECTS_CAP)
  }
  const next = list.filter((p) => !workspacePathsEqual(p, path))
  next.unshift(path)
  return next.slice(0, RECENT_PROJECTS_CAP)
}
