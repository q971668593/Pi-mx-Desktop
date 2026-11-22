import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Boxes,
  CloudDownload,
  Copy,
  FileSearch,
  Folder,
  FolderTree,
  GitBranch,
  Inbox,
  Keyboard,
  ListTree,
  Maximize2,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Puzzle,
  Settings,
  Sun,
  type AppIconComponent,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { OPEN_BRANCH_PICKER } from '@renderer/features/git/branch-status'
import { useUIStore } from '@renderer/stores/ui-store'
import { listAttentionSessions } from '@renderer/lib/session-attention'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { formatShortcut, readShortcutBindings } from '@renderer/lib/shortcut-bindings'
import { ipcClient } from '@renderer/lib/ipc-client'
import { applyThemeToDocument, type ThemeChoice } from '@renderer/features/settings/settings-draft'
import { openSettingsPage } from '@renderer/lib/settings-navigation'
import { exportCurrentSessionMarkdown } from '@renderer/lib/session-markdown-export'
import { resolveProjectDisplayName, workspacePathsEqual } from '@shared/workspace-path'

export type CommandPaletteAction = {
  id: string
  label: string
  hint?: string
  icon: AppIconComponent
  keywords?: string
  run: () => void
}

function openRightPanel(panelId: string) {
  const store = useUIStore.getState()
  store.setActivePanel(panelId)
  store.revealRightPanel()
}

function focusComposer() {
  window.dispatchEvent(new CustomEvent('pi-desktop:focus-composer'))
  const el =
    document.querySelector<HTMLElement>('[data-composer-input]') ||
    document.querySelector<HTMLElement>('[contenteditable="true"]')
  el?.focus()
}

/**
 * Navigation-only command palette (Ctrl/Cmd+K).
 * Opens settings, right panels, composer focus, session tree — no agent capabilities.
 */
