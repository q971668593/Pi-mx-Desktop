import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_PROMPT_SNIPPETS,
  addPromptSnippet,
  deletePromptSnippet,
  reloadPromptSnippets,
  resetPromptSnippets,
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
})
