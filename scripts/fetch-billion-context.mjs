#!/usr/bin/env node
/**
 * 拉取内置上下文压缩扩展（billion-context）的运行文件到 resources/billion-context/dist。
 *
 * 为什么需要这个脚本：
 *   `resources/billion-context/dist/` 不进 git（根 .gitignore 里显式忽略，约 6.3MB 的
 *   压缩引擎产物）。electron-builder.yml 会把整个 `resources/billion-context` 拷进安装包，
 *   但 clean clone 里没有 dist，打出来的包内置扩展就是「未随包提供」，设置页开关形同虚设。
 *   所以打包前必须先跑一次本脚本。
 *
 * 只取 pi 宿主需要的最小集合（见 resources/billion-context/README.md）：
 *   dist/agent/billion-context.js   42 字节转发入口
 *   dist/agent/pi-native.js         自包含引擎（只依赖 node 内置模块）
 *   dist/build-info.json            版本来源
 *   LICENSE / package.json          已在仓库里，不从 npm 覆盖
 *
 * 用法：
 *   node scripts/fetch-billion-context.mjs              # 从 npm 取 package.json 里锁的版本
 *   node scripts/fetch-billion-context.mjs --check      # 只检查 dist 在不在，不下载
 *   node scripts/fetch-billion-context.mjs --require    # 打包闸门：缺 dist 就失败
 *   node scripts/fetch-billion-context.mjs --version 0.1.216
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_DIR = join(ROOT, 'resources', 'billion-context')
const PKG_JSON = join(PKG_DIR, 'package.json')
const DIST_DIR = join(PKG_DIR, 'dist')
const ENTRY = join(DIST_DIR, 'agent', 'billion-context.js')
const ENGINE = join(DIST_DIR, 'agent', 'pi-native.js')

const argv = process.argv.slice(2)
const checkOnly = argv.includes('--check')
const requireDist = argv.includes('--require')
const versionArg = (() => {
  const i = argv.indexOf('--version')
  return i !== -1 ? argv[i + 1] : null
})()

function readLockedVersion() {
  try {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'))
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : null
  } catch {
    return null
  }
}

function distReady() {
  return existsSync(ENTRY) && existsSync(ENGINE)
}

if (checkOnly) {
  console.log(distReady() ? `ok: ${DIST_DIR}` : `missing: ${DIST_DIR}（打包后内置扩展不会生效）`)
  process.exit(distReady() || !requireDist ? 0 : 1)
}

if (distReady() && !versionArg) {
  const v = readLockedVersion() ?? 'unknown'
  console.log(`[billion-context] 已有 dist（package.json 版本 ${v}），跳过下载。`)
  console.log('[billion-context] 需要强制重拉时加 --version <x.y.z>。')
  process.exit(0)
}

const version = versionArg ?? readLockedVersion()
if (!version) {
  const msg = `[billion-context] 读不到 ${PKG_JSON} 里的 version，也没给 --version`
  if (requireDist) {
    console.error(msg)
    process.exit(1)
  }
  console.log(msg)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'billion-context-'))
const registry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org'

try {
  const spec = `billion-context@${version}`
  console.log(`[billion-context] 拉取 ${spec}（registry: ${registry}）`)
  const tgz = execFileSync('npm', ['pack', spec, `--registry=${registry}`, '--pack-destination', work], {
    cwd: work,
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  })
    .toString()
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop()
  if (!tgz) throw new Error('npm pack 没有返回 tarball 名')

  // Windows 自带 bsdtar，Linux/macOS 是 GNU tar：都支持只解指定成员
  for (const member of ['package/dist/agent/billion-context.js', 'package/dist/agent/pi-native.js', 'package/dist/build-info.json']) {
    execFileSync('tar', ['-xzf', tgz, member], { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' })
  }

  const srcDist = join(work, 'package', 'dist')
  if (!existsSync(join(srcDist, 'agent', 'billion-context.js'))) {
    throw new Error(`tarball 里没有 dist/agent/billion-context.js（${spec}）`)
  }
  mkdirSync(DIST_DIR, { recursive: true })
  cpSync(join(srcDist, 'agent'), join(DIST_DIR, 'agent'), { recursive: true })
  const info = join(srcDist, 'build-info.json')
  if (existsSync(info)) cpSync(info, join(DIST_DIR, 'build-info.json'))
  console.log(`[billion-context] 写入 ${DIST_DIR}`)
  console.log(distReady() ? '[billion-context] ok' : '[billion-context] 校验失败：入口文件没落地')
  process.exit(distReady() ? 0 : 1)
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error)
  if (requireDist) {
    console.error(`[billion-context] 打包中止：${msg}`)
    console.error('[billion-context] 手动补：npm pack billion-context@<ver> 后把 dist/ 拷进 resources/billion-context/')
    process.exit(1)
  }
  console.log(`[billion-context] 跳过：${msg}`)
  process.exit(0)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    /* 临时目录清理失败不影响结果 */
  }
}
