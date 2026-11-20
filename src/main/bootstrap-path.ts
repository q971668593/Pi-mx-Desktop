import fixPath from 'fix-path'
import { app } from 'electron'
import { shellEnvSync } from 'shell-env'
import { mergeLoginShellEnvironment } from './login-shell-environment'
import { applyPortableDataDirs } from './portable-data-dir'

try {
  applyPortableDataDirs(app)
} catch {
  /* keep default Electron userData path if portable detection fails */
}

// 开发实例的独立 userData。
//
// 主应用（打包版）开着时两者默认共用 ~/AppData/Roaming/pi-desktop：单实例锁会互相顶
// （后启动的那个拿到 gotLock=false，app.quit() 且日志里一句话都没有），配置文件也会
// 互相覆盖。dev:separate 通过 PI_DEV_USER_DATA 指定目录，这里在**任何 store 创建之前**
// 落盘，否则 electron-store 已经按旧路径读完了。
const devUserDataDir = process.env.PI_DEV_USER_DATA?.trim()
if (devUserDataDir && !app.isPackaged) {
  try {
    app.setPath('userData', devUserDataDir)
  } catch {
    console.warn('[bootstrap] 无法应用 PI_DEV_USER_DATA:', devUserDataDir)
  }
}

if (process.platform === 'darwin') {
  try {
    const mergedEnvironment = mergeLoginShellEnvironment({
      launchEnvironment: { ...process.env },
      loginShellEnvironment: shellEnvSync(),
      pathDelimiter: ':',
    })

    for (const [variableName, variableValue] of Object.entries(mergedEnvironment)) {
      if (typeof variableValue === 'string') process.env[variableName] = variableValue
    }
  } catch {
    console.warn('[bootstrap] Unable to load the macOS login shell environment')
  }
} else {
  fixPath()
}
