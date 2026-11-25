import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GrowMiniTree } from './grow-mini-tree'
import type { GrowNode } from './grow-types'

const node = (id: string, depends_on?: string[]): GrowNode => ({ id, question: `问题 ${id}`, status: 'pending', depends_on })

describe('upstream grow tree adapter', () => {
  it('zooms around the pointer, pans after a threshold, and tears down listeners', () => {
    const select = vi.fn()
    const { container, unmount } = render(<GrowMiniTree nodes={[node('a')]} onSelect={select} />)
    const svg = container.querySelector('#tree-canvas') as SVGSVGElement
    const target = container.querySelector('[data-node-id="a"].tree-node')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 800, height: 400, right: 810, bottom: 420, x: 10, y: 20, toJSON: () => ({}) })
    const box = () => svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
    // Default xMidYMid meet: account for the horizontal or vertical letterbox.
    const point = (clientX: number, clientY: number) => {
      const [x, y, w, h] = box()
      const scale = Math.min(800 / w, 400 / h)
      return [x + (clientX - 10 - (800 - w * scale) / 2) / scale, y + (clientY - 20 - (400 - h * scale) / 2) / scale]
    }
    const before = point(300, 170)
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 170, deltaY: -100 })
    svg.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(point(300, 170)[0]).toBeCloseTo(before[0])
    expect(point(300, 170)[1]).toBeCloseTo(before[1])
    const pointer = (element: Element | Window, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      element.dispatchEvent(event)
    }
    pointer(target, 'pointerdown', 300, 170)
    pointer(window, 'pointermove', 302, 172)
    pointer(window, 'pointerup', 302, 172)
    fireEvent.click(target, { detail: 1 })
    expect(select).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '问题详情' })).toHaveTextContent('问题 a')
    const prior = box()
    pointer(target, 'pointerdown', 300, 170)
    pointer(window, 'pointermove', 330, 190)
    expect(svg.style.cursor).toBe('grabbing')
    pointer(window, 'pointerup', 330, 190)
    fireEvent.click(target, { detail: 1 })
    expect(select).not.toHaveBeenCalled()
    expect(container.querySelector('[data-tree-tip]')).not.toBeVisible()
    expect(box()[0]).toBeLessThan(prior[0])
    fireEvent.click(screen.getByRole('button', { name: '适应' }))
    expect(svg.dataset.scale).toBe('1')
    const fitted = box()
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '适应' }))
    expect(box()).toEqual(fitted)
    unmount()
    const afterUnmount = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 })
    svg.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
    expect(svg.style.cursor).toBe('')
  })

  it('keeps full question and answer readable through hover, keyboard and touch activation', () => {
    vi.useFakeTimers()
    try {
      const question = '很长的问题'.repeat(60)
      const answer = '完整答案'.repeat(60)
      const select = vi.fn()
      const { container, unmount } = render(<GrowMiniTree nodes={[{ ...node('a'), question, answer, status: 'answered' }]} onSelect={select} />)
      const target = container.querySelector('[data-node-id="a"].tree-node')!
      const tip = container.querySelector('[data-tree-tip]')!
      fireEvent.mouseEnter(target)
      vi.advanceTimersByTime(149)
      expect(tip).not.toBeVisible()
      vi.advanceTimersByTime(1)
      expect(tip).toBeVisible()
      expect(tip).toHaveTextContent(question)
      expect(tip).toHaveTextContent(answer)
      fireEvent.mouseLeave(target)
      vi.advanceTimersByTime(300)
      fireEvent.mouseEnter(tip)
      vi.advanceTimersByTime(500)
      expect(tip).toBeVisible()
      fireEvent.mouseLeave(tip)
      vi.advanceTimersByTime(400)
      expect(tip).not.toBeVisible()
      fireEvent.focus(target)
      expect(tip).toBeVisible()
      fireEvent.keyDown(target, { key: ' ' })
      fireEvent.blur(target)
      vi.advanceTimersByTime(2000)
      expect(tip).toBeVisible()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(tip).not.toBeVisible()
      fireEvent.click(target, { detail: 1, pointerType: 'touch' })
      vi.advanceTimersByTime(2000)
      expect(tip).toBeVisible()
      expect(select).not.toHaveBeenCalled()
      fireEvent.pointerDown(document.body)
      expect(tip).not.toBeVisible()
      fireEvent.mouseEnter(target)
      unmount()
      vi.advanceTimersByTime(1000)
      expect(tip).not.toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps chapter fruit activation independent from node details', () => {
    const onChapter = vi.fn()
    const { container } = render(<GrowMiniTree nodes={[{ ...node('a', []), status: 'answered', chapter_id: 'chapter' }]} chapters={[{ id: 'chapter', title: '章节', ready: true }]} onChapter={onChapter} />)
    const target = container.querySelector('[data-node-id="a"].tree-node')!
    const fruit = container.querySelector('[data-fruit-id="a"].tree-fruit')!
    expect(fruit).toBeInTheDocument()
    fireEvent.click(target)
    expect(screen.getByRole('region', { name: '问题详情' })).toBeVisible()
    fireEvent.click(fruit)
    expect(onChapter).toHaveBeenCalledWith('chapter')
    expect(container.querySelector('[data-tree-tip]')).not.toBeVisible()
  })

  it('handles missing and cyclic dependencies, interactions, updates and zoom cleanup', () => {
    const select = vi.fn()
    const { container, rerender, unmount } = render(<GrowMiniTree nodes={[node('a', ['b']), node('b', ['a', 'missing']), node('old')]} onSelect={select} />)
    expect(container.querySelectorAll('.tree-node')).toHaveLength(3)
    expect(screen.getByText(/历史问题未记录分支关系/)).toBeInTheDocument()
    fireEvent.keyDown(container.querySelector('[data-node-id="a"].tree-node')!, { key: 'Enter' })
    expect(select).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '问题详情' })).toHaveTextContent('问题 a')
    rerender(<GrowMiniTree nodes={[node('b', [])]} onSelect={select} />)
    expect(container.querySelectorAll('.tree-node')).toHaveLength(1)
    const svg = container.querySelector('#tree-canvas')!
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(Number(svg.getAttribute('data-scale'))).toBeCloseTo(1.3)
    fireEvent.click(screen.getByRole('button', { name: '适应' }))
    expect(svg.getAttribute('data-scale')).toBe('1')
    unmount()
  })
})
