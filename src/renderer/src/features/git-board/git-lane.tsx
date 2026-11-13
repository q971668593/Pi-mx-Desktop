const COLORS = ['#165dff', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
const SLOT = 14

function color(index: number): string {
  return COLORS[index % COLORS.length]
}

export function GitLane({ lane, passes, links, columns, fromAbove }: { lane: number; passes: number[]; links: number[]; columns: number; fromAbove: boolean }) {
  const x = (index: number) => 7 + index * SLOT
  return (
    <svg width={Math.max(columns, 1) * SLOT} height={28} className="shrink-0" aria-hidden="true">
      {passes.map((index) => <line key={`pass-${index}`} x1={x(index)} y1={0} x2={x(index)} y2={28} stroke={color(index)} strokeWidth={2} />)}
      {fromAbove ? <line x1={x(lane)} y1={0} x2={x(lane)} y2={14} stroke={color(lane)} strokeWidth={2} /> : null}
      {links.map((target, index) => {
        const start = x(lane)
        const end = x(target)
        const d = start === end ? `M ${start} 14 V 28` : `M ${start} 14 C ${start} 24, ${end} 18, ${end} 28`
        return <path key={`link-${target}-${index}`} d={d} stroke={color(lane)} strokeWidth={2} fill="none" />
      })}
      <circle cx={x(lane)} cy={14} r={4} fill={color(lane)} />
    </svg>
  )
}
