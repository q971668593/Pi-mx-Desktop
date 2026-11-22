# 任务拆分与执行看板（opencode 借鉴改造）

> 方案：[PI-MX-OPTIMIZATION-PLAN.md](./PI-MX-OPTIMIZATION-PLAN.md)
> 状态图例：⬜ 未开始 · 🟨 进行中 · ✅ 已完成 · 🟥 阻塞
> 纪律：**每完成一项必须过 §验收命令，才算 ✅**；未过验收不得勾选。

## Phase 1 · 本轮实施（已完成）

### T1 · IPC 契约单一事实源 ✅
| # | 子步骤 | 产物 | 状态 |
|---|---|---|---|
| 1.1 | 生成器：扫 `src/main` 注册点 → 白名单 + 文档 | `scripts/generate-ipc-channels.mjs` | ✅ |
| 1.2 | 生成白名单（266 个 invoke 通道，排序去重） | `packages/shared/ipc-channels.generated.ts` | ✅ |
| 1.3 | `ipc-channels.ts` 退化为薄壳（re-export + Set + 类型守卫） | `packages/shared/ipc-channels.ts` | ✅ |
| 1.4 | 生成分组文档（482 行，含 main→renderer 事件通道表） | `doc/IPC-CONTRACTS.generated.md` | ✅ |
| 1.5 | npm 脚本 `gen:ipc` | `package.json` | ✅ |
| 1.6 | 漂移门禁测试（`--check`，直接在断言里给出修复命令） | `scripts/tests/ipc-channels-generated.test.mjs` | ✅ |
| 1.7 | 修正既有同步测试（改读生成文件 + 断言薄壳不许硬编码通道） | `scripts/tests/ipc-channel-sync.test.mjs`、`shared-contracts.test.mjs`、`github-release-check.test.mjs` | ✅ |
| 1.8 | 验收：`gen:ipc` 幂等 + `test:scripts` + `typecheck` | — | ✅ |

**本轮直接抓到的真实缺陷**：`ipc:gitBoard.checkoutCommit` 已在主进程注册、渲染层也在调用（`git-board-panel.tsx` 提交详情里的「签出提交」），但**从未进入 preload 白名单** → 该按钮点击必被 preload 拒绝。生成器接管后自动修复，并新增漂移门禁防止复发。

### T2 · 结构边界门禁 ✅
| # | 子步骤 | 产物 | 状态 |
|---|---|---|---|
| 2.1 | 四条规则 + `ipcRenderer` 仅限 preload | `scripts/tests/structure-boundaries.test.mjs` | ✅ |
| 2.2 | 存活量违规：**0 处**（无需预算登记） | 同上 | ✅ |
| 2.3 | 验收：`test:scripts` 全绿 | — | ✅ |

### T3 · 特性开关注册表 ✅
| # | 子步骤 | 产物 | 状态 |
|---|---|---|---|
| 3.1 | 注册表 + `PI_FLAGS=all,-x` 解析 + 别名 + optInOnly + dev/release 默认 | `packages/shared/feature-flags.ts` | ✅ |
| 3.2 | 单测 9 例（含"拼错开关不静默"） | `packages/shared/feature-flags.test.ts` | ✅ |
| 3.3 | 验收：`test:unit` 中本文件 9 例全绿 | — | ✅ |

### T4 · 运行账本（崩溃恢复收敛版）✅
| # | 子步骤 | 产物 | 状态 |
|---|---|---|---|
| 4.1 | 账本模块（upsert / release / orphan / sweep / 容量上限 / 原子写 / 损坏容错） | `src/main/run-ledger.ts` | ✅ |
| 4.2 | 单测 10 例 | `src/main/run-ledger.test.ts` | ✅ |
| 4.3 | 接线：`sendPrompt` / `followUp` → `beginRun` | `src/main/worker-manager.ts` | ✅ |
| 4.4 | 接线：`run` 事件终态（`idle/failed/cancelled/settled`）→ `releaseRun` | 同上 | ✅ |
| 4.5 | 接线：非正常退出 → `markOrphaned` + `ipc:worker-fatal` 携带 `orphanedRuns` | 同上 | ✅ |
| 4.6 | 启动 sweep（首次 `start()` 前扫孤儿，写 warn 日志） | 同上 + `src/main/run-ledger-instance.ts` | ✅ |
| 4.7 | 验收：`test:unit`（本文件 10 例）+ `typecheck` | — | ✅ |

