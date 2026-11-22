// Rendered README visuals: copy, crops of real screenshots, and render jobs.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, VIEWPORT } from './config.mjs'

const px = (v) => v * VIEWPORT.scale

/** Crop a logical-pixel rectangle out of a 2× screenshot. */
function crop(input, out, { x, y, width, height }) {
  execFileSync('magick', [input, '-crop', `${px(width)}x${px(height)}+${px(x)}+${px(y)}`, '+repage', out])
  return out
}

/** Built-in adapter display names from the catalog; adapters with desktop UI come first. */
export function builtinAdapterNames() {
  const dir = join(REPO, 'src/extension-compat/builtin')
  const rank = { native: 0, partial: 1, headless: 2, none: 3 }
  return readdirSync(dir)
    .filter((file) => file.endsWith('.adapter.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')))
    .sort((a, b) => (rank[a.tier] ?? 3) - (rank[b.tier] ?? 3))
    .map((adapter) => adapter.displayName || adapter.id)
}

const COPY = {
  en: {
    timeline: ['Timeline', 'Watch every step, then it folds', 'Thinking, commands, reads and edits stream in as they run and collapse into one line once the answer starts.'],
    review: ['Review', 'Real diffs, side by side', 'Turn, session or Git scope. Stage single hunks, comment on lines, send them back to the chat.'],
    team: ['Work team', 'Roles, lanes, dispatched cards', 'Five roles share one board; the agent creates cards, dispatches them and records acceptance.'],
    terminal: ['Terminal', 'Take over what the agent ran', 'A real shell in the same window: tabs, splits, port badges, and the same project server is reused.'],
    composer: ['Composer', '@ any project file', 'Fuzzy search that respects .gitignore, inserted as a file reference.'],
    context: ['Context', 'Where the window goes', 'User, assistant and tool messages, plus the cache that is left.'],
    themes: ['Appearance', 'Light, dark, or your own', 'Presets, custom palettes, a background image behind frosted panes.'],
    files: ['Files', 'Read, edit, quote a line', 'A tree that follows .gitignore, a preview with revision guard, one click to quote a line back into the chat.'],
    shared: ['Same data', 'Nothing to import', 'The desktop reads and writes the very same files the pi CLI does.'],
    filesList: [['sessions/', 'conversations'], ['auth.json', 'model logins'], ['settings.json', 'defaults & packages'], ['models.json', 'custom providers'], ['extensions/', 'local extensions']],
    arch: {
      eyebrow: 'How it fits together',
      termEyebrow: 'Terminal', termTitle: 'pi CLI', termNote: 'Unchanged. Same commands, same TUI, same extensions.',
      deskEyebrow: 'Desktop', deskTitle: 'Pi mx Desktop', deskNote: 'Each session gets its own worker process running the same pi Agent SDK — the desktop only adds the surface.',
      layers: [['Renderer', 'Timeline · Review · Files · Team · Composer'], ['Main process', 'IPC · worker pool · Git · terminal · previews']],
      workersLabel: 'Workers', workers: [['session A · running', true], ['session B · running', true], ['session C · idle', false]],
      cliEdge: 'read / write', deskEdge: 'read / write',
      same: 'same agent · same skills · same extensions',
    },
    wipe: ['Light', 'Dark'],
  },
  zh: {
    timeline: ['时间线', '每一步都看得见，随后折叠', '思考、命令、读文件、改文件按执行顺序流式出现，正文开始输出后收成一行摘要。'],
    review: ['Review', '真的 diff，真的并排', '按本轮、本对话或 Git 工作区查看；逐 hunk 暂存，行评可发回对话。'],
    team: ['工作团队', '角色、泳道、可派发的卡', '五个角色共用一块看板；Agent 建卡、派发、把验收项写在卡上。'],
    terminal: ['终端', 'Agent 跑过的东西你能接手', '同一个窗口里的真 shell：多标签、分屏、端口徽标，同一项目不会起两个 dev server。'],
    composer: ['输入框', '@ 引用项目文件', '模糊搜索，遵守 .gitignore，插入为文件引用。'],
    context: ['Context', '上下文花在哪', '用户、助手、工具消息各占多少，缓存还剩多少。'],
    themes: ['外观', '浅色、深色或你自己的', '预设、自定义配色，磨砂面板后面放一张背景图。'],
    files: ['文件', '读、改、引一行', '遵守 .gitignore 的目录树，带 revision 守卫的预览，一行就能引用回对话。'],
    shared: ['同一份数据', '不用导入', '桌面端读写的就是 pi CLI 用的那批文件。'],
    filesList: [['sessions/', '会话记录'], ['auth.json', '模型登录'], ['settings.json', '默认值与扩展包'], ['models.json', '自定义服务商'], ['extensions/', '本地扩展']],
    arch: {
      eyebrow: '整体结构',
      termEyebrow: '终端', termTitle: 'pi CLI', termNote: '一点没动。同样的命令、同样的 TUI、同样的扩展。',
      deskEyebrow: '桌面', deskTitle: 'Pi mx Desktop', deskNote: '每个会话一个 Worker 进程，跑同一个 pi Agent SDK —— 桌面只多了「表面」。',
      layers: [['Renderer', '时间线 · Review · 文件 · 团队 · 输入框'], ['Main 进程', 'IPC · Worker 池 · Git · 终端 · 预览']],
      workersLabel: 'Workers', workers: [['会话 A · 运行中', true], ['会话 B · 运行中', true], ['会话 C · 空闲', false]],
      cliEdge: '读 / 写', deskEdge: '读 / 写',
      same: '同一个 Agent · 同一套 skill · 同一批扩展',
    },
    wipe: ['浅色', '深色'],
  },
}

