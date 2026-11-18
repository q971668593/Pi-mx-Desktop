import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWebUrl } from '@shared/web-url'

/** http(s) URLs without embedded credentials are the only links the OS may open. */
export const isSafeExternalUrl = isWebUrl

/** True when `target` resolves inside `root` (no `..` escape, no sibling prefix match). */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

export type WindowOpenDecision = { openExternal?: string }

/**
 * `window.open` from the renderer never creates a new Electron window: http(s) links go to
 * the system browser, everything else (file:, javascript:, data:, custom protocols) is dropped.
 */
export function decideWindowOpen(target: string): WindowOpenDecision {
  return isSafeExternalUrl(target) ? { openExternal: target } : {}
}

export type NavigationDecision = { prevent: boolean; openExternal?: string }

/**
 * Renderer navigation policy:
 * - same URL (reload) and same-origin as the Vite dev server stay inside the app;
 * - `file:` targets must live under the bundled renderer directory;
 * - other http(s) links open in the system browser;
 * - `javascript:`, `data:`, custom protocols and file paths outside the bundle are blocked.
 */
export function decideWindowNavigation(input: {
  target: string
  current: string
  rendererRoot: string
  devServerUrl?: string
}): NavigationDecision {
  let target: URL
  try {
    target = new URL(input.target)
  } catch {
    return { prevent: true }
  }

  let current: URL | null = null
  try {
    current = new URL(input.current)
  } catch {
    current = null
  }

  if (current && target.href === current.href) return { prevent: false }

  if (target.protocol === 'http:' || target.protocol === 'https:') {
    let dev: URL | null = null
    try {
      dev = input.devServerUrl ? new URL(input.devServerUrl) : null
    } catch {
      dev = null
    }
    if (dev && dev.origin === target.origin) return { prevent: false }
    const openExternal = isSafeExternalUrl(target.href) ? target.href : undefined
    return { prevent: true, ...(openExternal ? { openExternal } : {}) }
  }

  if (target.protocol === 'file:') {
    let targetPath: string
    try {
      targetPath = fileURLToPath(target)
    } catch {
      return { prevent: true }
    }
    return { prevent: !isPathInside(input.rendererRoot, targetPath) }
  }

  return { prevent: true }
}
