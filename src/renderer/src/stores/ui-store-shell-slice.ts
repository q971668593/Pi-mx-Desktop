import {
  coerceActivePanel,
  CORE_RIGHT_PANEL_CATALOG,
  defaultCoreRightPanelPrefs,
} from '@shared/right-panels'
import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
  normalizeTimelineVisibleTurns,
  DEFAULT_TIMELINE_VISIBLE_TURNS,
} from '@shared/timeline-settings'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import {
  currentWindowWidth,
  isRightPanelHidden,
  nextRightPanelToggle,
  revealRightPanelPatch,
} from '@renderer/lib/right-panel-visibility'
import type { UIState } from '@renderer/stores/ui-store-types'
import { workspacePathKey } from '@shared/workspace-path'
import type { RightPanelPrefs } from '@shared/right-panels'

export function projectPanelKey(path: string | null): string {
  return `pi-desktop:project-panel:${workspacePathKey(path)}`
}

/** Wide enough for the browser toolbar to keep forward / expand on one row. */
export const DEFAULT_RIGHT_PANEL_WIDTH = 460

type StoreSet = (
  patch: Partial<UIState> | ((state: UIState) => Partial<UIState> | UIState),
) => void
type StoreGet = () => UIState

type ShellSlice = Pick<
  UIState,
  | 'activePanel'
  | 'setActivePanel'
  | 'focusRightPanel'
  | 'rightPanelCatalog'
  | 'rightPanelPrefs'
  | 'rightPanelForced'
  | 'rightPanelOrder'
  | 'applyRightPanelRuntime'
  | 'theme'
  | 'setTheme'
  | 'toolExpandBySession'
  | 'setToolCallExpanded'
  | 'getToolCallExpanded'
  | 'timelineMaxAutoExpandedTools'
  | 'setTimelineMaxAutoExpandedTools'
  | 'timelineVisibleTurns'
  | 'setTimelineVisibleTurns'
  | 'sidebarWidth'
  | 'setSidebarWidth'
  | 'sidebarCollapsed'
  | 'toggleSidebar'
  | 'rightPanelWidth'
  | 'setRightPanelWidth'
  | 'rightPanelCollapsed'
  | 'rightPanelRailIcons'
  | 'setRightPanelRailIcons'
  | 'rightPanelExpandedOnNarrow'
  | 'toggleRightPanel'
  | 'revealRightPanel'
  | 'filesPreviewChatExpand'
  | 'browserChatExpand'
>

