import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GrowNode } from './grow-types'
import { GrowMiniTree, layoutGrowTree } from './grow-mini-tree'
import { growTreeGeometry } from './grow-tree-geometry'

const node = (id: string, status: GrowNode['status'] = 'pending', depends_on?: string[]): GrowNode => ({ id, question: `问题 ${id}`, status, depends_on })

describe('生长树画布', () => {
  it('grows upward and gives sibling branches separate space', () => {
    const rows = layoutGrowTree([node('a', 'answered', []), node('b', 'pending', ['a']), node('c', 'deferred', ['a'])])
    const { points, width, height } = growTreeGeometry(rows)
    expect(points[1].y).toBeLessThan(points[0].y)
    expect(points[2].x).toBeGreaterThan(points[1].x)
    expect(width).toBeGreaterThanOrEqual(300)
    expect(height).toBeGreaterThan(points[0].y)
  })

  it('renders each recorded dependency and leaves legacy nodes independent', () => {
    const nodes = [node('a', 'answered', []), node('b', 'pending', []), node('c', 'needs_review', ['a', 'b', 'missing']), node('old')]
    const { container } = render(<GrowMiniTree nodes={nodes} />)
    expect(container.querySelectorAll('.tree-node')).toHaveLength(4)
    expect(screen.getByText(/历史问题未记录分支关系/)).toBeInTheDocument()
    expect(container.querySelector('[data-node-id="c"].tree-node')).toHaveAttribute('data-status', 'needs_review')
  })

  it('supports question actions and updates as the tree grows', () => {
    const select = vi.fn()
    const { container, rerender } = render(<GrowMiniTree nodes={[node('a', 'answered', [])]} onSelect={select} requirement="我的需求" />)
    fireEvent.click(container.querySelector('[data-node-id="a"].tree-node')!)
    expect(select).not.toHaveBeenCalled()
    expect(container.querySelector('[data-tree-tip]')).toHaveTextContent('问题 a')
    expect(screen.getByText('我的需求')).toBeInTheDocument()
    rerender(<GrowMiniTree nodes={[node('a', 'answered', []), node('b', 'deferred', ['a'])]} onSelect={select} />)
    expect(container.querySelector('[data-node-id="b"].tree-node')).toHaveAttribute('data-status', 'deferred')
  })

  it('shows the empty state', () => {
    render(<GrowMiniTree nodes={[]} />)
    expect(screen.getByText(/还没有问题/)).toBeInTheDocument()
  })
})
