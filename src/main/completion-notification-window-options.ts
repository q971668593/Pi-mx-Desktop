import type { BrowserWindowConstructorOptions } from 'electron'
import { NOTIFICATION_CARD_HEIGHT, NOTIFICATION_HOST_WIDTH } from './completion-notification-geometry'

export function completionNotificationWindowOptions(
  preload: string,
): BrowserWindowConstructorOptions {
  return {
    width: NOTIFICATION_HOST_WIDTH,
    // 初始高度只占位：卡片渲染完会自己量高度并通过 notification:resize 把窗口撑开。
    height: NOTIFICATION_CARD_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: true,
    transparent: false,
    backgroundColor: '#f2f3f5',
    webPreferences: {
      preload,
      partition: 'notify',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The host also plays alert sounds while hidden ("sound only" mode).
      backgroundThrottling: false,
    },
  }
}
