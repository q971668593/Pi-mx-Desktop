import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  if (raw?.done === true) {
    return { done: true, mode: raw.mode === 'global' ? 'global' : raw.mode === 'builtin' ? 'builtin' : null }
  }
  // 老用户升级上来：这台机器早就装过/用过了，别拿引导弹窗再拦一次。
  const prior = detectPriorInstall()
  if (prior) return completeOnboarding(prior.mode)
  return { done: false, mode: null }
}

/**
 * 「这台机器已经装过了」的判断：只认桌面端自己留下的痕迹 —— 不去看 ~/.pi/agent，
 * 那份 agent 目录可能只是用户在终端里装的 pi，跟本客户端无关。
 *
 * 返回 null = 看起来是全新机器（该弹引导）；否则返回等价的运行环境选择。
 */
export function detectPriorInstall(
  userDataDir: string = app.getPath('userData'),
): { mode: 'builtin' | 'global'; reason: string } | null {
  // 1) 曾经明确选过运行环境（<userData>/sdk/current.json）
  const sdkChoice = readSdkChoice(userDataDir)
  if (sdkChoice) return { mode: sdkChoice, reason: 'sdk/current.json' }
  // 2) 桌面端留下的使用痕迹：会话缓存 / 回合台账 / 快照目录，任意一个在就说明用过了
  for (const marker of ['session-list-cache.v3.json', 'session-list-cache.v2.json', 'run-ledger.json', 'turn-snapshots']) {
    try {
      if (existsSync(join(userDataDir, marker))) return { mode: activeModeOrBuiltin(), reason: marker }
    } catch {
      /* 无权限/路径异常：继续看下一个 */
    }
  }
  const recents = configStore.get('recentProjects')
  if (Array.isArray(recents) && recents.length > 0) return { mode: activeModeOrBuiltin(), reason: 'recentProjects' }
  return null
}

function readSdkChoice(userDataDir: string): 'builtin' | 'global' | null {
  try {
    const file = join(userDataDir, 'sdk', 'current.json')
    if (!existsSync(file)) return null
    const active = (JSON.parse(readFileSync(file, 'utf8')) as { active?: unknown }).active
    if (active === 'global') return 'global'
    // 'user' 是独立安装环境，同属「不跟终端共用」那一类
    if (active === 'builtin' || active === 'user') return 'builtin'
    return null
  } catch {
    return null
  }
}

/** 已经用过但没记过选择：按当前实际生效的 SDK 记一笔，下次启动不再弹。 */
function activeModeOrBuiltin(): 'builtin' | 'global' {
  try {
    return readSdkStatus(app.getPath('userData')).active.kind === 'global' ? 'global' : 'builtin'
  } catch {
    return 'builtin'
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
