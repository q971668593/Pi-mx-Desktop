import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { LineGutterAddButton } from '@renderer/components/ui/line-gutter-add'
import { SessionForkOverlay } from './session-fork-overlay'
import { SessionTreeOverlay } from './session-tree-overlay'
import { TreePanel } from './tree-panel'

vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn(async () => true) }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn(async () => true), loadForkCandidates: vi.fn(async () => []) }))
vi.mock('@renderer/lib/rewind-metadata', () => ({ refreshSessionTree: vi.fn(async () => {}) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({})) } }))
vi.mock('@renderer/features/timeline/timeline-view-jump', () => ({ requestTimelineViewEntry: vi.fn() }))

const nodes = [
  { id: 'u1', depth: 0, entryType: 'message', role: 'user', preview: 'first question', isLeaf: false },
  { id: 'a1', depth: 1, entryType: 'message', role: 'assistant', preview: '', isLeaf: false },
  { id: 'c1', depth: 2, entryType: 'compaction', preview: '', isLeaf: false },
  { id: 'u2', depth: 3, entryType: 'message', role: 'user', preview: 'second question', isLeaf: false },
  { id: 'a2', depth: 4, entryType: 'message', role: 'assistant', preview: '', isLeaf: true },
]

const HAN = /[一-鿿]/

beforeEach(() => {
  useUIStore.setState({
    currentWorkspace: '/tmp/proj',
    historySessionFile: '/tmp/proj/session.jsonl',
    rewindTreeNodes: nodes as never,
    rewindLoadingTree: false,
    rewindTreeError: undefined,
    rewindKey: '/tmp/proj/session.jsonl',
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

/** Visible text plus title / aria-label attributes, which also reach users (tooltips, screen readers). */
function uiText(container: HTMLElement): string {
  const attrs = [...container.querySelectorAll('[title],[aria-label]')]
    .map((el) => `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`)
  return `${container.textContent ?? ''} ${attrs.join(' ')}`
}

describe('session tree and line references are localized', () => {
  it('should_render_tree_panel_without_chinese_when_language_is_english', async () => {
    await i18n.changeLanguage('en')
    const { container } = render(<TreePanel />)
    // The filter chips and the panel hint are the always-visible copy of this panel.
    expect(screen.getByRole('radio', { name: 'Questions' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'All entries' })).toBeInTheDocument()
    expect(uiText(container)).not.toMatch(HAN)
  })

  it('should_keep_chinese_labels_when_language_is_chinese', async () => {
    await i18n.changeLanguage('zh')
    const { container } = render(<TreePanel />)
    expect(screen.getByRole('radio', { name: '提问轮次' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '全部记录' })).toBeInTheDocument()
    expect(uiText(container)).toMatch(HAN)
  })

  it('should_render_tree_overlay_without_chinese_when_language_is_english', async () => {
    await i18n.changeLanguage('en')
    render(<SessionTreeOverlay open onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Session tree' })
    expect(screen.getByText('Session tree')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Questions' })).toBeInTheDocument()
    expect(uiText(dialog)).not.toMatch(HAN)
  })

  it('should_render_fork_overlay_without_chinese_when_language_is_english', async () => {
    await i18n.changeLanguage('en')
    const { baseElement } = render(<SessionForkOverlay open onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('No user messages to fork')).toBeInTheDocument())
    expect(screen.getByText('Fork session')).toBeInTheDocument()
    expect(uiText(baseElement)).not.toMatch(HAN)
  })

  it('should_label_line_reference_button_in_the_active_language', async () => {
    await i18n.changeLanguage('en')
    const { rerender } = render(<LineGutterAddButton path="src/links.mjs" line={9} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-label', 'Quote line 9 into the composer')
    expect(button).toHaveAttribute('title', 'Quote src/links.mjs:9 into the composer')

    await i18n.changeLanguage('zh')
    rerender(<LineGutterAddButton path="src/links.mjs" line={9} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '引用第 9 行到输入框')
    expect(screen.getByRole('button')).toHaveAttribute('title', '引用 src/links.mjs:9 到输入框')
  })
})
