import { BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIcon } from './app-icon'
import { decideWindowNavigation, isSafeExternalUrl } from './window-navigation'
import { MAX_CRASH_RELOADS, planCrashReload } from './renderer-crash-recovery'

const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const isWin = process.platform === 'win32'
const useFrameless = isWin || isMac || isLinux
import { configStore } from './config-store'
import { customThemeRendererArgument } from './custom-theme-startup'
import { workerManager } from './worker-manager'
import { installWindowCloseGuard } from './window-close-guard'

const MIN_W = 900
const MIN_H = 600
const DEFAULT_W = 1200
const DEFAULT_H = 800

function readSavedWindowBounds(): { width: number; height: number; x?: number; y?: number } | null {
  const b = configStore.get('windowBounds')
  if (!b?.width || !b?.height) return null
  if (b.width < MIN_W || b.height < MIN_H) return null
  return {
    width: Math.round(b.width),
    height: Math.round(b.height),
    x: b.x != null ? Math.round(b.x) : undefined,
    y: b.y != null ? Math.round(b.y) : undefined,
  }
}

export function persistWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
  if (bounds.width < MIN_W || bounds.height < MIN_H) return
  configStore.set('windowBounds', {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  })
}

function attachWindowBoundsPersistence(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistWindowBounds(win)
    }, 400)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowBounds(win)
  })
}

let mainWindow: BrowserWindow | null = null
/** Pending renderer crash reloads inside the rolling window (see renderer-crash-recovery). */
let rendererCrashHistory: number[] = []

/** Renderer sandbox on by default (FMSM iter14). Set `PI_RENDERER_SANDBOX=0` to disable for local debug. */
export function readRendererSandboxEnabled(): boolean {
  const v = process.env.PI_RENDERER_SANDBOX
  if (v === '0' || v === 'false' || v === 'no') return false
  return true
}

/** Playwright / CI smoke: show window immediately, skip slow startup side effects in main. */
export function isE2eTestMode(): boolean {
  const v = process.env.PI_E2E
  return v === '1' || v === 'true' || v === 'yes'
}

export function createWindow(closeToTray = false): BrowserWindow {
  const saved = readSavedWindowBounds()
  mainWindow = new BrowserWindow({
    width: saved?.width ?? DEFAULT_W,
    height: saved?.height ?? DEFAULT_H,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    autoHideMenuBar: true,
    frame: !useFrameless,
    ...(isMac && useFrameless
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 10 } }
      : {}),
    title: is.dev ? 'Pi mx [DEV]' : 'Pi mx',
    icon: resolveAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      additionalArguments: [customThemeRendererArgument(), ...(isE2eTestMode() ? ['--pi-e2e'] : [])],
      sandbox: readRendererSandboxEnabled(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  installWindowCloseGuard(mainWindow, closeToTray)

  const revealDevWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.moveTop()
    mainWindow.focus()
    if (isWin) {
      // Windows 前台锁可能压住子进程新窗口：短脉冲置顶确保开发版立刻浮现到最前
      mainWindow.setAlwaysOnTop(true)
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false)
      }, 250)
    }
  }

  mainWindow.on('ready-to-show', () => {
    if (isE2eTestMode()) {
      mainWindow?.show()
    } else if (is.dev && process.env.PI_DEV_INACTIVE === '1') {
      mainWindow?.showInactive()
    } else if (is.dev) {
      revealDevWindow()
    } else {
      mainWindow?.show()
    }
  })

  // Production: skip per-line renderer console forwarding (idle/poll noise).
  // Dev and e2e keep full forwarding for diagnostics.
  if (is.dev || isE2eTestMode()) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[Renderer:${level}] ${message} (${sourceId}:${line})`)
    })
  }

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer] Failed to load: ${errorCode} ${errorDescription} URL: ${validatedURL}`)
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Renderer] Process gone: ${details.reason} exitCode=${details.exitCode}`)
    if (details.reason === 'crashed' || details.reason === 'killed' || details.reason === 'oom') {
      void workerManager.stop()
      const plan = planCrashReload(rendererCrashHistory, Date.now())
      rendererCrashHistory = plan.history
      if (!plan.reload) {
        console.error(`[Renderer] ${MAX_CRASH_RELOADS} crashes inside the reload window; not reloading again`)
        dialog.showErrorBox(
          'Pi mx — 渲染进程反复崩溃',
          '窗口已连续崩溃多次，已停止自动重载以避免崩溃循环。请结束多余的 Pi mx 进程后重新启动应用；若仍崩溃，请附上日志反馈。',
        )
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        console.error(`[Renderer] Reloading after crash (${plan.history.length}/${MAX_CRASH_RELOADS})`)
        mainWindow.webContents.reload()
      }
    }
  })

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Renderer] Unresponsive')
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only web links reach the system browser; file:/javascript:/custom protocols are dropped.
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Keep the app on its own document: renderer navigation to file: paths (which the OS may
  // execute) or to arbitrary web pages must never replace the workbench window.
  const rendererRoot = join(__dirname, '../renderer')
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const decision = decideWindowNavigation({
      target: url,
      current: mainWindow?.webContents.getURL() ?? '',
      rendererRoot,
      devServerUrl,
    })
    if (!decision.prevent) return
    event.preventDefault()
    if (decision.openExternal) void shell.openExternal(decision.openExternal)
  })

  attachWindowBoundsPersistence(mainWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function destroyWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
  mainWindow = null
}