### T8 · 主题 token 契约（第一阶段）✅
| # | 子步骤 | 产物 | 状态 |
|---|---|---|---|
| 8.1 | 语义 token 契约（6 组 / 30 个 token）+ `auditThemeCss()` 纯校验器 | `packages/shared/theme-tokens.ts` | ✅ |
| 8.2 | 校验器单测（9 例：缺深色/缺浅色/未登记仅深色/缺块/解析器） | `packages/shared/theme-tokens.test.ts` | ✅ |
| 8.3 | 真实 `globals.css` 门禁（深浅成套 + 仅深色必登记） | `scripts/tests/theme-token-contract.test.mjs` | ✅ |
| 8.4 | UI 侧接入（预设 JSON + 导入校验 + 编辑器调用） | 依赖主题编辑器（正在改动中） | ⬜ 待接入 |

### 统一验收（Phase 1 收口）
| # | 命令 | 结果 |
|---|---|---|
| V1 | `npm run typecheck` | ✅ web 0 / node 0 |
| V2 | `npm run test:unit` | ✅ **408 文件 / 2347 例 / 0 失败**（2026-11-18 08:3x 实测，含本方案新增 33 例） |
| V3 | `npm run test:scripts` | ✅ 98 个契约文件 / 288 例全部通过（0 失败） |
| V4 | `npm run lint` | ✅ 0 error（5 条既有 warning） |

## 体检报告：本轮顺带发现的「既有红色门禁」

> 这些不是本次改造引入的。列出来是因为**它们让"验收"失去意义**：门禁一直是红的，坏改动就不会被发现。

| 组 | 现象 | 根因 | 处理 |
|---|---|---|---|
| A | `tsc -p tsconfig.web.json` 直接失败 TS1005 | `session-tree-i18n.test.tsx` 里两条 `expect` 挤在一行，缺换行 | ✅ 已修（纯语法） |
| B | `dark-theme-tokens.test.mjs` 2 例失败 | 0.7.8「暖白 + 琥珀」改版后，测试仍断言 VS Code Dark Modern 冷灰十六进制 | ✅ 已重写为**设计意图**断言（深底/亮字/琥珀色相/低彩度阈值），调色微调不再误报 |
| C | `tray-icon-packaging.test.mjs` 失败 | 1.0.2 起 ICO 改为 16/24/32/48/64/128/256 多尺寸，测试仍断言单张 `png256` | ✅ 改为断言多尺寸契约 |
| D | `ipc-schema-validation.test.mjs` 失败 | ① Node 直跑 `.ts` 时无扩展名相对导入无法解析；② `workspaceFsSearchSchema.maxResults` 上限由 20 提到 200，测试仍用 21 当非法值 | ✅ 加了 `scripts/tests/ts-relative-resolve.mjs` 解析钩子；坏用例改 201（保留"越界即拒"的守门意图） |
| E | `tray-main-lifecycle.test.mjs` 失败 | 测试用 `vm` 执行 `src/main/index.ts` 的关停片段，沙箱缺 `disposeAiActivityGlow` | ✅ 补沙箱 stub（测试侧修正，未改产品代码） |
| F | `run-contract-tests.mjs` **失败即止** | 第一批失败就 `process.exit(1)`，后面批次的文件根本没跑（我第一轮就漏看了 `structure-boundaries`） | ✅ 改为跑完全部批次、逐文件复跑、最后统一列出所有失败文件 |
| D 组遗留 | ~~18 个 vitest 文件 / 38 例失败~~ | 工作区里有进行中的未提交改动（timeline / 侧栏 / 设置 / 本地化）；测试断言的是改动前行为 | ✅ **已自行收敛**：并行改动收尾后，2026-11-18 08:3x 全量跑为 **408 文件 / 2347 例 / 0 失败**。本轮未改这些文件 |

## Phase 2 · 待启动（设计已在方案 §3）

> 开工前提已满足：2026-11-18 08:3x 确认全量单测 0 失败，可作为回归网。

