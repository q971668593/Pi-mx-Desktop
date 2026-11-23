import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, Zap } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ComposerPopover } from './composer-popover'
import { insertTextIntoComposer } from './composer-insert'
import { addPromptSnippet, deletePromptSnippet, updatePromptSnippet, usePromptSnippets } from './prompt-snippets'

/** Quick-access developer prompt snippet library right in the composer toolbar. */
export function PromptSnippetsMenu({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const snippets = usePromptSnippets()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const resetForm = () => {
    setAdding(false)
    setEditingId(null)
    setTitle('')
    setContent('')
  }

  const startEditing = (id: string, displayTitle: string, displayContent: string) => {
    setAdding(true)
    setEditingId(id)
    setTitle(displayTitle)
    setContent(displayContent)
  }

  const handleSave = () => {
    if (editingId) {
      if (!updatePromptSnippet(editingId, { title, content })) return
      resetForm()
      return
    }
    const created = addPromptSnippet({ title, content })
    if (!created) return
    setTitle('')
    setContent('')
    setAdding(false)
  }

  return (
    <div className="flex min-w-0 items-center">
      <button
        type="button"
        data-composer-snippets=""
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('composer:snippets.button')}
        title={t('composer:snippets.button')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'composer-toolbar-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary/75 disabled:opacity-30',
          open && 'bg-[var(--bg-active)] text-foreground',
        )}
      >
        <Zap className="h-[14px] w-[14px]" />
      </button>
      {open ? (
        <ComposerPopover
          anchorSelector="[data-composer-snippets]"
          align="start"
          width={300}
          label={t('composer:snippets.title')}
          onClose={() => {
            setOpen(false)
            resetForm()
          }}
        >
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <span className="text-[11px] font-medium text-foreground-secondary">
              {t('composer:snippets.title')}
            </span>
            <button
              type="button"
              onClick={() => {
                if (adding) resetForm()
                else setAdding(true)
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-[var(--bg-hover)]"
            >
              <Plus className="h-3 w-3" />
              {adding ? t('composer:snippets.cancel') : t('composer:snippets.add')}
            </button>
          </div>
          {adding ? (
            <div className="space-y-2 border-b border-border/40 p-3">
              <input
                type="text"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('composer:snippets.titlePlaceholder')}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary/50"
              />
              <textarea
                rows={3}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('composer:snippets.contentPlaceholder')}
                className="w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary/50"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-md px-2 py-1 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
                >
                  {t('composer:snippets.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!title.trim() || !content.trim()}
                  onClick={handleSave}
                  className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  {t('composer:snippets.save')}
                </button>
              </div>
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto py-1">
            {snippets.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-foreground-secondary">
                {t('composer:snippets.empty')}
              </div>
            ) : (
              snippets.map((snippet) => {
                const displayTitle = snippet.titleKey
                  ? t(snippet.titleKey, { defaultValue: snippet.title })
                  : snippet.title
                const displayContent = snippet.contentKey
                  ? t(snippet.contentKey, { defaultValue: snippet.content })
                  : snippet.content
                return (
                  <div
                    key={snippet.id}
                    className="group flex items-start gap-1.5 px-2 py-0.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        insertTextIntoComposer(displayContent, 'append')
                        setOpen(false)
                        resetForm()
                      }}
                      className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    >
                      <div className="truncate text-[12px] font-medium text-foreground">
                        {displayTitle}
                      </div>
                      <div className="line-clamp-2 text-[11px] leading-4 text-foreground-secondary/80">
                        {displayContent}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditing(snippet.id, displayTitle, displayContent)}
                      title={t('composer:snippets.edit')}
                      aria-label={t('composer:snippets.edit')}
                      className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-secondary/50 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--bg-hover)] hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingId === snippet.id) resetForm()
                        deletePromptSnippet(snippet.id)
                      }}
                      title={t('composer:snippets.delete')}
                      aria-label={t('composer:snippets.delete')}
                      className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-secondary/50 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--bg-hover)] hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </ComposerPopover>
      ) : null}
    </div>
  )
}
