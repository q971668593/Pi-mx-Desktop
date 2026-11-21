import { spawnSync } from 'node:child_process'
import { app } from 'electron'
import { configStore } from './config-store'
import { checkNpmAvailable, invalidateSdkManagerCaches, readSdkStatus } from './sdk-manager'

/**
 * 首次启动的运行环境引导。
 *
 * 目标：新用户不用先懂 node/npm，也不用看"目标失败：预期 global，实际 builtin"这种黑话。
 * 两条路——内置（开箱即用，随应用升级）或全局（推荐，和终端里的 pi 共用一份）。
 * 选全局时先体检 node/npm/pi，再一键装，装完立刻校验。
 */

export type RuntimeOnboarding = {
  done: boolean
  mode: 'builtin' | 'global' | null
}

export type ToolchainProbe = {
  node: boolean
  nodeVersion: string | null
  npm: boolean
  npmVersion: string | null
  /** 全局 pi 是否已经可用（能解析到版本）。 */
  pi: boolean
  piVersion: string | null
  npmGlobalRoot: string | null
  error?: string
}

const STORAGE_KEY = 'runtimeOnboarding'

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: true, timeout: 8000, windowsHide: true })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
    return { ok: !r.error && r.status === 0, out }
  } catch {
    return { ok: false, out: '' }
  }
}

export function readOnboarding(): RuntimeOnboarding {
  const raw = configStore.get(STORAGE_KEY) as Partial<RuntimeOnboarding> | undefined
  return {
    done: raw?.done === true,
    mode: raw?.mode === 'global' ? 'global' : raw?.mode === 'builtin' ? 'builtin' : null,
  }
}

export function completeOnboarding(mode: 'builtin' | 'global'): RuntimeOnboarding {
  const next: RuntimeOnboarding = { done: true, mode }
  configStore.set(STORAGE_KEY, next)
  return next
}

/** node / npm / 全局 pi 的一次性体检（给引导页与设置页共用）。 */
export function probeToolchain(): ToolchainProbe {
  const nodeRun = run('node', ['--version'])
  const npmRun = run('npm', ['--version'])
  const status = readSdkStatus(app.getPath('userData'))
  const root = run('npm', ['root', '-g'])
  return {
    node: nodeRun.ok,
    nodeVersion: nodeRun.ok ? nodeRun.out.replace(/^v/, '') : null,
    npm: npmRun.ok || checkNpmAvailable(),
    npmVersion: npmRun.ok ? npmRun.out : null,
    pi: !!status.globalVersion,
    piVersion: status.globalVersion,
    npmGlobalRoot: root.ok ? root.out : null,
    ...(nodeRun.ok && npmRun.ok ? {} : { error: nodeRun.ok ? 'npm_missing' : 'node_missing' }),
  }
}

/** 安装完成后清缓存，让下一次 SDK 解析立刻看到新的全局版本。 */
export function afterGlobalInstall(): void {
  invalidateSdkManagerCaches()
}
