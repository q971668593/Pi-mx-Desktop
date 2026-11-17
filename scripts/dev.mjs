#!/usr/bin/env node
/**
 * 启动开发模式。
 *
 * 背景：如果当前终端（或启动它的 IDE/宿主进程）带着 ELECTRON_RUN_AS_NODE=1，
 * electron.exe 会退化成纯 Node 运行，electron 模块只剩一个字符串导出，
 * 主进程 ESM 里的 `import { BrowserWindow } from 'electron'` 会直接报
 * "does not provide an export named 'BrowserWindow'"。
 *
 * 这里在子进程启动前把这个变量清掉，保证不管从哪个终端跑 npm run dev 都正常。
 */
import { spawn } from 'node:child_process'

delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn('electron-vite', ['dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error('[dev] 启动 electron-vite 失败:', error.message)
  process.exit(1)
})
