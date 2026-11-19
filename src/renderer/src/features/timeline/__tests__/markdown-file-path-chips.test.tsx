import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownView from '../markdown-view'
import { useUIStore } from '@renderer/stores/ui-store'
import { clearResolvedPathCacheForTests } from '@renderer/features/timeline/file-path-chip'

const invoke = vi.fn()
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (...args: unknown[]) => invoke(...args) }, onAppEvent: () => () => {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

const ROOT = 'D:\\workspace\\2026 - 高新国资上报\\V1'
const ABS = 'D:\\workspace\\2026 - 高新国资上报\\V1\\.docs\\对接\\14.BIP报表导出件交付清单.xlsx'

beforeEach(() => {
  clearResolvedPathCacheForTests()
  invoke.mockReset().mockImplementation(async (method: string) => {
    if (method === 'workspace.fs.resolveFileNames') return { ok: true, matches: { '清单.xlsx': ['.docs/对接/清单.xlsx'] } }
    return { ok: true }
  })
  useUIStore.setState({ currentWorkspace: ROOT, activePanel: 'review', rightPanelCollapsed: true, workspaceFileToOpen: null })
})

afterEach(cleanup)

describe('file references in assistant output', () => {
  it('makes a whole fenced code block path clickable and opens it in the Files panel', async () => {
    render(<MarkdownView>{`code fence:\n\n\`\`\`\n${ABS}\n\`\`\``}</MarkdownView>)
    const link = await screen.findByRole('button', { name: ABS })
    fireEvent.click(link)
    await waitFor(() => expect(useUIStore.getState().activePanel).toBe('files'))
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('.docs/对接/14.BIP报表导出件交付清单.xlsx')
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
  })

  it('turns an inline-code path into a link', async () => {
    render(<MarkdownView>{`脚本在 \`${ABS}\`，重跑即可。`}</MarkdownView>)
    fireEvent.click(await screen.findByRole('button', { name: ABS }))
    await waitFor(() => expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('.docs/对接/14.BIP报表导出件交付清单.xlsx'))
  })

  it('links a bare file name in a table cell once the workspace index resolves it', async () => {
    render(<MarkdownView>{'| 文件 | 大小 |\n| --- | --- |\n| 清单.xlsx | 24 KB |'}</MarkdownView>)
    const link = await screen.findByRole('button', { name: '清单.xlsx' })
    expect(invoke).toHaveBeenCalledWith('workspace.fs.resolveFileNames', { workspaceRoot: ROOT, names: ['清单.xlsx'] })
    fireEvent.click(link)
    await waitFor(() => expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('.docs/对接/清单.xlsx'))
  })

  it('leaves an ambiguous bare name as plain text', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'workspace.fs.resolveFileNames') return { ok: true, matches: { '清单.xlsx': ['a/清单.xlsx', 'b/清单.xlsx'] } }
      return { ok: true }
    })
    render(<MarkdownView>{'| 文件 |\n| --- |\n| 清单.xlsx |'}</MarkdownView>)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('workspace.fs.resolveFileNames', expect.anything()))
    expect(screen.queryByRole('button', { name: '清单.xlsx' })).toBeNull()
    expect(screen.getByText('清单.xlsx')).toBeInTheDocument()
  })

  it('links a path mentioned in running text (no spaces, so prose stays prose)', async () => {
    const path = 'D:/workspace/V1/.docs/out/report.xlsx'
    // The running-text detector cannot know where a path with spaces ends, so this case uses a
    // workspace without spaces in its path; the absolute-path case above covers the spacey one.
    useUIStore.setState({ currentWorkspace: 'D:/workspace/V1' })
    render(<MarkdownView>{`生成脚本在 ${path} —— 后续修改跑它即可。`}</MarkdownView>)
    fireEvent.click(await screen.findByRole('button', { name: path }))
    await waitFor(() => expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('.docs/out/report.xlsx'))
  })
})
