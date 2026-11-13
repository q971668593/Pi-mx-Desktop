import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { readRemoteAttachment } from './clipboard-temp-images'
import { resolvePathUnderWorkspace } from './workspace-fs'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const IMAGE_ACTION_MAX_BYTES = 20 * 1024 * 1024

export async function resolveActionableImage(
  input: string,
  workspaceRoot?: string,
): Promise<{ abs: string } | { error: string }> {
  const raw = input.trim()
  if (!raw) return { error: 'missing_path' }
  const clipboard = readRemoteAttachment(raw)
  if (clipboard) return { abs: raw }

  if (workspaceRoot?.trim()) {
    const resolved = await resolvePathUnderWorkspace(workspaceRoot, raw)
    if (resolved.ok) return validateImage(resolved.abs)
    if (!isAbsolute(raw)) return { error: resolved.error }
  }

  if (!isAbsolute(raw)) return { error: 'outside_workspace' }
  return validateImage(raw)
}

async function validateImage(abs: string): Promise<{ abs: string } | { error: string }> {
  if (!IMAGE_EXTENSIONS.has(extname(abs).toLowerCase())) return { error: 'not_image' }
  try {
    await access(abs, constants.R_OK)
    const info = await stat(abs)
    if (!info.isFile()) return { error: 'not_image' }
    if (info.size > IMAGE_ACTION_MAX_BYTES) return { error: 'too_large' }
    return { abs }
  } catch {
    return { error: 'not_found' }
  }
}

export async function readActionableImage(abs: string): Promise<Buffer> {
  const clipboard = readRemoteAttachment(abs)
  return clipboard?.bytes ?? readFile(abs)
}
