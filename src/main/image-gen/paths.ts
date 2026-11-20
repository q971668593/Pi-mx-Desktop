/**
 * 生图身份需要的落盘目录。
 *
 * device id 要像浏览器一样长期稳定，所以存在 userData 下；测试/工具场景可以用
 * `PI_IMAGE_DEVICE_DIR` 指定，拿不到 Electron 时返回 null（退回内存态，不影响出图）。
 */
import { createRequire } from 'node:module'

// 不叫 require：打包进 ESM chunk 时和 bundler 的 require 垫片重名会直接语法错误。
const nodeRequire = createRequire(import.meta.url)

export function imageDeviceDir(): string | null {
  const override = process.env.PI_IMAGE_DEVICE_DIR
  if (override) return override
  try {
    const electron = nodeRequire('electron') as { app?: { getPath: (name: string) => string } }
    return electron.app?.getPath('userData') ?? null
  } catch {
    return null
  }
}
