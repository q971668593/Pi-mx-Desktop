/**
 * 随安装包内置的 pi 扩展（不写用户的 settings.packages，不动全局 pi）。
 *
 * 目前只有一个：billion-context（上下文压缩，MIT）。它被「塞」进桌面的 worker
 * 会话里，用 pi 的 `additionalExtensionPaths` 直接按文件加载：
 *   - 不装 npm 包、不联外网、不改 ~/.pi/agent/settings.json；
 *   - 终端里的那份 pi 不受影响（只有桌面端的会话吃这个扩展）；
 *   - 关掉设置里的开关，下一次新会话就不再加载。
 *
 * 代价：扩展会拦截本进程发出的模型请求（inline 模式，不起代理进程），所以它
 * 跟着 worker 的存活期走，worker 重启即重新初始化。
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configStore } from './config-store'
import { getAgentRuntimeConfig } from './wsl/runtime-config'

/** 安装包里这一份的目录名（resources/billion-context）。 */
export const BUILTIN_CONTEXT_PACKAGE_DIR = 'billion-context'
/** pi 包清单里声明的扩展入口，相对包根。 */
const ENTRY_REL = ['dist', 'agent', 'billion-context.js'] as const

/** 安装包内的资源目录：打包后是 process.resourcesPath/billion-context，开发时是仓库 resources/billion-context。 */
export function bundledContextExtensionDir(appPath: string, resourcesPath: string, packaged: boolean): string {
  return packaged ? join(resourcesPath, BUILTIN_CONTEXT_PACKAGE_DIR) : join(appPath, 'resources', BUILTIN_CONTEXT_PACKAGE_DIR)
}

/** 扩展入口文件；安装包里没带（或路径异常）时返回 null。 */
export function bundledContextExtensionEntry(
  appPath: string,
  resourcesPath: string,
  packaged: boolean,
): string | null {
  // 首选 standard 位置；老安装包/绿色版把 resources 放 exe 旁边时，再看 exe 的同级目录。
  const candidates = [
    bundledContextExtensionDir(appPath, resourcesPath, packaged),
    join(dirname(process.execPath), 'resources', BUILTIN_CONTEXT_PACKAGE_DIR),
  ]
  for (const candidate of candidates) {
    try {
      const entry = join(candidate, ...ENTRY_REL)
      if (existsSync(entry)) return entry
    } catch {
      /* 无权限/路径异常：看下一个候选 */
    }
  }
  return null
}

function currentEntry(): string | null {
  return bundledContextExtensionEntry(app.getAppPath(), process.resourcesPath, app.isPackaged)
}

/** 这个版本的安装包里到底有没有带扩展（设置页据此显示「可用/未随包提供」）。 */
export function isBundledContextExtensionAvailable(): boolean {
  return currentEntry() !== null
}

/**
 * 交给 worker 的额外扩展文件列表。
 * 开关关闭、包里没带、或跑在 WSL 里（WSL 内的 node 读不到 Windows 侧资源）时返回空。
 */
export function builtinExtensionPathsForWorker(): string[] {
  if (configStore.get('builtinBillionContext') === false) return []
  try {
    if (getAgentRuntimeConfig().mode === 'wsl') return []
  } catch {
    /* 读不到运行环境配置就按宿主机处理 */
  }
  const entry = currentEntry()
  return entry ? [entry] : []
}