export function createShellSlice(set: StoreSet, get: StoreGet): ShellSlice {
  return {
    activePanel: 'files',
    rightPanelCatalog: [...CORE_RIGHT_PANEL_CATALOG],
    setActivePanel: (panel) =>
      set((state) => {
        const activePanel = state.rightPanelPrefs[panel]
          ? panel
          : coerceActivePanel(
              panel,
              state.rightPanelPrefs,
              state.rightPanelCatalog,
              state.rightPanelOrder,
            )
        if (state.currentWorkspace) try { localStorage.setItem(projectPanelKey(state.currentWorkspace), activePanel) } catch { void 0 }
        return { activePanel }
      }),
    rightPanelPrefs: defaultCoreRightPanelPrefs(),
    rightPanelForced: {},
    // 输入框的「上下文」圆环等入口直接点名某个面板。设置里默认关掉的面板（context/review/tree）
    // 以前会被 coerceActivePanel 悄悄换成 files，看着像点不动。这里先就地启用再激活，
    // 仅影响本次运行时的 prefs（设置页保存时才写主进程配置），下次进设置仍可再关掉。
    focusRightPanel: (panel) =>
      set((state) => {
        const known = state.rightPanelCatalog.some((item) => item.id === panel)
        if (!known) {
          // 未知面板（别名/扩展面板未在目录里）才交给 coerce 回落。
          return { ...revealRightPanelPatch(), activePanel: coerceActivePanel(panel, state.rightPanelPrefs, state.rightPanelCatalog, state.rightPanelOrder) }
        }
        const activePanel = panel
        if (state.currentWorkspace) try { localStorage.setItem(projectPanelKey(state.currentWorkspace), activePanel) } catch { void 0 }
        return {
          ...revealRightPanelPatch(),
          rightPanelPrefs: state.rightPanelPrefs[panel] ? state.rightPanelPrefs : { ...state.rightPanelPrefs, [panel]: true },
          rightPanelForced: state.rightPanelForced[panel] ? state.rightPanelForced : { ...state.rightPanelForced, [panel]: true },
          activePanel,
        }
      }),
    rightPanelOrder: [],
    applyRightPanelRuntime: (catalog, prefs, order) =>
      set((state) => {
        const nextOrder = order?.length ? order : state.rightPanelOrder
        // 把本次运行内主动打开过的面板并回主进程配置，否则切 workspace / 保存设置
        // 会把这些面板重新关掉，正在看的面板被弹回 files。
        const forcedIds = Object.keys(state.rightPanelForced).filter((id) => catalog.some((item) => item.id === id))
        const mergedPrefs = forcedIds.length === 0
          ? prefs
          : forcedIds.reduce<RightPanelPrefs>((acc, id) => ({ ...acc, [id]: true }), { ...prefs })
        return {
          rightPanelCatalog: catalog,
          rightPanelPrefs: mergedPrefs,
          rightPanelOrder: nextOrder,
          activePanel: coerceActivePanel(state.activePanel, mergedPrefs, catalog, nextOrder),
        }
      }),
    theme: 'system',
    setTheme: (theme) => set({ theme }),
    toolExpandBySession: {},
    setToolCallExpanded: (toolCallId, expanded) =>
      set((state) => {
        const sessionKey =
          normalizeSessionFileKey(state.historySessionFile || '') ||
          state.historySessionFile ||
          '__none__'
        if (!toolCallId) return state
        const sessionMap = { ...(state.toolExpandBySession[sessionKey] || {}) }
        if (expanded == null) delete sessionMap[toolCallId]
        else sessionMap[toolCallId] = expanded
        return {
          toolExpandBySession: {
            ...state.toolExpandBySession,
            [sessionKey]: sessionMap,
          },
        }
      }),
    getToolCallExpanded: (toolCallId) => {
      if (!toolCallId) return undefined
      const state = get()
      const sessionKey =
        normalizeSessionFileKey(state.historySessionFile || '') ||
        state.historySessionFile ||
        '__none__'
      return state.toolExpandBySession[sessionKey]?.[toolCallId]
    },
    timelineMaxAutoExpandedTools: DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
    setTimelineMaxAutoExpandedTools: (count) =>
      set({ timelineMaxAutoExpandedTools: normalizeTimelineMaxAutoExpandedTools(count) }),
    timelineVisibleTurns: DEFAULT_TIMELINE_VISIBLE_TURNS,
    setTimelineVisibleTurns: (count) => set({ timelineVisibleTurns: normalizeTimelineVisibleTurns(count) }),
    sidebarWidth: 276,
    setSidebarWidth: (width) => set({ sidebarWidth: Math.min(Math.max(width, 200), 360) }),
    sidebarCollapsed: false,
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
    setRightPanelWidth: (width) =>
      set({ rightPanelWidth: Math.min(Math.max(width, 280), 9999) }),
    // A fresh install starts with the conversation alone; the top bar button opens the panel.
    rightPanelCollapsed: true,
    rightPanelRailIcons: false,
    setRightPanelRailIcons: (on) => set({ rightPanelRailIcons: on }),
    rightPanelExpandedOnNarrow: false,
    toggleRightPanel: () =>
      set((state) => {
        const windowWidth = currentWindowWidth()
        const hidden = isRightPanelHidden({
          collapsed: state.rightPanelCollapsed,
          expandedOnNarrow: state.rightPanelExpandedOnNarrow,
          windowWidth,
        })
        return nextRightPanelToggle({ hidden, windowWidth })
      }),
    revealRightPanel: () => set(revealRightPanelPatch()),
    filesPreviewChatExpand: false,
    browserChatExpand: false,
  }
}
