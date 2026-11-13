import { accessSync, constants, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

export function resolvePortableDataRoot(options: {
  isPackaged: boolean
  execPath: string
  portableExecutableDir?: string
}): string | null {
  if (!options.isPackaged && !options.portableExecutableDir) return null
  const baseDir = options.portableExecutableDir || dirname(options.execPath)
  if (!baseDir) return null
  const dataDir = join(baseDir, 'data')
  if (!existsSync(dataDir)) return null
  try {
    accessSync(dataDir, constants.W_OK)
    return dataDir
  } catch {
    return null
  }
}

export function applyPortableDataDirs(app: {
  isPackaged: boolean
  setPath: (name: 'userData' | 'sessionData', path: string) => void
}): string | null {
  const dataDir = resolvePortableDataRoot({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  })
  if (!dataDir) return null

  const userDataDir = join(dataDir, 'userData')
  const sessionDataDir = join(dataDir, 'sessionData')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(sessionDataDir, { recursive: true })
  app.setPath('userData', userDataDir)
  app.setPath('sessionData', sessionDataDir)
  return dataDir
}
