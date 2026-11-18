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

## 已登记的技术债（本轮不做，写在这里防丢）
1. `IpcMethodMap`（`packages/shared/ipc-contract.ts`）与实现脱节：266 处 handler 全用字面量，`ipcChannel()` **0 次使用**。T1 后白名单已自动同步，但 request/response 类型仍未从注册点推导 → 下一步让 `registerHandlerWithSchema` 反推类型，逐步淘汰手写接口。
2. 仓库根目录有 6 个游离调试文件（`_check.ps1`、`_check.txt`、`_filter.ps1`、`_full.txt`、`_probe.ps1`、`_probe.txt`、`_parse.mjs`），非本次产物，未清理；建议加入 `.gitignore` 或删除。
3. `handleSlotExit` 的 `autoRestartEnabled=false` 行为本轮未改（只增加可观测性）。若将来要"崩溃后自动续跑会话"，需要产品决策 + T5 的状态机。
4. `packages/shared/feature-flags.ts` 目前只有基建与单测，**尚无读取点**；第一个接入点建议放在 G2（`plugin_manager`）或 T8（`theme_json_presets`），不要为了"用上"而给现有稳定功能套开关。
