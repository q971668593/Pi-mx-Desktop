import { spawn } from 'node:child_process'

/**
 * 终止指定进程及其子进程树：
 * Windows ConPTY / Worker 强杀时仅调 kill() 往往只结束外层壳进程，留下 node/vite/tsc 等孤儿进程持续占 CPU。
 */
export function killProcessTree(pid: number | undefined | null): void {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    try {
      const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', () => {})
      child.unref()
    } catch {
      /* ignore */
    }
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    /* not a process group leader or already exited */
  }
}