export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
  onOpenSessionTree,
  onOpenShortcuts,
}: {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenSessionTree?: () => void
  onOpenShortcuts?: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionAttention = useUIStore((s) => s.sessionAttention)
  const sessions = useUIStore((s) => s.sessions)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const recentProjects = useUIStore((s) => s.recentProjects)
  const hiddenProjects = useUIStore((s) => s.hiddenProjects)
  const projectDisplayNames = useUIStore((s) => s.projectDisplayNames)
  const hasTimelineItems = useUIStore((s) => s.timelineItems.length > 0)

  const openAttentionSession = useCallback(
    (sessionFile: string) => {
      const match = sessions.find((s) => sessionFilesEqual(s.sessionFile, sessionFile))
      if (match?.sessionFile && currentWorkspace) {
        void switchSessionInPlace(match.sessionId, match.sessionFile)
        onClose()
        return
      }
      if (match?.workspaceId && match.sessionFile) {
        void activateWorkspace(match.workspaceId, {
          sessionId: match.sessionId,
          sessionFile: match.sessionFile,
        })
        onClose()
        return
      }
      onClose()
    },
    [sessions, currentWorkspace, onClose],
  )

  const actions = useMemo<CommandPaletteAction[]>(() => {
    const list: CommandPaletteAction[] = []
    const waiting = listAttentionSessions(sessionAttention, 'needs-you')
    const done = listAttentionSessions(sessionAttention, 'done')
    ;[...waiting, ...done].slice(0, 6).forEach((file, i) => {
      const match = sessions.find((s) => sessionFilesEqual(s.sessionFile, file))
      const waitingHere = waiting.includes(file)
      list.push({
        id: `attention-${file}`,
        label: match?.title || file.split(/[\\/]/).pop() || file,
        hint: waitingHere ? t('common:attention.needsYou') : t('common:attention.done'),
        icon: MessageSquare,
        keywords: `${match?.firstMessage || ''} ${i + 1}`,
        run: () => openAttentionSession(file),
      })
    })
    list.push(
      {
        id: 'settings',
        label: t('common:commandPalette.settings'),
        hint: t('common:sidebar.settings'),
        icon: Settings,
        keywords: 'settings preferences 设置',
        run: () => {
          onOpenSettings()
          onClose()
        },
      },
      {
        id: 'composer',
        label: t('common:commandPalette.focusComposer'),
        icon: MessageSquare,
        keywords: 'composer input message 输入',
        run: () => {
          focusComposer()
          onClose()
        },
      },
      {
        id: 'panel-files',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.files') }),
        icon: FolderTree,
        keywords: 'files panel 文件',
        run: () => {
          openRightPanel('files')
          onClose()
        },
      },
      {
        id: 'panel-run',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.run') }),
        icon: Activity,
        keywords: 'run status 运行',
        run: () => {
          openRightPanel('run')
          onClose()
        },
      },
      {
        id: 'panel-review',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.review') }),
        icon: GitBranch,
        keywords: 'review diff git',
        run: () => {
          openRightPanel('review')
          onClose()
        },
      },
      {
        id: 'git-switch-branch',
        label: t('common:branches.palette'),
        icon: GitBranch,
        keywords: 'git branch checkout switch 分支 切换',
        run: () => {
          onClose()
          window.dispatchEvent(new Event(OPEN_BRANCH_PICKER))
        },
      },
      {
        id: 'panel-tree',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.tree') }),
        icon: ListTree,
        keywords: 'tree rewind session',
        run: () => {
          openRightPanel('tree')
          onClose()
        },
      },
      {
        id: 'panel-context',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.context') }),
        icon: FileSearch,
        keywords: 'context',
        run: () => {
          openRightPanel('context')
          onClose()
        },
      },
    )
    if (onOpenSessionTree) {
      list.push({
        id: 'session-tree',
        label: t('common:commandPalette.sessionTree'),
        hint: 'Esc Esc',
        icon: ListTree,
        keywords: 'tree overlay rewind fork',
        run: () => {
          onOpenSessionTree()
          onClose()
        },
      })
    }
    if (onOpenShortcuts) {
      list.push({
        id: 'shortcuts',
        label: t('common:commandPalette.shortcuts'),
        hint: 'Ctrl+/',
        icon: Keyboard,
        keywords: 'shortcuts keyboard help 快捷键',
        run: () => {
          onOpenShortcuts()
          onClose()
        },
      })
    }

    const switchTheme = (theme: ThemeChoice) => {
      applyThemeToDocument(theme)
      useUIStore.getState().setTheme(theme)
      void ipcClient.invoke('settings.set', { key: 'theme', value: theme }).catch(() => {})
      onClose()
    }

    list.push(
      {
        id: 'focus-mode',
        label: t('common:commandPalette.toggleFocusMode'),
        icon: Maximize2,
        keywords: 'focus zen sidebar collapse 专注 边栏 隐藏',
        run: () => {
          const state = useUIStore.getState()
          const bothHidden = state.sidebarCollapsed && state.rightPanelCollapsed
          if (bothHidden) {
            state.toggleSidebar()
          } else {
            if (!state.sidebarCollapsed) state.toggleSidebar()
            if (!state.rightPanelCollapsed) state.toggleRightPanel()
          }
          onClose()
        },
      },
      {
        id: 'theme-light',
        label: t('common:commandPalette.themeLight'),
        icon: Sun,
        keywords: 'theme light appearance 浅色 主题 外观',
        run: () => switchTheme('light'),
      },
      {
        id: 'theme-dark',
        label: t('common:commandPalette.themeDark'),
        icon: Moon,
        keywords: 'theme dark appearance 深色 暗黑 主题 外观',
        run: () => switchTheme('dark'),
      },
      {
        id: 'theme-system',
        label: t('common:commandPalette.themeSystem'),
        icon: Monitor,
        keywords: 'theme system appearance 跟随系统 主题',
        run: () => switchTheme('system'),
      },
      {
        id: 'settings-models',
        label: t('common:commandPalette.settingsSection', { section: t('settings:nav.models') }),
        icon: Boxes,
        keywords: 'settings models oauth api key voice routing 模型 供应商 语音 编排',
        run: () => {
          openSettingsPage({ page: 'models' })
          onClose()
        },
      },
      {
        id: 'settings-appearance',
        label: t('common:commandPalette.settingsSection', { section: t('settings:nav.appearance') }),
        icon: Palette,
        keywords: 'settings appearance theme font zoom background 外观 主题 字体 背景',
        run: () => {
          openSettingsPage({ page: 'appearance' })
          onClose()
        },
      },
      {
        id: 'settings-notifications',
        label: t('common:commandPalette.settingsSection', { section: t('settings:nav.notifications') }),
        icon: Inbox,
        keywords: 'settings notifications sound alert dnd 通知 提醒 声音 免打扰',
        run: () => {
          openSettingsPage({ page: 'notifications' })
          onClose()
        },
      },
      {
        id: 'settings-resources',
        label: t('common:commandPalette.settingsSection', { section: t('settings:nav.resources') }),
        icon: Puzzle,
        keywords: 'settings skills prompts extensions mcp adapters 扩展 技能 适配器',
        run: () => {
          openSettingsPage({ page: 'resources' })
          onClose()
        },
      },
    )
    if (hasTimelineItems) {
      list.push(
        {
          id: 'export-markdown-copy',
          label: t('common:commandPalette.exportMarkdownCopy'),
          icon: Copy,
          keywords: 'export markdown copy share transcript 导出 复制 对话',
          run: () => {
            void exportCurrentSessionMarkdown('copy')
            onClose()
          },
        },
        {
          id: 'export-markdown-download',
          label: t('common:commandPalette.exportMarkdownDownload'),
          icon: CloudDownload,
          keywords: 'export markdown download save md file 导出 下载 保存 对话',
          run: () => {
            void exportCurrentSessionMarkdown('download')
            onClose()
          },
        },
      )
    }

    const otherProjects = recentProjects
      .filter(
        (p) =>
          !workspacePathsEqual(p, currentWorkspace) &&
          !hiddenProjects.some((hidden) => workspacePathsEqual(hidden, p)),
      )
      .slice(0, 5)
    for (const proj of otherProjects) {
      const fallback = proj.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || proj
      const labelName = resolveProjectDisplayName(projectDisplayNames, proj, fallback)
      list.push({
        id: `project-${proj}`,
        label: t('common:commandPalette.switchProject', { name: labelName }),
        hint: fallback !== labelName ? fallback : undefined,
        icon: Folder,
        keywords: `project workspace switch 项目 切换 ${proj}`,
        run: () => {
          void activateWorkspace(proj, { preferHome: true })
          onClose()
        },
      })
    }

    return list
  }, [
    t,
    onOpenSettings,
    onOpenSessionTree,
    onOpenShortcuts,
    onClose,
    sessionAttention,
    sessions,
    openAttentionSession,
    recentProjects,
    hiddenProjects,
    currentWorkspace,
    projectDisplayNames,
    hasTimelineItems,
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter((action) => {
      const hay = `${action.label} ${action.hint || ''} ${action.keywords || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [actions, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const runSelected = useCallback(() => {
    const action = filtered[index]
    if (action) action.run()
  }, [filtered, index])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        runSelected()
        return
      }
      if (!query && /^[1-6]$/.test(event.key)) {
        const action = filtered[Number(event.key) - 1]
        if (action) {
          event.preventDefault()
          action.run()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered.length, onClose, runSelected])

  if (!open) return null

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-[80] flex items-start justify-center bg-black/35 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t('common:commandPalette.title')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="overlay-panel w-full max-w-lg overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-elevated,var(--bg-1))] shadow-2xl">
        <div className="border-b border-border/50 px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common:commandPalette.placeholder')}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-secondary/50"
            aria-autocomplete="list"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12px] text-foreground-secondary/70">
              {t('common:commandPalette.empty')}
            </li>
          ) : (
            filtered.map((action, actionIndex) => {
              const Icon = action.icon
              const active = actionIndex === index
              return (
                <li key={action.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px]',
                      active
                        ? 'bg-[var(--bg-hover)] text-foreground'
                        : 'text-foreground-secondary hover:bg-[var(--bg-hover)]/70 hover:text-foreground',
                    )}
                    onMouseEnter={() => setIndex(actionIndex)}
                    onClick={() => action.run()}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {action.hint ? (
                      <span className="shrink-0 text-[10px] text-foreground-secondary/50">
                        {action.hint}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <div className="border-t border-border/40 px-3 py-1.5 text-[10px] text-foreground-secondary/45">
          {t('common:commandPalette.footer')}
        </div>
      </div>
    </div>
  )
}

export function ShortcutsHelpSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const bindings = readShortcutBindings()
  const rows: { keys: string; label: string }[] = [
    { keys: formatShortcut(bindings.commandPalette), label: t('common:shortcuts.commandPalette') },
    { keys: formatShortcut(bindings.shortcuts), label: t('common:shortcuts.thisSheet') },
    { keys: formatShortcut(bindings.completionNotification), label: t('common:shortcuts.completionNotification') },
    { keys: 'Esc Esc', label: t('common:shortcuts.sessionTree') },
    { keys: 'Alt ↑', label: t('common:shortcuts.restoreQueue') },
    { keys: 'Ctrl/⌘ ↵', label: t('common:shortcuts.flushQueue') },
    { keys: 'Esc', label: t('common:shortcuts.stopOrDismiss') },
  ]

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-[81] flex items-center justify-center bg-black/35 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('common:shortcuts.title')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="overlay-panel w-full max-w-md rounded-xl border border-border/60 bg-[var(--surface-elevated,var(--bg-1))] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-foreground">{t('common:shortcuts.title')}</h2>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
            onClick={onClose}
          >
            {t('common:commandPalette.close')}
          </button>
        </div>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.keys}
              className="flex items-center justify-between gap-3 rounded-md border border-border/30 px-2.5 py-1.5"
            >
              <span className="text-[12px] text-foreground-secondary">{row.label}</span>
              <kbd className="rounded border border-border/50 bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                {row.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-foreground-secondary/55">{t('common:shortcuts.navOnly')}</p>
      </div>
    </div>
  )
}
