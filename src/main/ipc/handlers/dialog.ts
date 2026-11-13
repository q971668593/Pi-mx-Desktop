import { basename, extname } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { dialog, BrowserWindow, nativeImage } from 'electron'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { dialogSaveImageSchema } from '../schemas'
import { resolveActionableImage } from '../../image-file-access'

export function registerDialogHandlers(): void {
  registerHandler('ipc:dialog:openDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择项目目录' })
      : await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择项目目录' })
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null }
    }
    return { path: result.filePaths[0] }
  })

  registerHandler('ipc:dialog:openFiles', async (req) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const props: ('openFile' | 'multiSelections')[] = ['openFile']
    if (req?.multiple !== false) props.push('multiSelections')
    const opts = {
      properties: props,
      title: req?.title || '添加附件',
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) {
      return { paths: [] as string[] }
    }
    return { paths: result.filePaths }
  })

  registerHandlerWithSchema('ipc:dialog:saveImage', dialogSaveImageSchema, async (req) => {
    const loaded = req.data
      ? { image: nativeImage.createFromBuffer(Buffer.from(req.data, 'base64')), extension: 'png' }
      : await imageFromPath(req.path, req.workspaceRoot)
    if ('error' in loaded) return { ok: false as const, error: loaded.error }
    const image = loaded.image
    if (image.isEmpty()) return { ok: false as const, error: 'not_image' }
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const extension = loaded.extension
    const filters = [
      { name: 'PNG', extensions: ['png'] },
      { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
      { name: 'WebP', extensions: ['webp'] },
      { name: 'GIF', extensions: ['gif'] },
      { name: 'BMP', extensions: ['bmp'] },
    ]
    const preferred = filters.find((filter) => filter.extensions.includes(extension))
    const opts = {
      title: '\u53e6\u5b58\u4e3a\u56fe\u7247',
      defaultPath: req.suggestedName || basename(req.path),
      filters: preferred ? [preferred, ...filters.filter((filter) => filter !== preferred)] : filters,
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return { ok: true as const, canceled: true as const }
    const outputExtension = extname(result.filePath).replace(/^\./, '').toLowerCase()
    const bytes = outputExtension === 'jpg' || outputExtension === 'jpeg' ? image.toJPEG(92) : image.toPNG()
    await writeFile(result.filePath, bytes)
    return { ok: true as const, canceled: false as const, path: result.filePath }
  })
}

async function imageFromPath(path: string, workspaceRoot?: string) {
  const source = await resolveActionableImage(path, workspaceRoot)
  if ('error' in source) return source
  return { image: nativeImage.createFromPath(source.abs), extension: extname(source.abs).replace(/^\./, '').toLowerCase() }
}
