import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { absoluteMentionedPath, FilePathChip, clearResolvedPathCacheForTests } from '../file-path-chip'

const invoke = vi.fn()
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (...args: unknown[]) => invoke(...args) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

const ROOT = 'D:\\workspace\\demo'
const ABS = 'D:\\workspace\\demo\\docs\\61.对客图示版.html'

beforeEach(async () => {
  clearResolvedPathCacheForTests()
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
  invoke.mockReset().mockImplementation(async () => ({ ok: true }))
  useUIStore.setState({ currentWorkspace: ROOT, activePanel: 'review', rightPanelCollapsed: true, workspaceFileToOpen: null })
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => {}) },
  })
})

afterEach(cleanup)

describe('absoluteMentionedPath', () => {
  it('keeps absolute paths and joins relative ones onto the workspace', () => {
    expect(absoluteMentionedPath(ABS, ROOT)).toBe(ABS)
    expect(absoluteMentionedPath('docs/a.html', ROOT)).toBe('D:\\workspace\\demo/docs/a.html')
    expect(absoluteMentionedPath('./docs/a.html', ROOT)).toBe('D:\\workspace\\demo/docs/a.html')
    expect(absoluteMentionedPath('\\\\.\\pipe\\x', ROOT)).toBe('\\\\.\\pipe\\x')
  })
})

describe('FilePathChip right-click menu', () => {
  it('offers copy path and reveal in explorer on a file path', async () => {
    render(<FilePathChip text={ABS} />)
    const chip = screen.getByRole('button', { name: ABS })
    fireEvent.contextMenu(chip, { clientX: 40, clientY: 60 })

    const menu = await screen.findByRole('menu', { name: '文件操作' })
    expect(menu).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: '复制路径' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ABS))
    expect(screen.queryByRole('menu', { name: '文件操作' })).toBeNull()
  })

  it('reveals the file in the OS file manager', async () => {
    render(<FilePathChip text={ABS} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: ABS }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '在文件资源管理器中打开' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('shell.showItemInFolder', { path: ABS }))
  })

  it('still opens the file on a plain left click', async () => {
    render(<FilePathChip text={ABS} />)
    fireEvent.click(screen.getByRole('button', { name: ABS }))
    await waitFor(() =>
      expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('docs/61.对客图示版.html'),
    )
  })
})
