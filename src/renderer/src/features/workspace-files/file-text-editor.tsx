import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { useUIStore } from '@renderer/stores/ui-store'

export function FileTextEditor({ value, path, saving, wordWrap, onChange, onSave }: {
  value: string
  path: string
  saving: boolean
  wordWrap: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }
  const editable = useRef(new Compartment())
  const wrapping = useRef(new Compartment())

  useEffect(() => {
    if (!hostRef.current) return
    const language = new Compartment()
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(), bracketMatching(), indentOnInput(), search(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...(document.documentElement.classList.contains('dark') ? [oneDark] : []),
          keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } }, ...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => { if (update.docChanged) callbacks.current.onChange(update.state.doc.toString()) }),
          EditorView.theme({ '&': { height: '100%', fontSize: '12px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, monospace' } }),
          language.of([]), editable.current.of(EditorView.editable.of(!saving)), wrapping.current.of(wordWrap ? EditorView.lineWrapping : []),
        ],
      }),
    })
    viewRef.current = view
    const onFind = (event: KeyboardEvent) => {
      if (useUIStore.getState().activePanel !== 'files' || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]') && !view.dom.contains(target)) return
      event.preventDefault()
      event.stopPropagation()
      openSearchPanel(view)
    }
    window.addEventListener('keydown', onFind, true)
    let disposed = false
    const description = languages.find((item) => item.extensions?.some((extension) => path.toLowerCase().endsWith(`.${extension}`)))
      ?? languages.find((item) => item.filename?.test(path.split(/[\\/]/).pop() || path))
    if (description) void description.load().then((support) => {
      if (!disposed) view.dispatch({ effects: language.reconfigure(support) })
    }).catch(() => {})
    return () => { disposed = true; window.removeEventListener('keydown', onFind, true); view.destroy(); viewRef.current = null }
  }, [path])

  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!saving)) })
  }, [saving])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapping.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) })
  }, [wordWrap])

  return <div ref={hostRef} className="min-h-0 min-w-0 flex-1" />
}