### T5 · worker 生命周期状态机（下一个开工项）
| # | 子步骤 | 产物 | 状态 |
|---|---|---|---|
| 5.1 | 纯转移表：`spawning/ready/busy/draining/dead` × 12 种事件 + 6 种命令（run.begin/release/mark-orphan、notify.fatal/init-failed、slot.dispose） | `src/main/worker-lifecycle-machine.ts` | ✅ |
| 5.2 | 表驱动单测 17 例（含 5×12 穷举矩阵、不可变、晚到事件、防重复通知、stop 幂等） | `src/main/worker-lifecycle-machine.test.ts` | ✅ |
| 5.3 | 接入 1：`handleSlotExit` 的账本处置改为执行转移表命令（`derivePhase` + `exitLedgerCommands`），manager 不再内联判定孤儿/释放 | `src/main/worker-manager.ts` | ✅ |
| 5.4 | 接入 2：`sendPrompt/followUp` 的 turn 起止改由转移表裁决（`turnStartCommands` / `turnEndCommands` + 进程内 `activeRuns` 去重器） | `src/main/worker-manager.ts` | ✅ |
| 5.5 | 结论：**不迁**。spawn 准入（maxWorkers / 空闲驱逐 / 复用）是**池策略**，不是单个槽位的生命周期；强行套转移表会把策略隐含进状态机 | — | ✅ 已决策 |
| 5.6 | 验收：`typecheck` + `test:unit` + `test:scripts` + eslint 全绿，且 `session-shell-stream-switch-race.test.ts` 不需修改仍通过 | — | ✅ web/node tsc 0、eslint 0 error、契约 98 文件/288 例 0 失败、单测 **409 文件/2370 例 0 失败**、race 18/18。⚠️ 遗留：`vitest` 进程 exit=1 而 0 失败（jsdom 卸载期未捕获错误，非用例失败）—— 已登记为待查项 |

> 纪律：转移表里不允许出现 `electron` / `Date.now` / fs；时钟与IO 由命令执行层注入。一次只迁一个调用点，跑一遍全绿再迁下一个。
>
> **已经编码进转移表的行为约定**（写下来避免接线时反复争论）：
> - `turn.end` 只在 `busy` 时释放账本（晚到的 run 事件不误放）
> - `idle.timeout` 在 `busy` 时一律忽略（绝不回收正在跑的 turn）
> - `worker.exit` 在 `draining` 时算预期退出：不发 `notify.fatal`
> - `exit code !== 0` 且 `busy` → `mark-orphan` + `release`
> - `dead` 之后的任何事件都不产生命令（防重复通知/重复 dispose）
> - `stop.request` 幂等；`stop.done` 只在 `draining` 生效
> - `turnSeq` 单调递增，用于区分上一轮的晚到事件

| ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| T5 | worker 生命周期状态机（抽纯转移 + manager 瘦身） | T4（账本先落地，事件语义才稳定） | ⬜ |
| T6 | 内容寻址快照（供 G3 并排 diff / 单文件还原） | T5 | ⬜ |
| T7 | 本地状态 SQLite 化 + write-behind | T5 | ⬜ |
| T8 | 主题 token 契约 + JSON 预设 + Schema 校验 | — | 🟨 契约与门禁已完成，UI 接入待编辑器改动收尾 |

## Phase 2.5 · 会话目标条 + 自动循环（已交付）

把「这个会话要达成什么」变成一等公民：目标与验收项由用户设定，每轮以 pi 的 system prompt section（`<goal>`）注入；一轮结束后自动续，连亏 3 轮自动停。

