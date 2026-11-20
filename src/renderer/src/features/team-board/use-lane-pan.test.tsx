import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLanePan } from './use-lane-pan'

afterEach(cleanup)

function Harness({ enabled = true }: { enabled?: boolean }) {
  const pan = useLanePan<HTMLDivElement>({ enabled })
  return <div ref={pan.ref} data-testid="rail" data-dragging={pan.dragging} />
}

function makeScrollable(el: HTMLElement, scrollWidth = 900, clientWidth = 300) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
  el.scrollLeft = 0
}

function pointerEvent(
  type: string,
  init: { pointerId: number; clientX?: number; clientY?: number; button?: number },
): Event {
  // jsdom 没有 PointerEvent：用 MouseEvent 补上 pointerId，够 hook 里的判断用。
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId })
  return event
}

describe('useLanePan', () => {
  it('scrolls horizontally on a vertical wheel event', () => {
    const { getByTestId } = render(<Harness />)
    const rail = getByTestId('rail')
    makeScrollable(rail)
    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    act(() => {
      rail.dispatchEvent(event)
    })
    expect(rail.scrollLeft).toBe(120)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves the wheel alone when there is nothing to scroll', () => {
    const { getByTestId } = render(<Harness />)
    const rail = getByTestId('rail')
    makeScrollable(rail, 300, 300)
    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    act(() => {
      rail.dispatchEvent(event)
    })
    expect(rail.scrollLeft).toBe(0)
    expect(event.defaultPrevented).toBe(false)
  })

  it('pans by dragging the rail background', () => {
    const { getByTestId } = render(<Harness />)
    const rail = getByTestId('rail')
    makeScrollable(rail)
    rail.setPointerCapture = () => {}
    rail.releasePointerCapture = () => {}
    act(() => {
      rail.dispatchEvent(pointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 200 }))
      rail.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 150 }))
    })
    expect(rail.scrollLeft).toBe(50)
    expect(rail.dataset.dragging).toBe('true')
    act(() => {
      rail.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }))
    })
    expect(rail.dataset.dragging).toBe('false')
  })

  it('does not hijack a drag that starts on a card', () => {
    const { getByTestId } = render(<Harness />)
    const rail = getByTestId('rail')
    makeScrollable(rail)
    const card = document.createElement('button')
    card.draggable = true
    rail.appendChild(card)
    card.setPointerCapture = () => {}
    act(() => {
      card.dispatchEvent(pointerEvent('pointerdown', { button: 0, pointerId: 2, clientX: 200 }))
      card.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, clientX: 120 }))
    })
    expect(rail.scrollLeft).toBe(0)
  })
})
