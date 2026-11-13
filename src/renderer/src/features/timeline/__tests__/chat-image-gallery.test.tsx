import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatImageGallery } from '../chat-image'
import MarkdownView from '../markdown-view'
import { ToolCallRow } from '../tool-call-row'

const invoke = vi.hoisted(() => vi.fn(async (method: string) => {
  if (method === 'shell.readImagePreview') return { ok: true, dataUrl: 'data:image/png;base64,eA==' }
  if (method === 'clipboard.copyImageFile') return { ok: true }
  if (method === 'dialog:saveImage') return { ok: true, canceled: false, path: 'C:/saved.png' }
  if (method === 'clipboard.writeTempImage') return { path: 'C:/temp/annotated.png' }
  return { ok: false }
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: (method: string) => invoke(method) } }))
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentWorkspace: 'C:/project',
    runState: { status: 'idle', activeRunId: null },
    toolExpandBySession: {},
    historySessionFile: '',
    setToolCallExpanded: () => undefined,
  }),
}))

const image = 'C:\\project\\generated\\poster.png'

describe('chat image gallery', () => {
  beforeEach(() => invoke.mockClear())

  it('shows a generated image inside markdown and opens its actions', async () => {
    render(<MarkdownView>{`Saved to ${image}`}</MarkdownView>)
    const button = await screen.findByRole('button', { name: 'image.openNamed' })
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,eA==')
    fireEvent.click(button)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.contextMenu(button)
    fireEvent.click(screen.getByRole('button', { name: 'image.copy' }))
    await waitFor(() => expect(invoke.mock.calls.some(([method]) => method === 'clipboard.copyImageFile')).toBe(true))
  })

  it('shows an image returned inside a collapsed tool result', async () => {
    render(<ToolCallRow item={{ id: 'tool-1', toolName: 'generate_image', toolOutput: JSON.stringify({ content: [{ type: 'text', text: `saved ${image}` }] }) }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('img')).toBeTruthy()
  })

  it('adds an annotation directly to the composer with its preview', async () => {
    const attached = vi.fn()
    window.addEventListener('pi-desktop:composer-attach-files', attached)
    render(<ChatImageGallery text={image} />)
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'image.openNamed' }))
    fireEvent.click(screen.getByRole('button', { name: 'image.annotate' }))
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    canvas.width = 4
    canvas.height = 4
    canvas.toDataURL = () => 'data:image/png;base64,annotated'
    fireEvent.click(screen.getByRole('button', { name: 'image.addToChat' }))
    await waitFor(() => expect(attached).toHaveBeenCalled())
    expect(attached.mock.calls[0][0].detail.files[0]).toMatchObject({ path: 'C:/temp/annotated.png', dataUrl: 'data:image/png;base64,annotated' })
    window.removeEventListener('pi-desktop:composer-attach-files', attached)
  })

  it('shows an animated placeholder card while an image generation tool is running', () => {
    render(
      <ToolCallRow
        item={{
          id: 'tool-gen-1',
          toolName: 'magpie_image/generate_image',
          toolPhase: 'start',
          toolArgs: { prompt: '喜茶国庆节海报，中国风红金质感' },
        }}
      />,
    )
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('image.generating')).toBeTruthy()
    expect(screen.getByText('喜茶国庆节海报，中国风红金质感')).toBeTruthy()
  })

  it('supports wheel zoom and right-click actions inside the enlarged preview', async () => {
    const attached = vi.fn()
    window.addEventListener('pi-desktop:composer-attach-files', attached)
    render(<ChatImageGallery text={image} />)
    const thumb = await screen.findByRole('button', { name: 'image.openNamed' })
    fireEvent.click(thumb)

    const dialog = screen.getByRole('dialog')
    fireEvent.wheel(dialog, { deltaY: -120 })
    expect(screen.getByRole('button', { name: /112% ·/ })).toBeTruthy()

    fireEvent.contextMenu(dialog, { clientX: 120, clientY: 120 })
    const menu = screen.getByRole('menu')
    expect(menu).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /image\.addToChat$/ }))
    await waitFor(() => expect(attached).toHaveBeenCalled())
    expect(attached.mock.calls[0][0].detail.files[0]).toMatchObject({ path: image })

    fireEvent.contextMenu(dialog, { clientX: 120, clientY: 120 })
    fireEvent.click(screen.getByRole('button', { name: /image\.annotate$/ }))
    expect(document.querySelector('canvas')).toBeTruthy()
    window.removeEventListener('pi-desktop:composer-attach-files', attached)
  })
})