| # | 子步骤 | 产物 | 状态 |
|---|---|---|---|
| 12.1 | 共享契约：类型 + 注入文本 + `GOAL-PROGRESS` 解析 + 刹车表（19 例） | `packages/shared/session-goal.ts`、`.test.ts` | ✅ |
| 12.2 | session-goal IPC：get / set / toggleCriterion / markDone / clear + Zod 边界（长度、条数、下标上下界） | `src/main/ipc/handlers/session-goal.ts`、`src/main/ipc/schemas.ts` | ✅ |
| 12.3 | `npm run gen:ipc`：本功能 +5 个 invoke 通道、生成白名单与文档、`--check` 漂移 0 | `packages/shared/ipc-channels.generated.ts`、`doc/IPC-CONTRACTS.generated.md` | ✅ |
| 12.4 | 目标条 UI：钉在时间线顶部，设定/编辑/勾选/复制/清除，中英词条 `goal:bar.*` | `src/renderer/src/features/goal/goal-bar.tsx`、`stores/session-goal-store.ts` | ✅ |
| 12.5 | 注入与自动循环：worker `<goal>` section（每轮 before_agent_start 同步）+ 每次 prompt 前补推 + 渲染层循环 + 刹车 | `src/worker/worker-goal.ts`、`src/main/worker-manager.ts`、`features/goal/goal-auto-loop.ts` | ✅ |

**验收（2026-11-18 实测，五条门禁）**：

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.web.json --noEmit` | ✅ 0 error |
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ 0 error |
| `npx eslint .` | ✅ 0 error（5 条既有 warning，非本轮引入） |
| `npm run test:unit` | ✅ **416 文件 / 2428 例 / 0 失败**（含并行进行中的其它改动；本功能相关 52 例全绿，其中新增 45 例：共享契约 20、主进程存储 2、worker 注入 6、目标条 5、自动循环 12） |
| `npm run test:scripts` | ✅ **99 文件 / 304 例 / 0 失败**（新增 `session-goal-contract.test.mjs` 4 例） |
| `npm run gen:ipc -- --check` | ✅ 无漂移 |

- `session-shell-stream-switch-race.test.ts`（外部行为见证）**未修改**，全量跑仍通过。
- 刹车语义：`remaining` 归零 → 停 + 提示达成；连续 **3** 轮不下降 → 停 + 提示；20 轮上限 → 停。用户勾选/改目标/手动发消息后重新计数。
- 进度不靠猜：模型按注入约定在回复末尾输出 `GOAL-PROGRESS: 1,3`，渲染层解析后走 `ipc:sessionGoal.markDone` 落盘；解析器与刹车都是纯函数，单测覆盖。

## 子代理接入（2026-11-18，已安装）

| 项 | 状态 |
|---|---|
| 选型 | `pi-subagents`（nicopreme，MIT，~995K 下载/月，需 Pi ≥1.2.0；本仓 SDK 1.5.2 满足） |
| 安装 | ✅ `pi install npm:pi-subagents` → `added 6 packages in 7s`，`pi list` 显示 `npm:pi-subagents` → `~/.pi/agent/npm/node_modules/pi-subagents` |
| 生效条件 | 写进共享 `~/.pi/agent/settings.json`，**新起的 worker / 重启桌面应用**后加载；终端版同时生效 |
| UI L1 | `task` 工具会作为普通工具卡片进 timeline（待真实调用一次确认渲染） |
| UI L2 | 专用子代理面板（需读该包的工具/事件契约，映射成 `AppEvent`）—— 待做 |
| 文档 | `doc/ROADMAP.md`「明确不做 2」已修订为：子代理作为**唯一例外**预装 |

## Phase 3 · 长期
| ID | 任务 | 状态 |
|---|---|---|
| T9 | timeline/session-ui 抽包 + fixture 截图回归 | ⬜ |
| T10 | 发布产物校验和 + 更新通道 | ⬜ |
| T11 | `.pi/skills` + i18n 术语表 | ⬜ |

## Phase 2.6 · 审查修复轮（2026-11-18，commit ce47910 之后）

对上一批改动做了一次逐块审查（不是"跑一遍门禁"），发现的问题是**门禁全绿也照样存在**的，因此每条都补了能单独变红的观察测试。

| # | 缺陷 | 根因 | 修复 | 见证测试 |
|---|---|---|---|---|
| R1 | 崩溃归因永远是 0：启动 `sweep` / `ipc:worker-fatal.orphanedRuns` 永远扫不到东西 | 转移表把 `run.mark-orphan` 与 `run.release` 一起发，`releaseRun` 按 sessionFile 删整行 → 标记当场被删 | 崩溃分支只发 `mark-orphan`（记录留下来）；终态已知（idle/failed/cancelled/正常退出）才 `release` | `run-ledger.test.ts`「crash survives as an orphan that the next boot sweep reports」 |
| R2 | 设了目标但模型收不到 `<goal>` 段，还会把已推送的段撤掉 | 目标存储用原样字符串做 key，渲染层用 `normalizeSessionFileKey`（`C:/a`），`prompt.send` 可能带原生路径（`C:`）→ 查不到 → `setGoal(null)` | `SessionGoalStore` 读写统一归一化 + 存量键自动迁移 | `session-goals.test.ts`「resolves the same session for native and normalized spellings」 |
| R3 | 模型正常的进度写法被判无效 → 连续 3 轮"停滞"停机 | 进度行只接受纯数字，`GOAL-PROGRESS: 1,3（说明）` 整行被丢弃 | 取行首编号串，允许后缀说明；用注入文案自身的片段（`本轮完成后`/`标准编号`/…）挡"复述指令" | `session-goal.test.ts`「reads the indices when the model annotates the line」 |
| R4 | AI 任务快照会删掉用户同名的手写任务（不可恢复） | 升级路径按"名字含 ` (AI)`"推断归属，连带删除基底，只保护 `pi-app-exact` | 基底只有在与 `(AI)` 副本 `command/args/cwd/dependsOn/kind` 完全一致时才敢删 | `workspace-tasks.test.ts`「keeps a hand-written task that merely shares the label」 |
| R5 | 运行面板展开后失败工具列表不再更新 | render 里 `useUIStore.getState()`，不订阅 | 展开时才订阅 `timelineItems`（收着时返回同一常量，不随流式 token 重渲） | `run-panel.test.tsx`（旧实现下该用例红） |
| R6 | 通道名非字面量时白名单静默漏项，门禁照样绿（preload 运行时拒） | `gen:ipc` 只 warn | `--check` 与写入模式都硬失败 | `ipc-channels-generated.test.mjs` + 实跑 `--check` |
| R7 | 文档声称"12 个事件通道 = 全集"，实际用变量的发送全漏 | 只扫 `webContents.send('字面量')` | 生成物新增「动态事件通道（未收录）」清单（实为 7 处：browser/update/terminal 等） | 生成物 diff |
| R8 | 展开的工具卡里 `outputText` / `imageText` 是死代码，每次展开白跑两次 `JSON.stringify` | `no-unused-vars` 被关，死变量能过门禁 | 删除；把"规则被关"记进技术债 | eslint 实测 |
| R9 | `models.json` 被 agent 在 turn 中途改 → 立刻广播 `reloadModels`，正在跑的 worker 被换模型表 | 广播不区分忙闲 | 忙的槽位推迟到 turn 结束再补，并补发一次 `ipc:model-catalog-changed` | `tsc` + 结构边界门禁（无行为测试，见技术债） |
| R10 | 目标条「清除」一次误点就丢目标 + 注入段 | 无二次确认（同批次里"删除运行组合"已有两段式） | 两段式确认（4s 自动退回） | `goal-bar.test.tsx` |
| R11 | `file://server/share/a` 掉成 `server/share/a` | UNC 前缀被吃掉 | 补回 `//`，并区分 `file://C:/…` | `workspace-files-types.test.ts` |

