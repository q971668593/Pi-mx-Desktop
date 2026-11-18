import { describe, expect, it, vi } from 'vitest'
import { startModelsJsonWatch } from './models-json-watch'

type Listener = (event: string, filename: string | null) => void

/** Stands in for fs.watch: records the listener so the test can drive events. */
function fakeWatch() {
  let listener: Listener | null = null
  const closed = { value: false }
  const handle = {
    on: () => handle,
    close: () => {
      closed.value = true
    },
  }
  const factory = ((_dir: string, _options: unknown, cb: Listener) => {
    listener = cb
    return handle
  }) as unknown as typeof import('node:fs').watch
  return {
    factory,
    closed,
    emit: (filename: string | null) => listener?.('change', filename),
  }
}

describe('startModelsJsonWatch', () => {
  it('debounces a burst of writes into one reload', () => {
    const fake = fakeWatch()
    const onChange = vi.fn()
    // 最小定时器替身：clearTimeout 真的要能取消，否则测不到去抖
    const pending = new Map<number, () => void>()
    let seq = 0
    const watch = startModelsJsonWatch({
      modelsPath: '/agent/models.json',
      onChange,
      watchFn: fake.factory,
      debounceMs: 50,
      setTimeoutFn: ((fn: () => void) => {
        pending.set(++seq, fn)
        return seq as never
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: ((id: number) => {
        pending.delete(id)
      }) as unknown as typeof clearTimeout,
    })

    fake.emit('models.json')
    fake.emit('models.json')
    fake.emit('models.json')
    expect(onChange).not.toHaveBeenCalled()
    // 三次写入只留一个待触发的定时器，且只触发一次
    expect(pending.size).toBe(1)
    for (const fn of [...pending.values()]) fn()
    expect(onChange).toHaveBeenCalledTimes(1)
    watch.stop()
    expect(fake.closed.value).toBe(true)
  })

  it('ignores unrelated files in the same directory', () => {
    const fake = fakeWatch()
    const onChange = vi.fn()
    const watch = startModelsJsonWatch({
      modelsPath: '/agent/models.json',
      onChange,
      watchFn: fake.factory,
      debounceMs: 0,
      setTimeoutFn: ((fn: () => void) => {
        fn()
        return 0 as never
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
    })

    fake.emit('settings.json')
    expect(onChange).not.toHaveBeenCalled()
    // filename 为 null（部分平台/挂载）时不能漏掉事件
    fake.emit(null)
    expect(onChange).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('stops firing after stop() and survives a throwing onChange', () => {
    const fake = fakeWatch()
    const onChange = vi.fn(() => {
      throw new Error('boom')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const watch = startModelsJsonWatch({
      modelsPath: '/agent/models.json',
      onChange,
      watchFn: fake.factory,
      debounceMs: 0,
      setTimeoutFn: ((fn: () => void) => {
        fn()
        return 0 as never
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
    })

    fake.emit('models.json')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()

    watch.stop()
    fake.emit('models.json')
    expect(onChange).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
