import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const ASSET_DIR = join(REPO, 'doc/assets/readme')
/** Logical window size; screenshots are taken at `scale` (2 → 2880×1800). */
export const VIEWPORT = { width: 1440, height: 900, scale: 2 }
export const MOCK_PORT = Number(process.env.PI_CAPTURE_MOCK_PORT || 18765)
export const LANGS = ['zh', 'en']

/**
 * 右侧栏几何（逻辑像素，1440×900 窗口）：
 * 默认宽 460（x=980 起），拖窄到 `wide` 之后 diff / 看板才有足够横向空间。
 */
export const PANEL = {
  /** 右侧栏展开时左边缘 = 分隔条位置 */
  edgeX: 980,
  /** 演示用的加宽后左边缘 */
  wideX: 520,
  tabRowY: 58,
  /** 面板内容起点（tab 行下方） */
  contentY: 78,
}

/** 面板 Tab（各语言）。脚本按自有文本点击，和 app 的 i18n 保持一致。 */
export const TABS = {
  zh: { files: '文件', git: 'Git', team: '工作团队', terminal: '终端', browser: '浏览器', run: 'Run', review: 'Review', context: 'Context', tree: 'Tree' },
  en: { files: 'Files', git: 'Git', team: 'Team', terminal: 'Terminal', browser: 'Browser', run: 'Run', review: 'Review', context: 'Context', tree: 'Tree' },
}

/** UI labels the scripts click on, per app language. */
export const UI = {
  zh: {
    files: '文件',
    toolSummary: '已编辑',
    settings: '设置',
    appearance: '外观',
    newSession: '新会话',
    revealPanel: '展开右侧面板',
    sideBySide: '切换到并排视图',
    stageHunk: '暂存此片段',
    composer: '消息或 / 命令',
  },
  en: {
    files: 'Files',
    toolSummary: 'Edited',
    settings: 'Settings',
    appearance: 'Appearance',
    newSession: 'New session',
    revealPanel: 'Expand right panel',
    sideBySide: 'Switch to side-by-side',
    stageHunk: 'Stage this hunk',
    composer: 'Message or / command',
  },
}

/**
 * Crops in logical (1×) pixels of the 1440×900 window, for the tiles that reuse real UI.
 * `panel*` assumes the sidebar is at PANEL.wideX; `timeline` is the chat column.
 */
export const CROPS = {
  /** 加宽后的整块右侧栏（Review / 看板 / Git 用） */
  panelWide: { x: 520, y: 36, width: 920, height: 828 },
  /** 默认宽度下的右侧栏 */
  panel: { x: 980, y: 36, width: 460, height: 828 },
  /** 时间线正文（折叠后的工具摘要 + 结论 + 改动卡） */
  timeline: { x: 360, y: 60, width: 610, height: 660 },
  /** 输入框 + 模型/思考选择器 */
  composer: { x: 360, y: 700, width: 610, height: 190 },
  /** 状态栏（分支、内存、就绪） */
  statusbar: { x: 0, y: 862, width: 720, height: 38 },
  /** 终端抽屉（右侧栏位置） */
  terminal: { x: 980, y: 78, width: 460, height: 700 },
  /** 设置页内容 */
  usage: { x: 300, y: 36, width: 960, height: 790 },
}

/** 侧栏分隔条：拖动 y、起始 x 与加宽后的 x。 */
export const SPLITTER = { x: PANEL.edgeX, y: 420, wideX: PANEL.wideX }

export const BACKGROUND = {
  light: ['#f4f5fa', '#e3e6f1', '#3a4060'],
  dark: ['#1d1e24', '#121317', '#000000'],
}