**本轮验收（实测）**

| 命令 | 结果 |
|---|---|
| `node scripts/generate-ipc-channels.mjs --check` | ✅ 无漂移（273 invoke / 12 事件 / 7 动态未收录） |
| `npx tsc -p tsconfig.web.json --noEmit` | ✅ 0 error |
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ 0 error |
| `npx eslint .` | ✅ 0 error（5 条既有 warning） |
| `npm run test:unit` | ✅ **425 文件 / 2471 例 / 0 失败**（本轮 +3 文件 / +17 例） |
| `npm run test:scripts` | ✅ 99 文件 / 304 例 / 0 失败 |

`session-shell-stream-switch-race.test.ts` 未修改，仍随全量通过。

## Phase 2.7 · UI 归位 + e2e 修复轮（2026-11-18）

用户反馈：侧栏「项目」标题行里两个迷你开关「太丑、图标看不出来、不知道干什么」。顺带把 e2e 整套跑通。

| # | 改动 | 性质 |
|---|---|---|
| U1 | 「对话名跟随最新消息」「项目手动排序」从侧栏标题行移到 **设置 → 通用 → 侧栏**，标准 Switch + 一句说明；侧栏标题行只剩「隐藏的项目」「打开文件夹」 | 用户要求 |
| U2 | 两个功能仍需在侧栏生效：设置里写入后广播 `pi-desktop:settings-changed`，侧栏重读；删掉 `.project-toggle*` / `.project-tool-sep` 共约 40 行 CSS | 清理 |
| R12 | **分支切换器挂回状态栏**：36d46e0 侧栏改版时 `BranchStatusTrigger` 从状态栏消失，导致分支切换/新建/冲突暂存整块无入口、命令面板的「切换分支」是空操作 | 产品缺陷（恢复入口） |
| R13 | **终端分屏入口挂回**：`splitTab` / pane 头 / 拖动分隔条 / 关闭 pane 都在，但没有任何按钮能加 pane；工具栏加「向下拆分」（≤4 pane，满了禁用） | 产品缺陷（恢复入口） |
| R14 | **浏览器工具延迟加载的顺序 bug**：capabilities 消息先到、tool_search 后到时，第一轮只能全部直declare，之后切到 deferred 仍把 12 个非 core 工具当成「已通过 tool_search 加载」保留 → 每个会话每次请求多带整套工具定义。修法：只有上一轮本来就是 deferred，才认这些工具是「加载过的」 | 回归（有单测见证） |
| E1 | e2e 修 11 个用例（详见下表） | 测试债 |
| E2 | `zz-ui-review`（5 分钟、断言很少的人工巡检）默认跳过：`UI_REVIEW=1` 才跑 | 测试债 |

