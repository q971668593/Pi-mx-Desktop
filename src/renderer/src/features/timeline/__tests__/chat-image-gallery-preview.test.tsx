import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChatImageGallery } from '../chat-image'

const invoke = vi.fn()
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (...args: unknown[]) => invoke(...args) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

const ROOT = 'D:\\workspace\\demo'

beforeEach(async () => {
  if (i18n.language !== 'zh') await i18n.changeLanguage('zh')
  invoke.mockReset()
  useUIStore.setState({ currentWorkspace: ROOT })
})

afterEach(cleanup)

describe('ChatImageGallery', () => {
  it('renders a webp thumbnail when the main process resolves the short path', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'shell.readImagePreview'
        ? { ok: true, dataUrl: 'data:image/webp;base64,AAAA', mimeType: 'image/webp', path: `${ROOT}\\web\\public\\images\\honors\\honor-1.webp` }
        : { ok: true },
    )
    render(<ChatImageGallery text={'honors/honor-1.webp: 200 138518'} />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('shell.readImagePreview', { workspaceRoot: ROOT, path: 'honors/honor-1.webp' }))
    const img = await screen.findByRole('img', { name: 'honor-1.webp' })
    expect(img.getAttribute('src')).toBe('data:image/webp;base64,AAAA')
  })

  it('shows a readable fallback instead of a dead grey tile when the file cannot be read', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'shell.readImagePreview' ? { ok: false, error: 'not_found' } : { ok: true },
    )
    render(<ChatImageGallery text={'honors/missing.webp'} />)
    expect(await screen.findByText('无法预览（文件可能不在项目内或格式不支持）')).toBeInTheDocument()
    expect(screen.getByText('missing.webp')).toBeInTheDocument()
  })

  it('never fetches when there is no workspace', async () => {
    useUIStore.setState({ currentWorkspace: null })
    render(<ChatImageGallery text={'a/honor-1.webp'} />)
    await waitFor(() => expect(screen.getByText('无法预览（文件可能不在项目内或格式不支持）')).toBeInTheDocument())
    expect(invoke).not.toHaveBeenCalledWith('shell.readImagePreview', expect.anything())
  })
})
