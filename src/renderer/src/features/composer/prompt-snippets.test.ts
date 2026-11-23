import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_PROMPT_SNIPPETS,
  addPromptSnippet,
  deletePromptSnippet,
  reloadPromptSnippets,
  resetPromptSnippets,
  updatePromptSnippet,
  usePromptSnippets,
} from './prompt-snippets'

describe('prompt-snippets', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadPromptSnippets()
  })

  it('seeds built-in developer snippets when unset', () => {
    const { result } = renderHook(() => usePromptSnippets())
    expect(result.current.length).toBe(DEFAULT_PROMPT_SNIPPETS.length)
  })

  it('adds, deletes, and persists custom snippets in localStorage', () => {
    const { result } = renderHook(() => usePromptSnippets())

    let addedId = ''
    act(() => {
      const created = addPromptSnippet({ title: 'PR summary', content: 'Draft a concise PR description.' })
      expect(created).not.toBeNull()
      addedId = created!.id
    })

    expect(result.current[0].title).toBe('PR summary')

    act(() => {
      reloadPromptSnippets()
    })
    expect(result.current[0].title).toBe('PR summary')

    act(() => {
      deletePromptSnippet(addedId)
    })
    expect(result.current.some((s) => s.id === addedId)).toBe(false)

    act(() => {
      resetPromptSnippets()
    })
    expect(result.current.length).toBe(DEFAULT_PROMPT_SNIPPETS.length)
  })

  it('updates a snippet and drops i18n keys so edits stay literal', () => {
    const { result } = renderHook(() => usePromptSnippets())
    const target = result.current.find((s) => s.id === 'builtin-review')!
    expect(target.titleKey).toBeTruthy()

    let ok = false
    act(() => {
      ok = updatePromptSnippet(target.id, { title: '我的审查', content: '按我的清单审。' })
    })
    expect(ok).toBe(true)
    const updated = result.current.find((s) => s.id === target.id)!
    expect(updated.title).toBe('我的审查')
    expect(updated.content).toBe('按我的清单审。')
    expect(updated.titleKey).toBeUndefined()
    expect(updated.contentKey).toBeUndefined()

    act(() => {
      reloadPromptSnippets()
    })
    expect(result.current.find((s) => s.id === target.id)?.title).toBe('我的审查')
  })

  it('rejects empty updates and unknown ids', () => {
    expect(updatePromptSnippet('missing-id', { title: 't', content: 'c' })).toBe(false)
    const { result } = renderHook(() => usePromptSnippets())
    const target = result.current[0]
    expect(updatePromptSnippet(target.id, { title: '  ', content: 'c' })).toBe(false)
    expect(updatePromptSnippet(target.id, { title: 't', content: '  ' })).toBe(false)
  })
})