e2e 逐个失败的根因（都是界面改了、用例没跟）：

| 用例 | 原因 | 处理 |
|---|---|---|
| `sidebar-reorder` | 断言已删除的「切换项目排序」按钮 + 已按设计移除的会话级拖拽 | 改用 role=switch / 新排序语义；右键菜单 portal 重试 |
| `capability-cache` | 内置浏览器已默认开启，用例前提「起始关闭」失效 | 改成 默认开 → 关 → 再开，仍断言缓存前缀逐字不变 |
| `scripted-agent` 助手 | 浏览器模式单选项文案改了（Built-in → This app / 内置 → 本应用内置） | 正则同时兼容中英新旧 |
| `branch-switch` | 分支切换器没有入口了（见 R12） | 恢复入口 |
| `git-workbench` | 分支页改成「New branch name + Create」 | 更新选择器 |
| `files-workbench`（第 4 个） | 新项目默认面板由 run 改 files | 断言默认面板 + 不继承标签页 |
| `terminal` | 分屏按钮不存在（见 R13）；且 xterm 会吞掉聚焦后第一个按键 | 恢复按钮；先 `press('End')` 吃掉首键再输入 |
| `browser-agent` / `browser-runtime` | core 工具集从 6 个扩到 10 个（BROWSER_CORE_TOOLS），用例里写死旧集合；会话 2 的浏览器是「自动挂载」而非关闭 | 断言对齐 `BROWSER_CORE_TOOLS`、tool_search 后工具变多、自动挂载=工具已声明 |
| `browser-annotate-scroll` | 标签条改成「有一个标签就显示」，新建标签移到条尾 + 号 | 更新交互路径 |
| `browser`（bounds） | 视图 bounds 跟随占位元素是异步的，满载时一次比较会差 100px | 改 `expect.poll` 收敛 |

**验收（实测）**

| 命令 | 结果 |
|---|---|
| `env -u ELECTRON_RUN_AS_NODE npx playwright test` | ✅ **60 passed / 1 skipped / 0 failed**（9.8 分钟，首次全绿） |
| `npx tsc -p tsconfig.web.json --noEmit` | ✅ 0 |
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ 0 |
| `npx eslint .` | ✅ 0 error |
| `npm run test:unit` | ✅ 426 文件 / 2477 例（新增 1 例：浏览器工具延迟加载的顺序回归） |
| `npm run test:scripts` | ✅ 99 文件 / 304 例 |

