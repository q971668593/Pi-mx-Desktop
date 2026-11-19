// "AI is driving the computer" indicator: a click-through, non-activating, topmost
// desktop overlay that breathes a blue glow around the screen edges while a
// computer-control tool (`computer_*`) is running.
//
// Contract this must keep (same as any native presentation overlay):
//   - input transparent: the user keeps clicking through it
//   - non-activating: it must never steal focus from the window being driven
//   - edge-only: it must not cover the content the agent is reading
import { BrowserWindow, screen } from 'electron'
import type { AppEvent } from '@shared/app-events'
import { configStore } from './config-store'

/** Tool-name prefixes that mean "the agent is driving the real desktop". */
const DRIVING_TOOL_PREFIXES = ['computer_']

const FADE_IN_MS = 160
const FADE_OUT_MS = 380
/** Keep the glow briefly after the last action so consecutive calls look continuous. */
const IDLE_HIDE_MS = 1200
/** Never keep the glow on forever if a tool-end event gets lost. */
const SAFETY_HIDE_MS = 60_000
const FRAME_MS = 16

const BLUE = '88, 150, 255'

const GLOW_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  .glow {
    position: fixed;
    inset: 0;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 3px rgba(${BLUE}, 0.95),
      inset 0 0 64px 14px rgba(${BLUE}, 0.55),
      inset 0 0 150px 40px rgba(50, 120, 255, 0.22);
    animation: breathe 2.6s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.62; }
    50% { opacity: 1; }
  }
</style>
</head>
<body><div class="glow"></div></body>
</html>`

let win: BrowserWindow | null = null
let winReady = false
let visible = false
let opacity = 0
let fadeTimer: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let safetyTimer: ReturnType<typeof setTimeout> | null = null
const activeToolCalls = new Set<string>()

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer as unknown as NodeJS.Timeout)
  return null
}

function clearFade(): void {
  if (fadeTimer) {
    clearInterval(fadeTimer)
    fadeTimer = null
  }
}

/** Union of every display, in DIP screen coordinates. */
function desktopBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) {
    const { workArea } = screen.getPrimaryDisplay()
    return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }
  }
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const d of displays) {
    left = Math.min(left, d.bounds.x)
    top = Math.min(top, d.bounds.y)
    right = Math.max(right, d.bounds.x + d.bounds.width)
    bottom = Math.max(bottom, d.bounds.y + d.bounds.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

async function ensureWindow(): Promise<BrowserWindow | null> {
  if (win && !win.isDestroyed()) return win
  const bounds = desktopBounds()
  const created = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    // Not in the taskbar / alt-tab / window switchers on either platform.
    type: process.platform === 'linux' ? 'notification' : undefined,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  win = created
  winReady = false
  created.setMenu(null)
  // Click-through. `forward: true` is deliberately NOT used: on Windows it makes the cursor
  // flicker between the underlying element's cursor and the arrow on every mouse move
  // (electron/electron#48035, status/confirmed; fixed upstream only by forwarding-aware cursor
  // handling). This overlay never needs the forwarded moves — it has no interactive content.
  created.setIgnoreMouseEvents(true)
  // Above full-screen apps and the agent-cursor overlay belongs to another process.
  created.setAlwaysOnTop(true, 'screen-saver')
  // Keep the indicator out of the agent's own screenshots where the OS supports it, so the blue
  // edge never becomes evidence it reacts to. Fails harmlessly on builds without the API.
  try {
    created.setContentProtection(true)
  } catch {
    /* capture exclusion unavailable */
  }
  if (process.platform === 'darwin') {
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  created.on('closed', () => {
    if (win === created) {
      win = null
      winReady = false
      visible = false
      opacity = 0
    }
  })
  try {
    await created.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(GLOW_HTML)}`)
    winReady = true
  } catch {
    // A failed load just means no indicator; never block the agent on it.
    if (win === created && !created.isDestroyed()) created.destroy()
    win = null
    winReady = false
    return null
  }
  return win
}

