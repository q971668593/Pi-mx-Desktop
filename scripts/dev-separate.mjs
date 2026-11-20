#!/usr/bin/env node
/**
 * 开发模式（独立 profile）。
 *
 * 主应用开着时，`npm run dev` 会因为它已经持有单实例锁而静默退出。这个脚本给开发实例
 * 一个独立 userData（默认 <userData 同级>/pi-desktop-dev，可用 PI_DEV_USER_DATA 覆盖），
 * 于是两边的项目、单实例锁、窗口都不打架；想看 HMR 时用这个命令。
 *
 * 另外这里显式给 electron 一个真实入口文件：让 electron 自己解析 `.`（读 package.json
 * 的 main）在本机实测会「构建全绿、electron 一句话不说就退」，日志里查不到原因。
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

delete process.env.ELECTRON_RUN_AS_NODE

const userData = process.env.PI_DEV_USER_DATA || join(homedir(), 'AppData', 'Roaming', 'pi-desktop-dev')
process.env.ELECTRON_CLI_ARGS = JSON.stringify([`--user-data-dir=${userData}`])
// 主进程也认这个变量（bootstrap-path 会 app.setPath('userData')）：光靠命令行
// --user-data-dir 在本机实测不总是落到子进程上，而这里必须确保它真的生效。
process.env.PI_DEV_USER_DATA = userData
process.env.ELECTRON_ENTRY ||= 'out/main/index.js'
console.log(`[dev] separate profile: ${userData}`)

// 直接用 `node scripts/dev-separate.mjs` 跑时 PATH 里没有 node_modules/.bin，补上，
// 否则 Windows 会报「'electron-vite' 不是内部或外部命令」。
process.env.PATH = `${join(process.cwd(), 'node_modules', '.bin')}${delimiter}${process.env.PATH || ''}`

const child = spawn('electron-vite', ['dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})
child.on('exit', (code, signal) => {
  if (signal) return process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
child.on('error', (error) => {
  console.error('[dev] 启动 electron-vite 失败:', error.message)
  process.exit(1)
})