> 本机注意：shell 里常驻 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化成 node 跑 `out/main/index.js`，e2e 一律报 `Process failed to launch!`。跑 e2e 前用 `env -u ELECTRON_RUN_AS_NODE`（写进了本文档，避免下次再踩）。
**本轮明确不改的**：
- `afterPromptSent` 与 run 结算各刷一次会话列表 —— `refreshWorkspaceSessionLists` 已有 per-workspace single-flight，两处刷新时点不同（发完 / 这一轮结束），合并反而会让侧栏数据变旧。
- `@typescript-eslint/no-unused-vars` 保持 `off`：实测打开后有 **170 处**存量违规，会淹掉真正的信号。要开就按预算型门禁（先记 170，只许降）单独排一轮，不要混在功能改动里。

## 已登记的技术债（本轮不做，写在这里防丢）
1. `IpcMethodMap`（`packages/shared/ipc-contract.ts`）与实现脱节：266 处 handler 全用字面量，`ipcChannel()` **0 次使用**。T1 后白名单已自动同步，但 request/response 类型仍未从注册点推导 → 下一步让 `registerHandlerWithSchema` 反推类型，逐步淘汰手写接口。
2. 仓库根目录有 6 个游离调试文件（`_check.ps1`、`_check.txt`、`_filter.ps1`、`_full.txt`、`_probe.ps1`、`_probe.txt`、`_parse.mjs`），非本次产物，未清理；建议加入 `.gitignore` 或删除。
3. `handleSlotExit` 的 `autoRestartEnabled=false` 行为本轮未改（只增加可观测性）。若将来要"崩溃后自动续跑会话"，需要产品决策 + T5 的状态机。
4. `packages/shared/feature-flags.ts` 目前只有基建与单测，**尚无读取点**；第一个接入点建议放在 G2（`plugin_manager`）或 T8（`theme_json_presets`），不要为了"用上"而给现有稳定功能套开关。
5. `models.json` 监听对「正在跑 turn 的槽位」是推迟重载（Phase 2.6 R9），但**没有行为测试**：`worker-manager` 的槽位池需要真实 transport 才能驱动。要补得先给 `worker-manager` 抽一层可注入的 transport（Phase 3 一起做，别在功能改动里顺手改）。
6. `@typescript-eslint/no-unused-vars` 目前是 `off`（实测打开有 170 处存量违规）。建议按预算型门禁单开一轮：先把它设成 `warn` + 记 170 的基线测试，再逐月降。在此之前 R8 这类死代码只能靠 review 抓。

## R14 模型设置重构（默认模型移除 / 生图独立页 / 供应商弹窗化 / 订阅登录）

用户的判断是「模型页本末倒置」：默认模型每次对话都要选，不该在设置里再设一遍；插件模型要先有供应商才谈得上；生图和供应商挤在同一页。按这个顺序重排。

| # | 改动 | 位置 |
|---|---|---|
| 1 | 删掉「默认模型与思考」区，新会话由 SDK `findInitialModel` 自动取第一个可用模型（`settings.defaultProvider/defaultModel` 留空即走这条回退链） | 删除 `features/settings/model-defaults-section.tsx` + 单测；`npm run check:i18n` 同步删除 `modelDefaults` 词条 |
| 2 | 保留「模型切换范围」「按模型绑定思考等级」，收进可折叠的「高级」卡片，草稿切片 id 改为 `model-advanced` | 新建 `features/settings/model-runtime-advanced.tsx`（`changedModelAdvancedSettings`、`ModelRuntimeAdvanced`），`models-settings-panel.tsx` 末尾挂载 |
| 3 | 生图从模型页拆成设置独立入口「生图模型配置」 | 新建 `image-gen-settings-page.tsx`；`settings-page.tsx` 加 `imageGen` 到 `SettingsPage` / `NAV_GROUPS`（agent 组，`Image` 图标）/ `WIDE_PAGES` / 渲染分支；`ImageGenSettings({ showHeading })` 让独立页不重复标题 |
| 4 | 添加供应商改成「选模板 → 连接信息弹窗 → 保存才落 draft」；卡片只做摘要，随时「编辑连接信息」再打开同一弹窗 | 新建 `provider-config-dialog.tsx`（`ProviderConfigDialog` / `ProviderDraft`，缺 scheme 自动补 `http://`，本地网关可直接填 `localhost:11434`）；`models-settings-panel.tsx` 的 `addFromPreset` 只开弹窗、`createProvider` 才写；`models-provider-card.tsx` 展开体去掉 4 个输入框改为按钮行 |
| 5 | 订阅（OAuth）登录：主进程跑 SDK 自己的 `ModelRuntime.login`，凭据由 SDK 写 `auth.json`（与终端 pi 共用） | 新建 `src/main/ipc/handlers/model-auth.ts`（`model.auth.providers/login/answer/cancel/logout`，`registerHandlerWithSchema` 全量校验，`sendEvent` 推 `model-auth` 事件）；`packages/shared/app-events.ts` 加 `ModelAuthEvent`；`app-event-session.ts` 加 `model-auth` 排除会话作用域；新建 `features/settings/model-auth-dialog.tsx`；`models-sdk-provider-section.tsx` 每个 provider 行加「登录（OAuth）/ 用 API Key 登录 / 退出登录」 |

