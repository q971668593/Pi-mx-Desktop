import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Folder } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'

export type GitChangeTreeFile = { path: string }

type ChangeTreeNode = {
  name: string
  path: string
  directory: boolean
  file?: GitChangeTreeFile
  children: Map<string, ChangeTreeNode>
}

function makeTree(files: GitChangeTreeFile[]): ChangeTreeNode[] {
  const root = new Map<string, ChangeTreeNode>()
  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/').filter(Boolean)
    let level = root
    let path = ''
    parts.forEach((name, index) => {
      path = path ? `${path}/${name}` : name
      const directory = index < parts.length - 1
      let node = level.get(name)
      if (!node) {
        node = { name, path, directory, children: new Map() }
        level.set(name, node)
      }
      if (directory) level = node.children
      else node.file = file
    })
  }
  const sort = (nodes: Map<string, ChangeTreeNode>) =>
    [...nodes.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return sort(root)
}

export function GitChangesTree({
  files,
  renderFile,
  renderFolderActions,
}: {
  files: GitChangeTreeFile[]
  renderFile: (file: GitChangeTreeFile, depth: number) => ReactNode
  renderFolderActions?: (path: string, files: GitChangeTreeFile[], depth: number) => ReactNode
}) {
  const tree = useMemo(() => makeTree(files), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const descendantFiles = (node: ChangeTreeNode): GitChangeTreeFile[] => [
    ...(node.file ? [node.file] : []),
    ...[...node.children.values()].flatMap(descendantFiles),
  ]

  const renderNodes = (nodes: ChangeTreeNode[], depth: number): ReactNode => nodes.map((node) => {
    if (!node.directory && node.file) return <div key={`file:${node.path}`}>{renderFile(node.file, depth)}</div>
    const isCollapsed = collapsed.has(node.path)
    return (
      <div key={`folder:${node.path}`} className="group rounded-md hover:bg-muted/60 focus-within:bg-muted/60">
        <div className="flex min-h-7 items-center pr-1">
          <button
            type="button"
            className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            aria-expanded={!isCollapsed}
            title={node.path}
            onClick={() => setCollapsed((current) => {
              const next = new Set(current)
              if (next.has(node.path)) next.delete(node.path)
              else next.add(node.path)
              return next
            })}
          >
            <ChevronDown className={cn('h-3 w-3 shrink-0 text-foreground-tertiary transition-transform', isCollapsed && '-rotate-90')} />
            <Folder className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
          </button>
          {renderFolderActions?.(node.path, descendantFiles(node), depth)}
        </div>
        {!isCollapsed ? <div>{renderNodes([...node.children.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), depth + 1)}</div> : null}
      </div>
    )
  })

  return <div className="space-y-0.5">{renderNodes(tree, 0)}</div>
}
