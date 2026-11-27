import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import type { AppUpdateAvailableInfo } from '@shared/app-update'
import { configStore } from './config-store'
import { checkGitHubReleaseUpdate } from './github-release-check'

export const APP_UPDATE_AVAILABLE_CHANNEL = 'ipc:app-update-available'

/** Last auto-check hit (buffered if renderer subscribed late). Cleared on dismiss / ignore. */
let pendingAppUpdate: AppUpdateAvailableInfo | null = null
let updateCheckTimer: ReturnType<typeof setInterval> | null = null
let updateCheckInFlight = false

function normalizeVersion(version: string): string {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
}

export function getPendingAppUpdate(): AppUpdateAvailableInfo | null {
  return pendingAppUpdate
}

export function setPendingAppUpdate(info: AppUpdateAvailableInfo | null): void {
  pendingAppUpdate = info
}

export function clearPendingAppUpdate(): void {
  pendingAppUpdate = null
}

/**
 * Auto-check throttle & periodic interval (4h): catches new releases both at startup
 * and during long-running desktop sessions without hammering GitHub.
 */
export const UPDATE_CHECK_TTL_MS = 4 * 60 * 60 * 1000
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

function runUpdateCheck(mainWindow: BrowserWindow): void {
  if (updateCheckInFlight) return
  if (configStore.get('autoCheckRegistryUpdates') === false) {
    log.info('[Updater] auto check disabled')
    return
  }
  const lastCheckAt = Number(configStore.get('lastUpdateCheckAt') || 0)
  if (lastCheckAt > 0 && Date.now() - lastCheckAt < UPDATE_CHECK_TTL_MS) {
    log.info('[Updater] auto check skipped (checked within interval)')
    return
  }

  updateCheckInFlight = true
  void checkGitHubReleaseUpdate()
    .then((result) => {
      if (!result.ok) {
        if (result.error) log.warn('[Updater] GitHub check:', result.error)
        return
      }
      if (!result.hasUpdate || !result.latestVersion) {
        pendingAppUpdate = null
        log.info('[Updater] up to date:', result.currentVersion)
        return
      }

      const latest = normalizeVersion(result.latestVersion)
      const ignored = normalizeVersion(configStore.get('ignoredUpdateVersion') || '')
      if (ignored && ignored === latest) {
        log.info('[Updater] ignored version:', latest)
        return
      }

      log.info('[Updater] update available:', latest, 'current:', result.currentVersion)

      const payload: AppUpdateAvailableInfo = {
        currentVersion: result.currentVersion,
        latestVersion: latest,
        releaseUrl: result.releaseUrl,
        releaseNotes: result.releaseNotes || '',
        downloadUrl: result.downloadUrl,
        downloadName: result.downloadName,
        assets: result.assets,
      }
      pendingAppUpdate = payload

      if (mainWindow.isDestroyed()) return
      mainWindow.webContents.send(APP_UPDATE_AVAILABLE_CHANNEL, payload)
    })
    .catch((err) => {
      log.warn('[Updater] check failed:', err)
    })
    .finally(() => {
      updateCheckInFlight = false
      // Record every completed attempt (success or failure) so an offline start
      // does not retry GitHub immediately.
      configStore.set('lastUpdateCheckAt', Date.now())
    })
}

/**
 * Startup & periodic update check: never blocks the UI thread beyond scheduling.
 * Failures are logged only — no toast / dialog.
 * Skips versions the user chose to ignore for this machine.
 */
export function initUpdater(mainWindow: BrowserWindow): void {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }

  // Extra tick so show/paint is not competing with network
  setImmediate(() => {
    if (!mainWindow.isDestroyed()) runUpdateCheck(mainWindow)
  })

  updateCheckTimer = setInterval(() => {
    if (!mainWindow.isDestroyed()) runUpdateCheck(mainWindow)
  }, UPDATE_CHECK_INTERVAL_MS)

  mainWindow.once('closed', () => {
    if (updateCheckTimer) {
      clearInterval(updateCheckTimer)
      updateCheckTimer = null
    }
  })
}
