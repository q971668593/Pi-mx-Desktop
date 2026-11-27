import './bootstrap-path'
import { join } from 'node:path'
import { app, shell, type BrowserWindow, dialog, session, Menu } from 'electron'
import { createWindow, getMainWindow } from './window'
import { refreshGitWorkspaceWatch, stopGitWorkspaceWatch } from './git-workspace-watch'
import { startModelsJsonWatch, type ModelsJsonWatch } from './models-json-watch'
import { resolveActiveAgentDir } from './agent-dir'
import { registerAllHandlers } from './ipc'
import { installGitCommandLogStore } from './git-command-log-store'
import { workerManager } from './worker-manager'
import { sessionPreviewProcess } from './session-preview-process'
import { guardAppQuit, setRunningTerminalsProbe } from './window-close-guard'
import { runningTerminalCount, shutdownTerminals } from './terminal/terminal-service'
import { configStore, migrateNotificationDefaultsV2 } from './config-store'
import { scheduleStartupWarmupFallback } from './startup-warmup'
import { bindWslPersistence } from './wsl/wsl-env'
import { is } from '@electron-toolkit/utils'
import { destroyAppTray, ensureAppTray, focusMainWindow } from './tray'
import {
  disposeCompletionNotifications,
  initializeCompletionNotifications,
} from './completion-notification'
import { notifyForegroundChanged } from './completion-notification-events'
import { disposeAiActivityGlow } from './ai-activity-glow'
import { disposeCompletionDelivery, focusCompletionNotificationHost } from './completion-notification-delivery'
import { isCompletionNotificationShortcut } from './completion-notification-shortcut'
// Prevent EPIPE / write errors from crashing the main process
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') return
  console.error('[Main] Uncaught exception:', err)
  try {
    const win = getMainWindow()
    const msg = err instanceof Error ? err.message : String(err)
    const opts = {
      type: 'error' as const,
      title: 'Pi mx',
      message: 'A critical error occurred. Please restart the app.',
      detail: msg.slice(0, 500),
    }
    if (win && !win.isDestroyed()) void dialog.showMessageBox(win, opts)
    else void dialog.showMessageBox(opts)
  } catch (e) {
    /* dialog unavailable during early boot */
  }
  setTimeout(() => app.quit(), 2000)
})

function attachCompletionNotificationShortcut(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (!isCompletionNotificationShortcut(input)) return
    if (focusCompletionNotificationHost()) event.preventDefault()
  })
}

function createMenu(): void {
  // macOS keeps a minimal app menu (system convention); Windows/Linux remove the menu bar entirely.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
        { role: 'help', submenu: [{ label: 'Documentation', click: () => shell.openExternal('https://pi.dev') }] },
      ] as Electron.MenuItemConstructorOptions[]),
    )
    return
  }
  Menu.setApplicationMenu(null)
}

// Built-in browser: never advertise automation. Chromium sets navigator.webdriver whenever a
// debugging/automation switch is present (e.g. a test harness); pages use it as a bot signal.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
}

