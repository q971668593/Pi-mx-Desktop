/**
 * 把项目自身版本号提升到指定版本，只改根级字段，不碰依赖包同名的版本号。
 *
 * package-lock.json 里根版本出现在两个位置：`version`（顶层）和
 * `packages[""].version`；其余同值都是依赖自己的版本，必须原样保留。
 *
 * 用法: node scripts/bump-version.mjs <新版本号>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const next = String(process.argv[2] || '').trim()
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('用法: node scripts/bump-version.mjs <x.y.z>')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const previous = pkg.version
pkg.version = next
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

const lockPath = join(root, 'package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
lock.version = next
if (lock.packages?.['']) lock.packages[''].version = next
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')

console.log(`version: ${previous} -> ${next}`)
