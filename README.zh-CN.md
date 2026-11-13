<div align="center">

<img src="resources/pi-mx-icon.png" alt="Pi mx Desktop" width="72" height="72" />

# Pi mx Desktop

**[pi](https://github.com/earendil-works/pi) 编程 Agent 的桌面工作台。**<br/>
还是终端里那个 Agent、那份 `~/.pi/agent`，多了时间线、Git Review、内置终端，还有一个能在手机上接着干活的手机应用。

[![Release](https://img.shields.io/github/v/release/q971668593/Pi-mx-Desktop?style=flat-square&color=d97706&label=release)](https://github.com/q971668593/Pi-mx-Desktop/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/q971668593/Pi-mx-Desktop/total?style=flat-square&color=d97706)](https://github.com/q971668593/Pi-mx-Desktop/releases)
![Platforms](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-d97706?style=flat-square)
[![License](https://img.shields.io/github/license/q971668593/Pi-mx-Desktop?style=flat-square&color=d97706)](LICENSE)

[English](./README.md) · **简体中文** · [下载](https://github.com/q971668593/Pi-mx-Desktop/releases/latest) · [上手指南](./doc/guide/getting-started.md) · [适配器列表](./doc/guide/adapters.zh-CN.md)

<sub>基于 [pi Desktop](https://github.com/justhil/pi-app)（作者 [justhil](https://github.com/justhil)）开发，MIT 许可。</sub>

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/assets/readme/zh/hero-dark.png" />
  <img src="doc/assets/readme/zh/hero-light.png" alt="Pi mx Desktop：时间线里一轮已完成的对话，右侧 Review 面板展开了 Git diff" />
</picture>

Pi mx Desktop 不是另一个 Agent。它在后台 Worker 里运行 pi SDK，读写的就是 CLI 用的那些文件：会话、模型登录、`settings.json`、已安装的扩展。打开项目，终端里聊过的会话已经在侧栏里，接着聊或者新开都行。

## 这个分支加了什么

同一个 Agent、同一份 `~/.pi/agent`，另外多了上游还没有的几样东西：

| | | |
|---|---|---|
| **便携模式** | 程序目录下放一个 `data` 文件夹，配置、会话、缓存就都落在里面。放 U 盘带走，不往 `%APPDATA%` 写任何东西。 |
| **暖色编辑器主题** | 浅色和深色都换成暖白 + 琥珀色，走同一套设计变量，面板、chip 和代码块看起来像同一个产品。 |
| **右侧栏顺序由你定** | 默认打开 文件 → Git → 终端 → 浏览器 → Run；Review、Context、Tree 需要时再开，不占视线。 |
| **文件夹也能拖** | 文件面板里的文件夹可以直接拖进输入框，落成 `@路径` 引用，Agent 自己会去列目录、读文件。 |
| **对话名跟着你走** | 可选：侧栏里的对话名跟随你最新发的消息，长会话不用手动改名也认得出。 |
| **一键同步 Git** | Git 头部就有 拉取 / 同步 / 推送；`↑` 红、`↓` 绿，有没有没推送的提交一眼看出来。 |

## 一图看全

<img src="doc/assets/readme/zh/overview.png" alt="功能总览：时间线步骤、并排 Review、多会话并行、@ 引用文件、上下文占比、内置适配器、主题，以及与 CLI 共用的 ~/.pi/agent 文件" width="100%" />

## 一轮对话的全过程

<img src="doc/assets/readme/zh/agent-turn.gif" alt="发送需求后，Agent 依次运行测试、读取文件、修改代码、再次测试，改动出现在 Review 面板" width="100%" />

<sub>直接录自应用界面。为了让演示可复现，模型回复来自本地脚本化接口；<code>bash</code>、<code>read</code>、<code>edit</code> 工具都在示例仓库上真实执行。</sub>

## 时间线

工具调用按步骤平铺流式出现——思考、命令、读文件、改文件——正文开始输出后折叠成一行摘要。每次编辑标出 `+N −M`，回合结束时附一张「文件已更改」卡片，点开即可在文件面板或 Review 中查看。

<img src="doc/assets/readme/zh/timeline.png" alt="展开的工具步骤：思考、运行 node --test、读取 src/links.mjs、编辑 src/links.mjs 与 README.md" width="100%" />

Markdown、代码块、KaTeX 和长输出都在原位渲染。悬停消息可以复制、回退到此处，或从这里 Fork 一个新会话。

## Review

<img src="doc/assets/readme/zh/review-stage.gif" alt="把右侧栏拖宽，links.mjs 的 Git diff 切换为并排视图，并暂存其中一个片段" width="100%" />

按「本轮 / 本对话 / Git 工作区」选范围，展开文件看 diff；把侧栏拖宽即可切到并排视图。可以逐个 hunk 暂存或撤销，行评直接发回当前对话。

## 文件

- 点击文件即可在标签页打开；未固定标签最多保留 5 个，右键可固定，标签支持拖动和关闭。
- Markdown 默认预览，其他文本文件默认编辑；支持语法高亮、`Ctrl`/`⌘`+`F` 查找和 `Ctrl`/`⌘`+`S` 保存。切换标签时未保存的编辑保留在当前应用进程中。
- 文件树默认显示隐藏文件，搜索覆盖整个项目；空白处右键可新建文件或文件夹。图片预览支持滚轮缩放和拖动。
- 行号旁的按钮把 `路径:行号` 作为引用插入输入框。
- 「展开预览」让文件铺满聊天区，再点一次恢复。把文件拖到输入框即可作为附件。

## 输入框

<img src="doc/assets/readme/zh/composer-mention.gif" alt="输入 @li 后提示 src/links.mjs，回车后作为文件标签插入" width="66%" />

- `@` 搜索项目文件（遵守 `.gitignore`，基于 `fd`），插入为文件引用。
- `/` 列出 pi 内置命令和扩展注册的命令。
- 可粘贴、拖入图片和文件；模型与思考等级在输入框右侧切换。
- Agent 运行中：`Enter` 插话引导当前回合，`Alt+Enter` 排队到本轮结束后执行。

## 多会话并行

<img src="doc/assets/readme/zh/parallel-sessions.gif" alt="一个会话开始修复，另一个会话开始只读分析，两者同时运行，界面在两者之间切换" width="100%" />

每个会话运行在自己的 Worker 里。在一个会话里发起回合，再开一个会话发起第二个：两边都继续跑，侧栏标出正在工作的会话，底部状态栏显示运行数量。保留多少个 Worker、空闲多久回收，在「设置 → 通用」里调整；正在运行的会话不会被回收。

## 内置终端

按 `` Ctrl+` `` 打开右侧终端页，终端按项目分组并纵向排列。「+」新建终端，旁边的菜单可选择 PowerShell、cmd 或其他已检测到的外壳；右键可复制、粘贴或把选中内容加入对话。终端标题栏可以重运行命令；从任务启动的终端直接重运行，普通终端第一次使用时需要指定命令。

终端页读取项目的 `.vscode/tasks.json`，提供一键运行和发布。右上角 AI 按钮可以生成任务配置，保存前选择本次运行的命令。对话可使用 `desktop_terminal` 查看当前项目的终端输出、启动或重启命令；pi 原有的短命令 `bash` 工具仍由 pi 执行，并非所有短命令都会显示在右侧终端中。

## 分支

右侧「Git」面板集中管理更改、提交图谱、分支、暂存、标签、远程仓库和工作树。分支入口不再显示在底部状态栏。切换项目时，右侧所选面板和文件标签分别记忆。

## 用量

<img src="doc/assets/readme/zh/usage.png" alt="设置 → 用量，最近 90 天：费用、token、请求数、缓存命中率，按天堆叠的柱状图（悬停在某一天），以及活跃热力图" width="100%" />

「设置 → 用量」统计本机所有 pi 会话的 token 和费用——桌面端和终端 pi 的都算，包括自定义的 `sessionDir`——可按天、小时、模型、项目和会话查看。悬停在某天的某一层可以看到占比；复制进分叉会话的回复只计一次。

## 更多面板

<img src="doc/assets/readme/zh/panels.png" alt="Tree 面板的会话树、Run 面板的上下文占比环形图、Context 面板的上下文条目列表" width="100%" />

| 面板 | 用途 |
|---|---|
| **Tree** | 像 `pi /tree` 一样以树形查看会话：只看用户消息、跳回任意节点，从那里继续就是一条新分支。 |
| **Run** | 运行状态、当前模型与思考等级，以及上下文窗口在用户、助手、工具消息之间的占比。 |
| **Context** | 组成当前上下文的消息列表，每条附 token 估算。 |

## 主题与背景图

<img src="doc/assets/readme/zh/themes.png" alt="Claude 主题：浅色是暖米白底、衬线体回复，深色是暖炭灰，背后衬着一张柔和的背景图" width="100%" />

浅色、深色各自可以选预设——**Claude**、VS Code Light+、Codex Dark——也可以自己调：侧栏、聊天区、你的消息、代码块、边框的颜色，标题 / 回复字体（含衬线体），聊天字号和行高，圆角和阴影。这些都是 CSS 变量，自定义 CSS 编辑器旁边列出了全部变量。还可以在窗口背后放一张背景图，浅色深色分开或共用，图片强度、模糊和界面不透明度都能调，文字始终在磨砂层上。支持导入 `pi-theme-v1` / `codex-theme-v1` 主题字符串；5 套图标、90%–110% 界面缩放也在「设置 → 外观」。

## 手机上的 pi

<img src="doc/assets/readme/zh/phone.png" alt="Android 上的 pi Remote：会话收件箱、带工具步骤和改动文件的会话、选中两行准备批注的 diff，以及显示上下文、改动、分支和费用的会话面板" width="100%" />

**pi Remote**（Android）连到桌面端：打开「设置 → 手机连接」，扫码配对，所有会话就都在手机上了——回合运行时可以跟着看，回答它的提问，发带图片的消息，切换模型和思考强度。按文件查看本轮或工作区的改动，长按几行写批注，批注会进到下一条消息里；还能切换会话分支，或从任意一条消息分叉。连接端到端加密、不出你的网络；在外面时，让电脑和手机加入同一个 Tailscale / ZeroTier / WireGuard 网络即可（应用会自动发现组网地址，也可以手动添加）。界面中英文跟随手机系统语言，也可以在应用里单独设置。

## 整体结构

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/assets/readme/zh/architecture-dark.png" />
  <img src="doc/assets/readme/zh/architecture-light.png" alt="终端 pi 与 Pi mx Desktop 都读写 ~/.pi/agent；Pi mx Desktop 由 Renderer、Main 进程和每个会话一个的 Worker 组成" width="100%" />
</picture>

界面层不直接调用 SDK：Main 进程把每个请求转给负责该会话的 Worker，由它在本机或 WSL 发行版里运行 pi SDK。会话、登录和设置都留在 `~/.pi/agent`，CLI 和桌面端可以轮流接着同一个会话聊。

## 其他能力

| | |
|---|---|
| **扩展照常用** | 给终端 pi 装的扩展在这里同样加载。弹窗、工具卡片、面板和 `/命令` 由声明式适配器映射成原生界面，内置 36 个。[列表](./doc/guide/adapters.zh-CN.md) |
| **完成通知** | 回合结束或需要你作答时发系统通知，应用内有通知收件箱；底部状态栏显示正在运行的会话。 |
| **WSL 运行时**（Windows） | 把 Worker 跑在指定的 WSL 发行版里，会话、Git 和预览都在 Linux 侧解析。 |
| **中英文界面** | 在设置里切换；手机应用跟随系统语言。 |
| **更新** | 后台检查 GitHub Releases，可一键下载并启动安装包。 |

## 安装

| 平台 | 安装包 |
|---|---|
| Windows x64 | `Pi mx-Setup-<版本>-x64.exe`（安装版）或 `Pi mx-Portable-<版本>-x64.exe`（便携版） |
| macOS | Apple Silicon（`arm64`）与 Intel（`x64`）的 `.dmg` / `.zip` |
| Linux x64 | `.AppImage` 或 `.deb` |
| Android 9+（arm64） | 用你自己的签名密钥从 [`apps/mobile`](./apps/mobile) 构建，见「pi 在手机上」 |

到 [Releases](https://github.com/q971668593/Pi-mx-Desktop/releases/latest) 下载，每个版本附带 `SHA256SUMS.txt` 校验和。应用自带 pi SDK，只需像使用终端 pi 一样登录一次模型服务商（凭据保存在 `~/.pi/agent`）。在「设置 → 运行时」可以切换到全局安装的 pi 版本。

<details>
<summary>从源码构建</summary>

需要 Node.js ≥ 22.19。

```bash
git clone https://github.com/q971668593/Pi-mx-Desktop.git
cd Pi-mx-Desktop
npm install
npm run dev          # 开发模式
npm run build        # 生产构建，输出到 out/
npm run package      # 用 electron-builder 打安装包
```

</details>

## 上手五分钟

1. **打开文件夹**：文件夹就是 Agent 的工作目录。只想随手聊聊，点「对话」旁的 **+** 新建临时对话。
2. **选会话**：终端 pi 在该目录下的会话都会列出；点项目旁的 **+** 新建会话。
3. **发送**：`Enter` 发送，`Shift+Enter` 换行。
4. **看右侧**：Review、Run、Context、Tree、文件共用右侧栏，拖动边缘可以加宽。
5. **回退**：悬停消息可回退或 Fork；输入框为空时连按两次 `Esc` 打开会话树。

## 快捷键

| 操作 | 按键 |
|---|---|
| 发送 / 换行 | `Enter` / `Shift+Enter` |
| 插话引导当前回合 / 排队下一条 | 运行中按 `Enter` / `Alt+Enter` |
| 取回最后一条排队消息 | `Alt+↑` |
| 停止 | `Esc` |
| 会话树 | 输入框为空时 `Esc` `Esc` |
| 上一条 / 下一条已发送消息 | 输入框为空或光标在开头 / 结尾时按 `↑` / `↓` |
| 引用文件 / 命令 | `@` / `/` |
| 在新标签打开文件 | 文件面板中 `Ctrl`/`⌘`+点击 |
| 显示 / 收起终端 | `` Ctrl+` `` |
| 关闭当前终端栏 / 在终端中查找 | `Ctrl+Shift+W` / `Ctrl+Shift+F`（macOS 为 `⌘W` / `⌘F`） |

## 扩展

和终端 pi 一样安装、启用扩展：

```bash
pi install npm:<包名>      # 或：pi install git:github.com/<owner>/<repo>
```

确认 `~/.pi/agent/settings.json` 的 `packages` 中已启用该包，然后新开一个会话。「设置 → 扩展」显示当前 Worker 加载了哪些工具，「设置 → 适配器」里是各适配器的桌面端选项。要覆盖或新增适配器，把 `.json` 适配器文件放进 `~/.pi/desktop/adapters/`（项目内的 `<项目>/.pi/desktop/adapters/` 优先级更高），写法见[适配器编写指南](./doc/adapter-authoring-guide.md)。

<details>
<summary>语音输入</summary>

输入框里的麦克风会把语音转写成文字。默认使用内置服务：用你的 Codex / ChatGPT 登录直接调用 ChatGPT 的转写接口，不需要 OpenAI API Key，也不用启动本地进程。在「设置 → 语音」粘贴 `access_token`，或从 `~/.codex/auth.json`（`codex login` 后生成）导入，再点「验证登录」。

「高级」里也可以改用本地 [codex-asr](https://github.com/Wangnov/codex-asr) CLI 或自建的 `codex-asr serve` 地址。不配置语音不影响打字输入。

</details>

<details>
<summary>常见问题</summary>

| 问题 | 处理 |
|---|---|
| 设置里能看到扩展，对话里却没有 | 在 `packages` 中启用后新开一个会话。 |
| 第一次切到很长的会话较慢 | 先加载最近的消息，其余在滚动或发送时再加载。 |
| 误关了扩展弹窗 | 点时间线卡片上的「继续」。 |
| 语音提示登录无效 | token 已过期，重新 `codex login` 后再导入。 |
| 改源码后窗口白屏 | 删除 `node_modules/.vite`，重新 `npm run dev`。 |

</details>

<details>
<summary>开发者</summary>

- 技术栈：Electron 43 · React 18 · TypeScript · Tailwind · Zustand · i18next · xterm.js · `@earendil-works/pi-coding-agent`
- 进程结构：Electron Main（IPC、Worker 池、Git、预览）→ 每个会话一个 utilityProcess Worker 运行 pi SDK → Renderer。
- 检查：`npm run test:unit`、`npm run test:scripts`、`npm run typecheck`、`npm run lint`
- 文档：[`doc/`](./doc/README.md) · [适配器编写](./doc/adapter-authoring-guide.md) · [更新日志](./CHANGELOG.md)
- 手机应用：Kotlin / Compose，位于 [`apps/mobile`](./apps/mobile)；`node scripts/remote-dev-host.mjs` 会启动一个假桌面端供开发调试。
- 发布：推送 `v*` 标签触发 `.github/workflows/release.yml`，构建 Windows、macOS、Linux 和 Android 安装包。

</details>

## 支持

问题与反馈：[GitHub Issues](https://github.com/q971668593/Pi-mx-Desktop/issues)。

## 致谢与来源

本项目基于 [pi Desktop / pi-app](https://github.com/justhil/pi-app)（作者 [justhil](https://github.com/justhil)）开发，沿用 MIT 许可，原始版权声明保留在 [LICENSE](./LICENSE) 中。

Agent 运行时来自 [pi](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent`，MIT）。上游更新通过 `upstream` remote 跟踪：`git fetch upstream && git merge upstream/main`。

## 许可证

[MIT](LICENSE) — 原始作品版权 (c) 2026 justhil；修改部分版权 (c) 2026 q971668593。