**高级卡片说明**：删除「默认模型与思考」整块后，仍有两项是「按模型 / 按范围」而非「默认」语义，收进模型页末尾的可折叠卡片 `data-testid="model-advanced"`（`model-runtime-advanced.tsx`，脏切片 id 改成 `model-advanced`，与旧的 `model-defaults` 不冲突）：

- 模型切换范围 → pi `enabledModels`，逗号分隔支持通配；清空写 `null`（IPC 会丢 `undefined`）。
- 按模型绑定思考等级 → pi `modelThinkingLevels`，与终端 pi ≥ 0.84 共用同一份设置。

新增单测：`provider-config-dialog.test.tsx`（6 例）、`model-runtime-advanced.test.tsx`（3 例：只回改动键 / 改等级 / 新增绑定）。两个已知陷阱：`SettingRow` 会把 children 包进 `role="group"`，`getByLabelText` 会命中多个 → 用 `findByPlaceholderText`；`configBaseUrlRequired` 的英文文案是 "Endpoint is required" 而不是 "Base URL is required"。

实测的订阅能力：44 个内置 provider 里 9 个带 OAuth —— `anthropic`（Claude Pro/Max）、`github-copilot`、`kimi-coding`、`meta`、`openai`（Sign in with ChatGPT）、`openai-codex`（ChatGPT Plus/Pro）、`openrouter`、`radius`、`xai`（SuperGrok / X Premium）；其余 40 个有 `apiKey.login`（amazon-bedrock / anthropic / azure / deepseek / google / groq / mistral / moonshotai / openai / openrouter / together / vercel-ai-gateway / xai / zai / magpie 等），走「用 API Key 登录」由 SDK 校验并写 `auth.json`，不再要求手改 models.json。

SDK 段落的 `model.auth.providers` 是**惰性加载**的：展开 SDK 供应商 `<details>` 才拉一次（`authLoaded` 标志）。原因不是性能，而是 `models-settings-panel.test.tsx` 对 `model.list` 调用序列有精确断言，挂载时多发 IPC 会打破它。

**验收（实测）**

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.web.json --noEmit` | ✅ 0 |
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ 0 |
| `node scripts/check-i18n-parity.mjs` | ✅ locales are in parity |
| `npx eslint .`（目标文件） | ✅ 0 |
| `npm run gen:ipc` | ✅ 322 invoke / 12 event 通道（新增 5 个 `ipc:model.auth.*`） |
| `npm run test:unit` | ✅ 470 文件 / 2855 例通过；1 个既有失败 `scripts/relay/server.test.mjs`（rolldown 解析 `scripts/relay/server.mjs` 的 shebang，commit e13380f 引入，与本轮无关） |
| `npm run test:scripts` | 4 个既有失败（`incomplete-assistant-timeline` / `ipc-schema-coverage` 56>55 / `session-goal-contract` / `structure-boundaries`），本轮未新增未校验 handler（5 个新通道全部 `registerHandlerWithSchema`），计数未变 |

> 订阅登录的 `getDeviceId` 复用生图身份里的安装 UUID —— 「Sign in with ChatGPT」要求 `urn:uuid:<uuid>`，否则直接报 "requires a device ID (UUID)"。
