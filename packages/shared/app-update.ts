/** Shared app-update payloads (main → renderer). */

export type AppUpdateAssetKind = 'setup' | 'portable' | 'dmg' | 'zip' | 'appimage' | 'deb' | 'other'

export type AppUpdateAsset = {
  name: string
  url: string
  size: number
  kind: AppUpdateAssetKind
}

export type AppUpdateAvailableInfo = {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  /** GitHub release body (markdown), empty if none */
  releaseNotes: string
  /** Preferred download for this platform, if any */
  downloadUrl: string | null
  downloadName: string | null
  assets: AppUpdateAsset[]
}

/** Why a check failed — a stable enum so the renderer never sees raw network text. */
export type AppUpdateCheckFailureReason =
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'no_release'
  | 'http'
  | 'unknown'

export type AppUpdateCheckResult =
  | { status: 'available'; update: AppUpdateAvailableInfo }
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string }
  | { status: 'error'; reason?: AppUpdateCheckFailureReason }

export type AppUpdateDownloadProgress = {
  phase: 'downloading' | 'launching' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number
  /** 0–100 when total known, else -1 */
  percent: number
  fileName?: string
  error?: string
}
