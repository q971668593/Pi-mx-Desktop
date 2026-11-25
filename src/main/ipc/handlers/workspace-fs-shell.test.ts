import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import { registerWorkspaceFsHandlers } from './workspace-fs'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: { path: string }) => Promise<unknown>>(),
  runtime: { mode: 'wsl', distro: 'Ubuntu' },
}))
vi.mock('electron', () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), trashItem: vi.fn() } }))
vi.mock('../registry', () => ({
  registerHandlerWithSchema: (name: string, _schema: unknown, handler: (req: { path: string }) => Promise<unknown>) => mocks.handlers.set(name, handler),
}))
vi.mock('../../wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => mocks.runtime }))

beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.mocked(shell.openPath).mockReset().mockResolvedValue('')
  vi.mocked(shell.showItemInFolder).mockReset()
  mocks.runtime.mode = 'wsl'
  registerWorkspaceFsHandlers()
})
afterEach(() => vi.restoreAllMocks())

describe('workspace shell file operations', () => {
  it.each([
    ['/home/user/output/实验报告.pdf', '\\\\wsl.localhost\\Ubuntu\\home\\user\\output\\实验报告.pdf'],
    ['/mnt/d/reports/实验报告.pdf', 'D:\\reports\\实验报告.pdf'],
    ['C:\\reports\\report.pdf', 'C:\\reports\\report.pdf'],
    ['\\\\wsl.localhost\\Debian\\home\\user\\report.pdf', '\\\\wsl.localhost\\Debian\\home\\user\\report.pdf'],
  ])('opens and reveals the host path for %s', async (path, expected) => {
    await expect(mocks.handlers.get('ipc:shell.openPath')!({ path })).resolves.toEqual({ ok: true })
    await mocks.handlers.get('ipc:shell.showItemInFolder')!({ path })
    expect(shell.openPath).toHaveBeenCalledWith(expected)
    expect(shell.showItemInFolder).toHaveBeenCalledWith(expected)
  })

  it('surfaces shell failures instead of reporting success', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('File not found')
    await expect(mocks.handlers.get('ipc:shell.openPath')!({ path: '/home/user/missing.pdf' })).resolves.toEqual({ ok: false, error: 'File not found' })
  })

  it('reveals executables instead of launching them', async () => {
    await expect(mocks.handlers.get('ipc:shell.openPath')!({ path: '/home/user/tools/setup.exe' }))
      .resolves.toEqual({ ok: true, revealed: true })
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.showItemInFolder).toHaveBeenCalledWith('\\\\wsl.localhost\\Ubuntu\\home\\user\\tools\\setup.exe')
  })

  it('preserves native Linux and host-runtime paths', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await mocks.handlers.get('ipc:shell.openPath')!({ path: '/home/user/report.pdf' })
    expect(shell.openPath).toHaveBeenLastCalledWith('/home/user/report.pdf')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    mocks.runtime.mode = 'host'
    await mocks.handlers.get('ipc:shell.openPath')!({ path: 'C:\\report.pdf' })
    expect(shell.openPath).toHaveBeenLastCalledWith('C:\\report.pdf')
  })

  it('refuses to trash the workspace root itself', async () => {
    await expect(mocks.handlers.get('ipc:workspace.fs.trash')!({ workspaceRoot: 'C:\\proj', relativePath: '.' }))
      .resolves.toEqual({ ok: false, error: 'refuse_root' })
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('reports missing files instead of trashing', async () => {
    await expect(mocks.handlers.get('ipc:workspace.fs.trash')!({ workspaceRoot: 'C:\\proj', relativePath: 'nope.txt' }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('trashes a real file through the OS recycle bin', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, basename } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'trash-test-'))
    await writeFile(join(dir, 'a.txt'), 'x')
    vi.mocked(shell.trashItem).mockResolvedValue(undefined)
    await expect(mocks.handlers.get('ipc:workspace.fs.trash')!({ workspaceRoot: dir, relativePath: 'a.txt' }))
      .resolves.toEqual({ ok: true })
    expect(shell.trashItem).toHaveBeenCalledWith(join(dir, 'a.txt'))
    expect(basename(dir)).toMatch(/^trash-test-/)
  })
})
