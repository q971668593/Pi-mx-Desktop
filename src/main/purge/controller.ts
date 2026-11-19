/**
 * 破甲开关（purge）—— 桌面端设置页与 pi-app-purge 扩展之间的唯一中介。
 *
 * 分工：
 *   - 本模块（主进程）负责「装」和「写」：把安装包里带的扩展复制到 agent 目录，
 *     把设置页的开关写成 <agentDir>/purge/config.json。
 *   - 扩展（resources/purge/pi-app-purge.ts，跑在 pi 里）负责「读」：每轮请求前
 *     stat 一次 config.json，变了就重读，所以拨开关对当前会话的下一句话立刻生效。
 *
 * 不 patch pi、不改 node_modules；删掉 extensions/pi-app-purge.ts 就恢复原样。
 */
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveActiveAgentDir } from '../agent-dir'

export type PurgeMode = 'strict' | 'replace' | 'append'

export interface PurgeConfig {
  enabled: boolean
  mode: PurgeMode
  /** 人设文件绝对路径；空 = <agentDir>/purge/persona.md */
  source: string
}

export interface PurgeState extends PurgeConfig {
  configFile: string
  extensionFile: string
  extensionInstalled: boolean
  personaFile: string
  personaExists: boolean
  personaChars: number
  /** 安装包里是否带了人设（没带就只能手动指定 source） */
  bundledPersona: boolean
  error?: string
}

const EXTENSION_FILE = 'pi-app-purge.ts'
const DEFAULT_CONFIG: PurgeConfig = { enabled: false, mode: 'strict', source: '' }

/** 安装包内的资源目录：打包后是 process.resourcesPath/purge，开发时是仓库 resources/purge。 */
export function bundledPurgeDir(appPath: string, resourcesPath: string, packaged: boolean): string {
  return packaged ? join(resourcesPath, 'purge') : join(appPath, 'resources', 'purge')
}

function currentBundledDir(): string {
  return bundledPurgeDir(app.getAppPath(), process.resourcesPath, app.isPackaged)
}

export function purgePaths(agentDir: string = resolveActiveAgentDir()): {
  extensionFile: string
  configFile: string
  personaFile: string
  purgeDir: string
} {
  const purgeDir = join(agentDir, 'purge')
  return {
    purgeDir,
    extensionFile: join(agentDir, 'extensions', EXTENSION_FILE),
    configFile: join(purgeDir, 'config.json'),
    personaFile: join(purgeDir, 'persona.md'),
  }
}

function readConfigFile(configFile: string): { config: PurgeConfig; error?: string } {
  try {
    if (!existsSync(configFile)) return { config: { ...DEFAULT_CONFIG } }
    const raw = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<PurgeConfig>
    const mode: PurgeMode = raw.mode === 'replace' || raw.mode === 'append' ? raw.mode : 'strict'
    return {
      config: { enabled: raw.enabled === true, mode, source: typeof raw.source === 'string' ? raw.source : '' },
    }
  } catch (error) {
    return { config: { ...DEFAULT_CONFIG }, error: error instanceof Error ? error.message : String(error) }
  }
}

function writeConfigFile(configFile: string, next: PurgeConfig): void {
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

function charCount(file: string): number {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8').trim().length : 0
  } catch {
    return 0
  }
}

/**
 * 把安装包里带的扩展（和人设）落到 agent 目录。
 *   - 扩展：以安装包为准，每次启动覆盖一份，随版本升级自动更新。
 *   - 人设：只在「没有」时补一份，用户改过的内容不会被盖掉。
 */
export function ensurePurgeInstalled(options?: { agentDir?: string; bundledDir?: string }): {
  extensionInstalled: boolean
  personaInstalled: boolean
  bundledPersona: boolean
  error?: string
} {
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  const bundledDir = options?.bundledDir ?? currentBundledDir()
  const paths = purgePaths(agentDir)
  const bundledExt = join(bundledDir, EXTENSION_FILE)
  const bundledPersona = join(bundledDir, 'persona.md')
  const result = {
    extensionInstalled: false,
    personaInstalled: false,
    bundledPersona: existsSync(bundledPersona),
    error: undefined as string | undefined,
  }

  try {
    if (existsSync(bundledExt)) {
      mkdirSync(join(agentDir, 'extensions'), { recursive: true })
      copyFileSync(bundledExt, paths.extensionFile)
      result.extensionInstalled = true
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }

  try {
    if (result.bundledPersona && !existsSync(paths.personaFile)) {
      mkdirSync(paths.purgeDir, { recursive: true })
      copyFileSync(bundledPersona, paths.personaFile)
      result.personaInstalled = true
    }
  } catch (error) {
    result.error = result.error ?? (error instanceof Error ? error.message : String(error))
  }

  return result
}

export function getPurgeState(options?: { agentDir?: string; bundledDir?: string }): PurgeState {
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  const bundledDir = options?.bundledDir ?? currentBundledDir()
  const paths = purgePaths(agentDir)
  const { config, error } = readConfigFile(paths.configFile)
  const personaFile = config.source.trim() || paths.personaFile
  const state: PurgeState = {
    ...config,
    configFile: paths.configFile,
    extensionFile: paths.extensionFile,
    extensionInstalled: existsSync(paths.extensionFile),
    personaFile,
    personaExists: existsSync(personaFile),
    personaChars: charCount(personaFile),
    bundledPersona: existsSync(join(bundledDir, 'persona.md')),
  }
  if (error) state.error = error
  return state
}

export function setPurgeEnabled(enabled: boolean, options?: { agentDir?: string }): PurgeState {
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  const paths = purgePaths(agentDir)
  const { config } = readConfigFile(paths.configFile)
  writeConfigFile(paths.configFile, { ...config, enabled: enabled === true })
  return getPurgeState({ ...options, agentDir })
}

export function setPurgeMode(mode: string, options?: { agentDir?: string }): PurgeState {
  const normalized: PurgeMode = mode === 'replace' || mode === 'append' ? mode : 'strict'
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  const paths = purgePaths(agentDir)
  const { config } = readConfigFile(paths.configFile)
  writeConfigFile(paths.configFile, { ...config, mode: normalized })
  return getPurgeState({ ...options, agentDir })
}

/** 指定人设文件：传空字符串 = 用默认位置 <agentDir>/purge/persona.md。 */
export function setPurgeSource(source: string, options?: { agentDir?: string }): PurgeState {
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  const paths = purgePaths(agentDir)
  const { config } = readConfigFile(paths.configFile)
  writeConfigFile(paths.configFile, { ...config, source: String(source ?? '').trim() })
  return getPurgeState({ ...options, agentDir })
}

/** 把外部文本写成人设文件（设置页「导入人设」用）。 */
export function importPurgePersona(text: string, options?: { agentDir?: string }): PurgeState {
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  const paths = purgePaths(agentDir)
  mkdirSync(paths.purgeDir, { recursive: true })
  writeFileSync(paths.personaFile, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
  const { config } = readConfigFile(paths.configFile)
  writeConfigFile(paths.configFile, { ...config, source: '' })
  return getPurgeState({ ...options, agentDir })
}

export function purgeConfigMtime(options?: { agentDir?: string }): number {
  const agentDir = options?.agentDir ?? resolveActiveAgentDir()
  try {
    return statSync(purgePaths(agentDir).configFile).mtimeMs
  } catch {
    return -1
  }
}
