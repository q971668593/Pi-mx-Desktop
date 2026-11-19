import { dialog, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { purgeSetEnabledSchema, purgeSetModeSchema } from '../schemas'
import {
  ensurePurgeInstalled,
  getPurgeState,
  importPurgePersona,
  setPurgeEnabled,
  setPurgeMode,
} from '../../purge/controller'

/** 装 + 读：设置页每次打开都先补装一次，升级后不用手动找文件。 */
function stateAfterEnsure() {
  const install = ensurePurgeInstalled()
  const state = getPurgeState()
  return install.error ? { ...state, error: install.error } : state
}

export function registerPurgeHandlers(): void {
  registerHandler('ipc:purge.getState', async () => stateAfterEnsure())

  registerHandlerWithSchema('ipc:purge.setEnabled', purgeSetEnabledSchema, async (req) => {
    ensurePurgeInstalled()
    return setPurgeEnabled(req.enabled)
  })

  registerHandlerWithSchema('ipc:purge.setMode', purgeSetModeSchema, async (req) => setPurgeMode(req.mode))

  registerHandler('ipc:purge.reinstall', async () => {
    const install = ensurePurgeInstalled()
    const state = getPurgeState()
    return { ...state, personaInstalled: install.personaInstalled, error: install.error }
  })

  // 选一个本地 markdown 当人设，复制进 agent 目录（不直接引用外部路径，换机器更稳）
  registerHandler('ipc:purge.choosePersona', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const opts = {
      title: '选择人设文件',
      properties: ['openFile' as const],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    }
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return getPurgeState()
    const text = readFileSync(picked.filePaths[0], 'utf8')
    return importPurgePersona(text)
  })
}
