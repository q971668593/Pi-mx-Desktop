export interface GrowTreeSelectorProps {
  trees: Array<{ sessionId: string; requirement: string; pendingCount: number; reviewCount: number }>
  selectedId?: string
  loading: boolean
  disabled: boolean
  onSelect: (id: string) => void
  onRefresh: () => void
}

export function GrowTreeSelector({ trees, selectedId, loading, disabled, onSelect, onRefresh }: GrowTreeSelectorProps) {
  const selectedValue = trees.some((tree) => tree.sessionId === selectedId) ? selectedId : ''

  return (
    <div className="flex items-center gap-2" aria-busy={loading}>
      <select
        aria-label="需求树"
        value={selectedValue}
        disabled={disabled || loading || trees.length === 0}
        onChange={(event) => {
          if (event.target.value) onSelect(event.target.value)
        }}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="">{loading ? '加载中…' : trees.length === 0 ? '暂无需求树' : '请选择需求树'}</option>
        {trees.map((tree) => (
          <option key={tree.sessionId} value={tree.sessionId}>
            {tree.requirement}（待答 {tree.pendingCount} / 待复核 {tree.reviewCount}）
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onRefresh}
        className="shrink-0 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {loading ? '刷新中…' : '刷新'}
      </button>
      {loading && <span className="sr-only" role="status">正在加载需求树</span>}
    </div>
  )
}