/**
 * Render jobs for one language. Expects the raw screenshots written by capture.mjs.
 * @returns {import('./render.mjs').RenderJob[]}
 */
export function visualJobs({ lang, rawDir, tmp, outDir }) {
  const c = COPY[lang]
  const dir = join(tmp, `visual-${lang}`)
  mkdirSync(dir, { recursive: true })
  const raw = (name) => join(rawDir, `${lang}-${name}.png`)
  /** name = source shot suffix, as = file name handed to the template. */
  const cut = (name, as, box) => crop(raw(name), join(dir, as), box)
  const assets = {
    // Chat column: the folded turn with its steps expanded.
    'timeline.png': cut('light-timeline', 'timeline.png', { x: 360, y: 96, width: 600, height: 560 }),
    // Right panel, widened → the side-by-side diff.
    'review.png': cut('light-hero', 'review.png', { x: 520, y: 176, width: 920, height: 420 }),
    'team.png': cut('light-team', 'team.png', { x: 520, y: 96, width: 920, height: 620 }),
    'terminal.png': cut('light-terminal', 'terminal.png', { x: 980, y: 78, width: 460, height: 520 }),
    'files.png': cut('light-files', 'files.png', { x: 980, y: 78, width: 460, height: 560 }),
    'context.png': cut('light-context', 'context.png', { x: 980, y: 96, width: 460, height: 340 }),
    // Composer with an @ file chip.
    'composer.png': cut('composer', 'composer.png', { x: 360, y: 640, width: 600, height: 250 }),
    'light.png': raw('theme-light'),
    'dark-bg.png': raw('theme-dark-bg'),
    'icon.png': join(REPO, 'resources/pi-mx-icon.png'),
  }
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
  const tile = (key, extra = {}) => ({ eyebrow: c[key][0], title: c[key][1], desc: c[key][2], ...extra })
  return [
    {
      template: 'overview.html', width: 1280, height: 1660, assets, out: join(outDir, 'overview.png'),
      data: {
        lang,
        version: `v${version}`,
        tiles: {
          timeline: tile('timeline', { img: 'timeline.png' }),
          review: tile('review', { img: 'review.png' }),
          team: tile('team', { img: 'team.png' }),
          terminal: tile('terminal', { img: 'terminal.png' }),
          composer: tile('composer', { img: 'composer.png' }),
          context: tile('context', { img: 'context.png' }),
          themes: tile('themes', { light: 'light.png', dark: 'dark-bg.png' }),
          files: tile('files', { img: 'files.png' }),
          shared: tile('shared', { files: c.filesList }),
        },
      },
    },
    ...['light', 'dark'].map((theme) => ({
      template: 'architecture.html', width: 1280, height: 660, out: join(outDir, `architecture-${theme}.png`),
      data: {
        lang, theme, ...c.arch,
        termCode: '<i>$</i> pi\n<i>›</i> /tree\n<i>›</i> /model\n<i>›</i> 继续昨天的会话',
        items: ['sessions/*.jsonl', 'auth.json', 'settings.json', 'models.json', 'extensions/'],
      },
    })),
    {
      template: 'theme-wipe.html', width: 1280, height: 800, scale: 1, frames: 64, frameMs: 70,
      assets: { 'light.png': raw('theme-light'), 'dark.png': raw('theme-dark-bg') }, out: join(tmp, `frames-theme-${lang}`),
      data: { lang, light: 'light.png', dark: 'dark.png', lightLabel: c.wipe[0], darkLabel: c.wipe[1] },
    },
  ]
}
