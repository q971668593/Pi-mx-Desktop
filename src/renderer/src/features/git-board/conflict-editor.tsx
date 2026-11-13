export type ConflictChoice = 'ours' | 'theirs' | 'both'
export type ConflictNode =
  | { kind: 'text'; lines: string[] }
  | { kind: 'conflict'; index: number; oursLabel: string; theirsLabel: string; ours: string[]; theirs: string[] }

const START = /^<{7}(?:\s(.*))?$/
const BASE = /^\|{7}(?:\s(.*))?$/
const MIDDLE = /^={7}$/
const END = /^>{7}(?:\s(.*))?$/

export function parseConflicts(content: string): ConflictNode[] {
  const nodes: ConflictNode[] = []
  let text: string[] = []
  let ours: string[] = []
  let theirs: string[] = []
  let raw: string[] = []
  let open = false
  let side: 'ours' | 'base' | 'theirs' = 'ours'
  let oursLabel = ''
  let index = 0
  const flushText = () => {
    if (text.length) nodes.push({ kind: 'text', lines: text })
    text = []
  }
  for (const line of content.split(/\r?\n/)) {
    if (!open) {
      const start = START.exec(line)
      if (start) {
        flushText()
        open = true
        side = 'ours'
        oursLabel = start[1] || ''
        raw = [line]
      } else text.push(line)
      continue
    }
    raw.push(line)
    if (BASE.test(line)) { side = 'base'; continue }
    if (MIDDLE.test(line)) { side = 'theirs'; continue }
    const end = END.exec(line)
    if (end) {
      flushText()
      nodes.push({ kind: 'conflict', index: index++, oursLabel, theirsLabel: end[1] || '', ours, theirs })
      ours = []
      theirs = []
      raw = []
      open = false
      continue
    }
    if (side === 'ours') ours.push(line)
    else if (side === 'theirs') theirs.push(line)
  }
  if (open) text.push(...raw)
  flushText()
  return nodes
}

export function applyConflictChoices(nodes: ConflictNode[], choices: Map<number, ConflictChoice>) {
  const lines: string[] = []
  let unresolved = 0
  for (const node of nodes) {
    if (node.kind === 'text') {
      lines.push(...node.lines)
      continue
    }
    const choice = choices.get(node.index)
    if (!choice) {
      unresolved += 1
      lines.push(`<<<<<<<${node.oursLabel ? ` ${node.oursLabel}` : ''}`, ...node.ours, '=======', ...node.theirs, `>>>>>>>${node.theirsLabel ? ` ${node.theirsLabel}` : ''}`)
      continue
    }
    lines.push(...(choice === 'ours' ? node.ours : choice === 'theirs' ? node.theirs : [...node.ours, ...node.theirs]))
  }
  return { lines, unresolved }
}
