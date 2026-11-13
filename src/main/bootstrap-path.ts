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
