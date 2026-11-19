import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent, ToolEvent } from '@shared/app-events'

const mocks = vi.hoisted(() => {
  type FakeWin = InstanceType<typeof FakeBrowserWindow>
  class FakeBrowserWindow {
    static instances: FakeWin[] = []
    options: Record<string, unknown>
    destroyed = false
    shown = false
    hideCalls = 0
    setIgnoreMouseEvents = vi.fn()
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setBounds = vi.fn()
    setOpacity = vi.fn()
    setMenu = vi.fn()
    on = vi.fn()
    showInactive = vi.fn(() => {
      this.shown = true
    })
    hide = vi.fn(() => {
      this.shown = false
      this.hideCalls += 1
    })
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    loadURL = vi.fn(async () => {})
    isDestroyed = vi.fn(() => this.destroyed)
    isVisible = vi.fn(() => this.shown)
    constructor(options: Record<string, unknown>) {
      this.options = options
      FakeBrowserWindow.instances.push(this)
    }
  }
  return {
    FakeBrowserWindow,
    getAllDisplays: vi.fn(() => [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    ]),
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
    glowEnabled: true,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.FakeBrowserWindow,
  screen: {
    getAllDisplays: mocks.getAllDisplays,
    getPrimaryDisplay: mocks.getPrimaryDisplay,
  },
}))
vi.mock('./config-store', () => ({
  configStore: { get: (key: string) => (key === 'aiActivityGlowEnabled' ? mocks.glowEnabled : undefined) },
}))

import { disposeAiActivityGlow, observeAiActivityGlow, previewAiActivityGlow } from './ai-activity-glow'

type Win = InstanceType<typeof mocks.FakeBrowserWindow>

function overlay(): Win {
  const first = mocks.FakeBrowserWindow.instances[0]
  if (!first) throw new Error('no overlay created')
  return first
}

function toolEvent(toolName: string, phase: ToolEvent['phase'], toolCallId = 'c1'): ToolEvent {
  return {
    type: 'tool',
    toolName,
    phase,
    toolCallId,
    seq: 1,
    workspaceId: 'ws',
    sessionId: 's1',
    timestamp: Date.now(),
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('ai activity glow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.FakeBrowserWindow.instances.length = 0
    mocks.glowEnabled = true
    mocks.getAllDisplays.mockReturnValue([
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    ])
  })

  afterEach(() => {
    disposeAiActivityGlow()
    vi.useRealTimers()
  })

  it('creates a click-through, non-activating overlay over the whole desktop', async () => {
    observeAiActivityGlow(toolEvent('computer_click', 'start'))
    await flush()

    expect(mocks.FakeBrowserWindow.instances).toHaveLength(1)
    const win = overlay()
    expect(win.options).toEqual(expect.objectContaining({
      x: -1920,
      y: 0,
      width: 3840,
      height: 1080,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
    }))
    // Forwarding mouse moves makes the Windows cursor flicker over the app (electron#48035).
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    expect(win.setIgnoreMouseEvents).not.toHaveBeenCalledWith(true, { forward: true })
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(win.showInactive).toHaveBeenCalled()
  })

  it('ignores tools that do not drive the desktop', async () => {
    observeAiActivityGlow(toolEvent('bash', 'start'))
    await flush()
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(0)

    observeAiActivityGlow(toolEvent('computer_view', 'start'))
    await flush()
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(1)
  })

  it('honours the setting', async () => {
    mocks.glowEnabled = false
    observeAiActivityGlow(toolEvent('computer_click', 'start'))
    await flush()
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(0)
  })

  it('stays lit across consecutive tool calls, then hides after the last one', async () => {
    observeAiActivityGlow(toolEvent('computer_click', 'start', 'a'))
    await flush()
    observeAiActivityGlow(toolEvent('computer_click', 'end', 'a'))
    observeAiActivityGlow(toolEvent('computer_type', 'start', 'b'))
    await vi.advanceTimersByTimeAsync(3000)

    const win = overlay()
    expect(win.hide).not.toHaveBeenCalled()

    observeAiActivityGlow(toolEvent('computer_type', 'end', 'b'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(win.hide).toHaveBeenCalled()
  })

  it('never stays on forever if a tool end event is lost', async () => {
    observeAiActivityGlow(toolEvent('computer_click', 'start'))
    await flush()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(overlay().hide).toHaveBeenCalled()
  })

  it('re-reads the display layout on the next activation', async () => {
    observeAiActivityGlow(toolEvent('computer_click', 'start'))
    await flush()
    mocks.getAllDisplays.mockReturnValue([{ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }])
    observeAiActivityGlow(toolEvent('computer_click', 'end'))
    await vi.advanceTimersByTimeAsync(5000)
    observeAiActivityGlow(toolEvent('computer_click', 'start'))
    await flush()
    expect(overlay().setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 2560, height: 1440 })
  })

  it('previews without a tool event', async () => {
    await previewAiActivityGlow(1000)
    await flush()
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(1)
    expect(overlay().showInactive).toHaveBeenCalled()
  })

  it('ignores non-tool events', async () => {
    const runEvent: AppEvent = {
      type: 'run',
      phase: 'started',
      seq: 2,
      workspaceId: 'ws',
      sessionId: 's1',
      timestamp: Date.now(),
    }
    observeAiActivityGlow(runEvent)
    await flush()
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(0)
  })

  it('reuses one overlay window across activations', async () => {
    observeAiActivityGlow(toolEvent('computer_click', 'start', 'a'))
    await flush()
    observeAiActivityGlow(toolEvent('computer_click', 'end', 'a'))
    await vi.advanceTimersByTimeAsync(5000)
    observeAiActivityGlow(toolEvent('computer_click', 'start', 'b'))
    await flush()
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(1)
  })
})