app.whenReady().then(() => {
  if (!gotLock) return
  if (process.env.PI_AUDIO_TRACE === '1' || process.env.PI_ALERT_TRACE === '1') {
    void import('./audio-trace').then(({ getAudioTraceLogHint }) => {
      console.log('[audio-trace] enabled — log file:', getAudioTraceLogHint())
    })
  }
  createMenu()
  // 回收站只留最近 5 天：启动时先清一遍，用户打开列表时还会再清。
  void import('./session-trash-store').then(({ purgeExpiredSessionTrash }) => {
    const purged = purgeExpiredSessionTrash()
    if (purged > 0) console.log(`[session-trash] purged ${purged} expired session(s)`)
  })
  const closeToTray = ensureAppTray() !== null
  // 通知默认值统一到「都通知」：老盘里的旧默认值先搬一次，再按新规则读设置。
  migrateNotificationDefaultsV2()
  initializeCompletionNotifications()

  // CSP: inject Content-Security-Policy header in production (skip dev for Vite HMR)
  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.github.com https://chatgpt.com; font-src 'self' data:"
          ]
        }
      })
    })
  }

  bindWslPersistence({
    get: (key) => configStore.get(key),
    set: (key, value) => configStore.set(key, value as never),
  })
  // WSL mode without a captured environment (first run after an upgrade): start capturing now so
  // it usually lands before the first WSL-aware dir lookup would have to block on wsl.exe.
  // Also boot the distro VM right away (async) so startup reads over \\wsl.localhost don't
  // have to boot it inside a synchronous fs call.
  {
    const runtime = configStore.get('agentRuntime')
    if (runtime?.mode === 'wsl' && runtime.distro) {
      const distro = runtime.distro
      void import('./wsl/wsl-env').then((m) => {
        void m.startWslVm(distro)
        if (!configStore.get('wslEnvCache')?.[distro]) void m.resolveWslEnv(distro)
      })
    }
  }
  registerAllHandlers()
  installGitCommandLogStore()
  // 破甲开关：把安装包里带的扩展落到 agent 目录。必须早于任何 worker 会话启动，
  // 因为 pi 只在会话创建时扫描 extensions/。失败不影响启动。
  void import('./purge/controller')
    .then((m) => m.ensurePurgeInstalled())
    .catch((error) => console.error('[purge] 安装扩展失败:', error))
  void import('./clipboard-temp-images').then(({ pruneStaleClipboardImages }) => {
    try {
      pruneStaleClipboardImages()
    } catch (e) {
      console.warn('[clipboard-images] prune failed:', e)
    }
  })
  const win = createWindow(closeToTray)
  workerManager.setMainWindow(win)
  // Mobile gateway: only listens when the user left it on (Settings → 手机连接).
  void import('./remote-gateway-service').then((m) => m.startRemoteGatewayIfEnabled())
  attachCompletionNotificationShortcut(win)
  win.on('focus', () => notifyForegroundChanged())
  win.on('restore', () => notifyForegroundChanged())
  win.on('closed', disposeCompletionDelivery)
  void refreshGitWorkspaceWatch(win)
  // models.json 被外部改动（手改 / 别的工具 / agent edit）时，正在跑的 worker 仍持旧模型表：
  // 模型列表、上下文窗口都不会更新，重启客户端才恢复。这里重载所有 worker 并通知界面刷新。
  modelsWatch?.stop()
  modelsWatch = startModelsJsonWatch({
    modelsPath: join(resolveActiveAgentDir(), 'models.json'),
    onChange: () => {
      void workerManager.reloadModels().catch((error) => {
        console.warn('[models-watch] reload failed (ignored):', error)
      })
      const target = getMainWindow()
      if (target) target.webContents.send('ipc:model-catalog-changed', {})
    },
  })
  // SDK / extension warm-up starts when the renderer reports its shell painted (app.shellReady);
  // the fallback covers a renderer that never gets there. See startup-warmup.ts.
  win.webContents.once('did-finish-load', () => scheduleStartupWarmupFallback())
  if (process.env.PI_E2E !== '1' && process.env.PI_E2E !== 'true') {
    win.once('show', () => {
      setTimeout(() => {
        import('./updater').then(({ initUpdater }) => initUpdater(win)).catch((e) => {
          console.warn('[Updater] Failed to initialize:', e)
        })
      }, 3000)
    })
  }

  // 不自动打开上次项目：进 app 显示空 Project Home，用户自行选择项目

  app.on('activate', () => {
    if (!getMainWindow()) {
      const w = createWindow(ensureAppTray() !== null)
      workerManager.setMainWindow(w)
      attachCompletionNotificationShortcut(w)
      w.on('focus', () => notifyForegroundChanged())
      w.on('restore', () => notifyForegroundChanged())
      w.on('closed', disposeCompletionDelivery)
    } else {
      focusMainWindow()
    }
  })
})

let isQuittingGracefully = false
let gracefulShutdownPromise: Promise<void> | null = null
// 注意：这个声明必须留在 `let isQuittingGracefully` 之后 —— before-quit 里要用它，
// 而 tray-main-lifecycle 契约测试只从 isQuittingGracefully 起截取源码在 vm 里跑。
/** models.json 外部变更监听（启动时创建，退出时释放）。 */
let modelsWatch: ModelsJsonWatch | null = null

/**
 * Force-quit mid-stream used to kill workers before abort could write a terminal
 * assistant leaf — reopen then showed empty unrewindable sessions.
 * Await abort+dispose flush on every quit path.
 */
function gracefulShutdownWorkers(): Promise<void> {
  return gracefulShutdownPromise ??= performGracefulShutdown()
}

async function performGracefulShutdown(): Promise<void> {
  isQuittingGracefully = true
  try {
    await import('./remote-gateway-service').then((m) => m.stopRemoteGateway()).catch(() => {})
    await workerManager.stop()
  } catch (error) {
    console.error('[Main] graceful worker stop failed:', error)
  } finally {
    sessionPreviewProcess.stop()
    stopGitWorkspaceWatch()
    disposeCompletionNotifications()
    disposeAiActivityGlow()
    shutdownTerminals()
  }
  try {
    const ses = await import('./browser/electron-session')
    ses.peekDownloadManager()?.shutdown()
  } catch {
    /* optional */
  }
  try {
    const bh = await import('./browser/browser-host')
    bh.peekBrowserHost()?.shutdown()
  } catch {
    /* optional */
  }
  try {
    const asr = await import('./asr/codex-asr-manager')
    asr.stopBuiltinCodexAsrServe()
  } catch {
    /* optional */
  }
}

setRunningTerminalsProbe(runningTerminalCount)

app.on('before-quit', (event) => {
  // A running turn must get the close-decision prompt first (tray Quit / Cmd+Q).
  // Keep the tray alive while the user decides so a hidden window remains reachable.
  if (!guardAppQuit(event)) return
  modelsWatch?.stop()
  modelsWatch = null
  destroyAppTray()
  event.preventDefault()
  void gracefulShutdownWorkers().finally(() => {
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // before-quit will flush workers; do not fire-and-forget stop() here
    if (!isQuittingGracefully) {
      void gracefulShutdownWorkers().finally(() => app.quit())
    }
  } else {
    void gracefulShutdownWorkers()
  }
})