function fadeTo(target: number, durationMs: number, onDone?: () => void): void {
  clearFade()
  const host = win
  if (!host || host.isDestroyed()) return
  const from = opacity
  const delta = target - from
  if (durationMs <= 0 || Math.abs(delta) < 0.01) {
    opacity = target
    host.setOpacity(target)
    onDone?.()
    return
  }
  const startedAt = Date.now()
  fadeTimer = setInterval(() => {
    const host2 = win
    if (!host2 || host2.isDestroyed() || fadeTimer === null) {
      clearFade()
      return
    }
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs)
    opacity = from + delta * progress
    host2.setOpacity(opacity)
    if (progress >= 1) {
      clearFade()
      onDone?.()
    }
  }, FRAME_MS)
}

function hideNow(): void {
  clearFade()
  idleTimer = clearTimer(idleTimer)
  safetyTimer = clearTimer(safetyTimer)
  const host = win
  const finish = (): void => {
    visible = false
    opacity = 0
    const h = win ?? host
    if (!h || h.isDestroyed()) return
    h.setOpacity(0)
    h.hide()
  }
  if (!host || host.isDestroyed() || !host.isVisible()) {
    finish()
    return
  }
  fadeTo(0, FADE_OUT_MS, finish)
}

function showNow(): void {
  if (visible) {
    idleTimer = clearTimer(idleTimer)
    safetyTimer = clearTimer(safetyTimer)
    safetyTimer = setTimeout(hideNow, SAFETY_HIDE_MS)
    return
  }
  visible = true
  void ensureWindow().then((host) => {
    if (!host || host.isDestroyed() || !visible) return
    // Displays may have changed since the last activation.
    const bounds = desktopBounds()
    host.setBounds(bounds)
    host.setOpacity(0)
    opacity = 0
    // No `forward: true`: see the note in ensureWindow (Windows cursor flicker).
    host.setIgnoreMouseEvents(true)
    host.setAlwaysOnTop(true, 'screen-saver')
    if (!winReady) {
      // The overlay page failed to load: drop back to idle so the next action retries.
      visible = false
      return
    }
    host.showInactive()
    fadeTo(1, FADE_IN_MS)
  })
  safetyTimer = clearTimer(safetyTimer)
  safetyTimer = setTimeout(hideNow, SAFETY_HIDE_MS)
}

function scheduleIdleHide(): void {
  idleTimer = clearTimer(idleTimer)
  idleTimer = setTimeout(() => {
    if (activeToolCalls.size === 0) hideNow()
  }, IDLE_HIDE_MS)
}

function isDrivingTool(name: string): boolean {
  const lower = name.toLowerCase()
  return DRIVING_TOOL_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

/**
 * Feed every app event through here (worker-manager already fans them out).
 * Only computer-control tool lifecycle events change the indicator state.
 */
export function observeAiActivityGlow(event: AppEvent): void {
  if (event.type !== 'tool') return
  if (!isDrivingTool(event.toolName)) return
  if (configStore.get('aiActivityGlowEnabled') === false) return
  const id = `${event.sessionId ?? ''}:${event.toolCallId}`
  if (event.phase === 'start') {
    activeToolCalls.add(id)
    showNow()
    return
  }
  if (event.phase === 'end' || event.phase === 'update') {
    if (event.phase === 'end') activeToolCalls.delete(id)
    if (activeToolCalls.size === 0) scheduleIdleHide()
    else showNow()
  }
}

/** Force the indicator on for `durationMs` — used by the settings preview. */
export async function previewAiActivityGlow(durationMs = 2600): Promise<void> {
  showNow()
  idleTimer = clearTimer(idleTimer)
  safetyTimer = clearTimer(safetyTimer)
  safetyTimer = setTimeout(hideNow, Math.max(500, durationMs))
}

export function disposeAiActivityGlow(): void {
  activeToolCalls.clear()
  clearFade()
  idleTimer = clearTimer(idleTimer)
  safetyTimer = clearTimer(safetyTimer)
  visible = false
  opacity = 0
  const host = win
  win = null
  winReady = false
  if (host && !host.isDestroyed()) host.destroy()
}
