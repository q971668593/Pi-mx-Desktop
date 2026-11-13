export type GraphCommit = { hash: string; parents: string[] }

export type GraphRow<T extends GraphCommit> = {
  commit: T
  lane: number
  passes: number[]
  links: number[]
  columns: number
  fromAbove: boolean
}

export function layoutCommitGraph<T extends GraphCommit>(commits: T[]): Array<GraphRow<T>> {
  let active: string[] = []
  const rows = commits.map((commit) => {
    let lane = active.indexOf(commit.hash)
    const fromAbove = lane >= 0
    if (lane < 0) {
      lane = active.findIndex((item) => !item)
      if (lane < 0) lane = active.length
      active[lane] = commit.hash
    }
    const passes = active.flatMap((item, index) => item && index !== lane ? [index] : [])
    const next = active.slice()
    next[lane] = ''
    const links: number[] = []
    commit.parents.forEach((parent, index) => {
      if (!parent) return
      let target = next.indexOf(parent)
      if (target < 0 && index === 0) target = lane
      if (target < 0) {
        target = next.findIndex((item) => !item)
        if (target < 0) target = next.length
      }
      next[target] = parent
      links.push(target)
    })
    active = next
    while (active.length > 0 && !active[active.length - 1]) active.pop()
    return { commit, lane, passes, links, fromAbove, columns: Math.max(active.length, lane + 1, ...links, ...passes, 1) }
  })
  const columns = rows.reduce((max, row) => Math.max(max, row.columns), 1)
  return rows.map((row) => ({ ...row, columns }))
}
