import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { WORKSPACE_TEXT_MAX_BYTES } from '@shared/workspace-preview'
import { ipcClient } from '@renderer/lib/ipc-client'
import { FilePreviewRouter } from './file-preview-router'
import { clearFileDraft, getFileDraft } from './file-edit-guard'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn() } }))
// i18n resources load async in unit tests; pin the translation to the key for determinism.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@renderer/features/timeline/markdown-view', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }))
vi.mock('./file-source-preview', () => ({ FileSourcePreview: ({ code, sourceLocation }: { code: string; sourceLocation?: { line: number } }) => <pre data-line={sourceLocation?.line}>{code}</pre> }))
afterEach(() => {
  cleanup()
  clearFileDraft('/ws', '账号密码.md')
  vi.mocked(ipcClient.invoke).mockReset()
})
const findEditor = (container: HTMLElement) => {
  const host = container.querySelector<HTMLElement>('.cm-editor')
  return host ? EditorView.findFromDOM(host) : null
}
describe('file preview', () => {
  it('opens Markdown line references as source and reads beyond the usual preview prefix', async () => {
    const readText = vi.fn().mockResolvedValue({ ok: true, content: '# heading\nsource line' })
    const { container } = render(<FilePreviewRouter workspaceRoot="/ws" relativePath="readme.md" readText={readText} sourceLocation={{ line: 2 }} />)
    await screen.findByText('# heading source line')
    expect(container.querySelector('pre')).toHaveAttribute('data-line', '2')
    expect(readText).toHaveBeenCalledWith('readme.md', { maxBytes: WORKSPACE_TEXT_MAX_BYTES })
  })
  it('marks truncated text and lets the user load more without losing the prefix', async () => {
    const readText = vi.fn().mockResolvedValueOnce({ ok: true, content: 'partial content', size: 600000, truncated: true }).mockResolvedValue({ ok: true, content: 'complete content', size: 600000, truncated: false })
    render(<FilePreviewRouter workspaceRoot="/ws" relativePath="large.txt" readText={readText} />)
    await screen.findByText('partial content')
    fireEvent.click(screen.getByRole('button', { name: 'preview.tryExpandRead' }))
    await screen.findByText('complete content')
    expect(screen.queryByRole('button', { name: 'preview.tryExpandRead' })).toBeNull()
  })
  it('allows HTML animation scripts without same-origin or top-navigation privileges', async () => {
    const readText = vi.fn().mockResolvedValue({ ok: true, content: '<script>requestAnimationFrame(() => {})</script>', size: 60 })
    render(<FilePreviewRouter workspaceRoot="/ws" relativePath="动画.html" readText={readText} />)
    // Non-markdown files open in edit mode; switch back to the rendered preview.
    fireEvent.click(await screen.findByRole('button', { name: 'preview.ready' }))
    const frame = await screen.findByTitle('html-preview')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy')
    expect(frame.getAttribute('srcdoc')).toContain('connect-src')
  })
  it('does not mark an untouched CRLF file as modified after entering edit mode', async () => {
    const readText = vi.fn().mockResolvedValue({ ok: true, content: '阿里云:\r\nluyaomeng3\r\n' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<FilePreviewRouter workspaceRoot="/ws" relativePath="账号密码.md" readText={readText} />)
    fireEvent.click(await screen.findByRole('button', { name: 'preview.edit' }))
    await waitFor(() => expect(findEditor(container)).not.toBeNull())
    // The editor normalizes CRLF to LF on mount; that must not count as a user edit.
    await waitFor(() => expect(getFileDraft('/ws', '账号密码.md')).toBeUndefined())
    await waitFor(() => expect(screen.queryByText('preview.unsaved')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'preview.ready' }))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
  it('saves an edited CRLF file with its original line endings', async () => {
    const readText = vi.fn().mockResolvedValue({ ok: true, content: '阿里云:\r\nluyaomeng3\r\n' })
    vi.mocked(ipcClient.invoke).mockResolvedValue({ ok: true })
    const { container } = render(<FilePreviewRouter workspaceRoot="/ws" relativePath="账号密码.md" readText={readText} />)
    fireEvent.click(await screen.findByRole('button', { name: 'preview.edit' }))
    await waitFor(() => expect(findEditor(container)).not.toBeNull())
    const view = findEditor(container)!
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'zhang37148\n' } })
    })
    await screen.findByText('preview.unsaved')
    fireEvent.click(screen.getByRole('button', { name: 'preview.save' }))
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith('workspace.fs.writeText', {
      workspaceRoot: '/ws',
      path: '账号密码.md',
      content: '阿里云:\r\nluyaomeng3\r\nzhang37148\r\n',
    }))
  })
  it('reports a rejected read instead of staying in loading', async () => {
    render(<FilePreviewRouter workspaceRoot="/ws" relativePath="a.txt" readText={vi.fn().mockRejectedValue(new Error('read failed'))} />)
    await screen.findByText('preview.error')
    expect(screen.queryByText('preview.loading')).toBeNull()
  })
  it('ignores a pending read when another file is selected', async () => {
    let finish!: (v: { ok: boolean; content: string }) => void
    const readText = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ ok: true, content: 'current' })
    const view = render(<FilePreviewRouter workspaceRoot="/ws" relativePath="a.txt" readText={readText} />)
    view.rerender(<FilePreviewRouter workspaceRoot="/ws" relativePath="b.txt" readText={readText} />)
    await screen.findByText('current')
    finish({ ok: true, content: 'obsolete' })
    await waitFor(() => expect(screen.queryByText('obsolete')).toBeNull())
  })
})
