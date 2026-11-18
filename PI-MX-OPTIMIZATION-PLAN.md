# Pi mx Desktop 优化改造方案（借鉴 opencode）

> 版本：v1（2026-11-18）
> 参考对象：`anomalyco/opencode` v2.3.0（dev 分支，本地参考副本 11537 文件 / 33 packages）
> 定位：本文只回答「抄什么、怎么抄、怎么验收」。执行拆分见 [PI-MX-OPTIMIZATION-TASKS.md](./PI-MX-OPTIMIZATION-TASKS.md)

---

## 0. 一句话结论

opencode 是「自研内核 + 本地 daemon + 多客户端」，我们是「pi SDK worker + Electron IPC + pi 数据共用」。
**内核不抄、数据层不抄、权限模型不抄**；抄它的**工程手法**：契约单一事实源、生命周期状态机、崩溃恢复账本、内容寻址快照、结构规则门禁、特性开关注册表、主题 token 契约、发布与仓库即上下文。

## 1. 对照证据（我们凭什么这么判断）

| 维度 | opencode | Pi mx Desktop | 结论 |
|---|---|---|---|
| 进程 | `packages/desktop` sidecar 拉起 CLI daemon，renderer 走 Effect RPC + HTTP/SSE | `src/main` 起 `src/worker`（pi SDK），`ipcMain.handle` + `webContents.send('ipc:events')` | 不同构，不照搬 |
| 会话存储 | SQLite + Drizzle + 事件溯源 + 投影（`packages/core/src/session/{store,projector,inbox}.ts`） | pi 的 JSONL（与 CLI 共用，路线图明确「不另造内核、不分开存」） | 禁止照搬 |
| 契约 | `packages/protocol` 声明 → `packages/client/script/generate.ts` 生成客户端/SDK/文档 | `packages/shared/ipc-contract.ts`（接口）+ `ipc-channels.ts`（另一份扁平白名单）+ 正则同步测试 | **可抄，收益最高** |
| 生命周期 | `desktop/src/main` 里 11 个 `*-machine.ts`，纯函数 `transition(state,event)→{state,commands}`，同目录测试 | `worker-manager.ts` 1038 行 + `session-shell-stream-switch-race.test.ts` 668 行 | **可抄** |
| 崩溃恢复 | 写前 claim + `session/execution/restart.ts` 启动续跑 + 每 turn 尝试预算 | worker 退出只发 `ipc:worker-exit` / `ipc:worker-fatal`，无持久账本 | **可抄（收敛版）** |
| 撤销/对比 | `core/src/snapshot.ts` 独立 git dir + tree 内容寻址 + 按路径 restore | `features/rewind` + `pi-rewind` 适配器 + `navigateTree` 双路径 | Phase 2 |
| 本地状态 | `desktop/src/main/storage/*`：SQLite + 迁移 + `write-behind-machine` | `electron-store`（JSON 全量重写）+ 已有 `better-sqlite3` 依赖 | Phase 2 |
| 门禁 | `script/ast-grep` 规则 + 规则测试 + 快照；`oxlint`；`lint:changed` | `eslint` + `scripts/tests/*.test.mjs`（预算型断言） | **可抄（形状门禁）** |
| 开关 | `packages/schema/src/config/flag.ts` 注册表 + `optInOnly` + 别名 + 退场即删 | 无注册表 | **可抄（成本极低）** |
| 主题 | 语义 token + `desktop-theme.schema.json` + 35 个 JSON 主题 + `theme/machine.ts` | `appearance-theme-editor.tsx` 778 行 + `settings-general-appearance.tsx` 721 行 | Phase 3 |
| 发布 | `.github/release/*` 分步脚本 + `verify-artifacts` + 校验和 + 多通道 | `electron-builder` + `doc/RELEASE.md` | Phase 3 |

## 2. 目标与非目标

**目标**：把「靠人肉记忆 + 长测试」维持的一致性，换成「靠生成 + 靠门禁 + 靠纯函数」维持。
**非目标（与 `doc/ROADMAP.md`「明确不做」一致）**：自建内核、daemon 化、分叉数据、权限弹窗、预装插件包、Effect/Bun 技术栈迁移。

## 3. 阶段划分与验收

### Phase 1（本轮实施）

#### T1 · IPC 契约单一事实源
- **问题**：同一份通道信息存在三处——`ipc-contract.ts` 的 `IpcMethodMap` 接口、`ipc-channels.ts` 的 265 条扁平白名单、`src/main` 里 266 处 `registerHandler('ipc:…')` 字面量。`ipcChannel()` 辅助函数 **0 次使用**。三者靠 `scripts/tests/ipc-channel-sync.test.mjs` 的正则互检维持，且 `doc/IPC-CONTRACTS.md` 只有 51 行、手工维护。
- **方案**（opencode 的「声明 → 生成」思路，以现有注册点为事实源）：
  1. 新增 `scripts/generate-ipc-channels.mjs`：扫描 `src/main/**/*.ts` 的 `registerHandler` / `registerHandlerWithSchema` 调用，产出
     - `packages/shared/ipc-channels.generated.ts`（排序去重的 `IPC_INVOKE_CHANNELS` + `IPC_EVENT_CHANNELS`）
     - `doc/IPC-CONTRACTS.generated.md`（按域名分组 + 计数 + 注册文件路径）
  2. `packages/shared/ipc-channels.ts` 退化为薄壳：re-export 生成数组 + `channelSet` + `isAllowedIpcChannel`。
  3. `package.json` 增加 `"gen:ipc": "node scripts/generate-ipc-channels.mjs"`。
  4. 新增契约测试 `scripts/tests/ipc-channels-generated.test.mjs`：以 `--check` 方式跑生成器，不一致即失败并提示运行 `npm run gen:ipc`（漂移门禁）。
  5. 保留并修正 `ipc-channel-sync.test.mjs`：允许通过生成的白名单校验，并断言「main 里注册的通道 ⊆ 白名单」与「白名单 ⊆ 注册」。
- **涉及**：`packages/shared/ipc-channels.ts`、新增 `packages/shared/ipc-channels.generated.ts`、`scripts/generate-ipc-channels.mjs`、`scripts/tests/ipc-channel-sync.test.mjs`、新增 `scripts/tests/ipc-channels-generated.test.mjs`、`package.json`、`doc/IPC-CONTRACTS.generated.md`
- **验收**：`npm run gen:ipc` 幂等（二次运行无 diff）；`npm run test:scripts` 全绿；`npm run typecheck` 通过；挑一个通道改名后不跑生成器则测试红（门禁有效）。
- **风险**：preload 白名单来源变化 → 已由 `isAllowedIpcChannel` 语义保持；生成文件需提交（`.gitignore` 不排除）。

#### T2 · 结构边界门禁
- **问题**：`doc/TYPE-BOUNDARIES.md` 用**文档**声明边界（renderer 不得直连主进程、`ipcRenderer` 只能在 preload、`apply-app-event` 必须是纯归约），但没有可执行门禁，改错只能靠 review。
- **方案**：新增 `scripts/tests/structure-boundaries.test.mjs`（node:test），三条规则：
  1. `src/renderer/**` 不得 import `electron`、`src/main`、`@main/*`；
  2. `ipcRenderer` 仅允许出现在 `src/preload/**`；
  3. `src/main/**` 不得 import `@renderer/*`；
  4. `packages/shared/**` 不得 import `electron`。
- **验收**：`npm run test:scripts` 全绿；违规注入（临时 import）能被拦。
- **风险**：若现状已有违规，按「预算登记」风格（沿用 `worker-any-budget.test.mjs` 的写法）显式记数并输出清单，不静默放过。

#### T3 · 特性开关注册表
- **问题**：实验性能力只能靠散落的环境变量与隐藏设置，缺「哪里开、默认值、什么时候删」的单一清单。
- **方案**：新增 `packages/shared/feature-flags.ts`：
  - `FLAG_REGISTRY`（key → 中文说明）、`OPT_IN_ONLY`（必须显式开启）、`FLAG_ALIASES`（旧名兼容）
  - `resolveFlags({ env, isDev })` → `Map<key, boolean>`，支持 `PI_FLAGS=all,-foo` / `PI_FLAGS=foo`
  - `isFlagEnabled(key, ctx)`、`assertKnownFlag(key)`
  - 规则写进模块头部注释：**功能转正即删注册表条目与读取点**
- **验收**：`packages/shared/feature-flags.test.ts`（vitest）覆盖 all/-x/别名/optInOnly/dev-release 默认值；`npm run test:unit` 绿。
- **风险**：暂无读取点 → 本轮只交付基建 + 文档 + 测试，接入点留给 G2/G4（在任务表中登记）。

#### T4 · 运行账本（崩溃恢复收敛版）
- **问题**：worker 崩溃/被杀时，`handleSlotExit` 只清理池 + 通知渲染层；**「哪个会话正在跑、跑到哪一步」没有任何持久记录**。重启后用户看到的是「对话还在，但那一轮消失了」，也没有 resume 线索。
- **方案**：
  1. 新增 `src/main/run-ledger.ts`（纯模块，可注入 fs 与时钟）：
     - `beginRun({ sessionFile, cwd, runId, turnId? })`、`releaseRun(sessionFile, reason)`、`markOrphaned(...)`
     - `listOrphans(maxAgeMs)`、`sweep(reason)`、`snapshot()`
     - 存储：`userData/run-ledger.json`（原子写：临时文件 + rename），最多保留 200 条
  2. 接线（`src/main/worker-manager.ts`，控制在 ~25 行）：
     - `sendPrompt()` 成功 → `beginRun`
     - `forwardAppEvent()` 收到 `type==='run'` 且 `phase ∈ {idle, failed, cancelled}` 或 `settled===true` → `releaseRun`
     - `handleSlotExit()` 非 `stopping` 且 `code !== 0` → `markOrphaned`，并把 orphan 数量/会话写进 `ipc:worker-fatal` 的 payload（渲染层可立即展示，不新增通道）
  3. 启动时 sweep：`workerManager` 首次 `start()` 前 `sweep('app-boot')`，把上次异常退出遗留的 run 标记为 orphan 并写日志。
- **验收**：`src/main/run-ledger.test.ts`（vitest）覆盖 begin/release/orphan/sweep/容量上限/原子写/损坏文件容错；`npm run test:unit` 绿；`npm run typecheck` 绿。
- **风险**：`run` 事件相位不全时可能漏 release → 用兜底：同一 session 的 `beginRun` 覆盖旧记录 + `sweep` 用 `maxAgeMs`（默认 6h）。
- **明确不做**：自动续跑（属于语义变更，需要产品决策）；UI 面板（Phase 2，等 T4 数据可用后再做）。

### Phase 2（下一阶段，本文只给设计，不在本轮实施）

> 实施进度：**T8 已于本轮开始**（契约 + 门禁已完成，见 `packages/shared/theme-tokens.ts` 与 `scripts/tests/theme-token-contract.test.mjs`；UI 接入待主题编辑器那批改动收尾）。

| 项 | opencode 参考 | 我们的落法 | 验收 |
|---|---|---|---|
| T5 worker 生命周期状态机 | `desktop/src/main/ipc-machine.ts`、`lifecycle/machine.ts` | 抽 `src/main/worker-machine.ts`：`idle/spawning/ready/busy/draining/dead` + `transition(state,event)→{state,commands}`，IO 留 manager | 纯函数单测覆盖全部转移；manager 行数下降 |
| T6 内容寻址快照 | `core/src/snapshot.ts` | 复用 `pi-rewind` 的 stage 机制，改为 tree/ID + 按路径 restore，供 G3 并排 diff | 截图级对比 + 单文件还原测试 |
| T7 本地状态 SQLite 化 | `desktop/src/main/storage/*` | 草稿/窗口几何/gitBoard 视图状态进 SQLite（迁移表 + write-behind 合并写） | 迁移幂等；崩溃后无丢写 |
| T8 主题 token 契约 | `ui/src/theme/*` + `desktop-theme.schema.json` | 抽 `theme-tokens.ts` 契约 + `themes/*.json` + JSON Schema 校验 | 导入非法主题被拒；35 套预设可选 |

### Phase 3（长期）

- T9 timeline/session-ui 抽包 + fixture 截图回归（对应 `packages/session-ui` + `packages/stories`）
- T10 发布产物校验和 + 更新通道（`latest` / `beta`）+ 拒绝校验和不符的更新包
- T11 `.pi/skills` + 术语表（对应 `.opencode/skills` + `.opencode/glossary`），把踩过的坑变成每次都会读到的规则

## 4. 质量门禁（每项改动都要过）

| 门禁 | 命令 | 说明 |
|---|---|---|
| 类型 | `npm run typecheck` | web + node 双工程 |
| 单测 | `npm run test:unit` | vitest（jsdom，含 `src/main/**/*.test.ts`、`packages/shared/**/*.test.ts`） |
| 契约 | `npm run test:scripts` | node:test 批量（含本次新增三道门禁） |
| Lint | `npm run lint` | eslint（含 `no-explicit-any` 预算） |

新增三道门禁（T1 漂移、T2 结构边界、T8 主题 token）均落在 `npm run test:scripts`，随 CI 自动执行。

> 执行约束（2026-11-18 实测）：本仓库当时有 50+ 个未提交的并行改动，`test:unit` 基线本身是红的（18 个文件）。锁定全绿需在**工作区静默**时进行；否则就是移动靶。

## 5. 回滚策略

- 每项改动独立可回滚：T1 生成文件 + 薄壳（回滚 = 恢复旧 `ipc-channels.ts`）；T3/T4 为新增文件，删除即回滚；T2 为新增测试，删除即回滚。
- worker-manager 的接线只有 3 个调用点，回滚时删 3 行 import/调用即可，无数据结构迁移。

## 6. 与 opencode 的取舍记录（避免以后反复讨论）

| 不抄 | 理由 |
|---|---|
| 自研内核 / 事件溯源会话库 | 与「不另造内核、数据不分叉」冲突；pi 的 JSONL 是唯一事实源 |
| 本地 daemon + 多客户端 | 同上；只借「版本协商 / 健康探测」思路留给未来 C1 远程 |
| Effect 全家桶 | React + Zustand 栈，迁移成本 ≫ 收益；只借「显式错误 / 服务层 / Schema 边界」思想 |
| 权限弹窗、plan 模式拦截 | 路线图已否决（事后 Review） |
| Bun + turbo 的 33 包 monorepo | 我们是 npm + electron-vite 单包；只保留 `packages/shared` |
| `packages/app` 的 253k 行单包体量 | 反面教材：他们靠 ast-grep + import 边界测试才没散架 |

---

## 7. 附录：子代理与「目标」指令（可行性结论 + 路线）

### 7.1 为什么我们现在没有子代理

**结论：pi 提供原语，但没有内置子代理工具；我们没装包、桌面端也没做编排。**

已核实的事实：

| 事实 | 依据 |
|---|---|
| 内置工具里没有 `task`/`subagent` | `defaultTools` 可选值为 `read/bash/powershell/edit/write/grep/find/ls`（+`codemode`/`tool_search`），无子代理工具 |
| pi 文档没有子代理章节 | `docs/index.md` 的目录里没有；`docs/subagents.md`、`docs/tasks.md` 不存在 |
| 多会话同进程是支持的 | SDK `createAgentSession()` 每个实例独立持有一个会话 + 模型 + 工具；`AgentSessionRuntime` 还有 `newSession()/fork()/switchSession()/importFromJsonl()` |
| 官方文档确实提到 in-process subagents | `docs/environment-variables.md` 中 `PI_CODEMODE_MAX_WORKERS` 一行：“one process runs several sessions, such as in-process subagents” |
| 当前没装 | `~/.pi/agent/settings.json` 的 `packages` 只有 `npm:pi-web-access` |
| 这个仓库见过这类包 | `eslint.config.mjs` 的 ignores 里有 `.pi-subagents/**` |

所以子代理在 pi 的体系里属于**扩展/包层**，不是内核内置。要做，两条路组合：

- **L1（1–2 天）扩展级**：写一个扩展注册 `task` 工具，内部 `createAgentSession()` 起子会话，把子会话事件折叠成父会话里的工具输出（可流式）。子会话仍是 pi 会话，不违反「不另造内核」。
- **L2（1–3 周）桌面端**：G4 的「子任务面板」——只读进度 + 可点进去看子会话时间线。前置是 T5 状态机（子会话生命周期比单会话复杂）。
- 必须防的坑：父会话**阻塞等待**子会话导致的死锁；子会话与父会话共享同一 `sessionFile` 语义造成的路由混乱（参考 `packages/shared/session-file-key.ts` 的既有教训）。

### 7.2 「目标」指令

**结论：pi 没有内置 `/goal`，但做出来是零成本的；做成桌面端一等公民才需要设计。**

已核实：`docs/index.md` 只在散文里出现 “Give it a goal”；没有任何 goal 类命令或工具。可用的四个扩展点：

| 机制 | 位置 | 特点 |
|---|---|---|
| Prompt Template | `~/.pi/agent/prompts/<name>.md` → `/<name>` | 支持 `$1`/`$@`/`${@:-默认}` 参数；`/reload` 生效；零代码 |
| Skill | `~/.pi/agent/skills/<name>/SKILL.md` | 按 `description` 由模型自主加载；适合「怎么写目标/验收标准」的方法论 |
| APPEND_SYSTEM.md | 用户级 / `.pi/` 项目级 | 永久追加到系统提示；适合“全项目强制带目标纪律” |
| Extension | `~/.pi/agent/extensions/` 或包 | 可注册工具 + 钩子；能把目标写进状态、每轮注入 |

交付与建议：

- **已交付 L1**：`~/.pi/agent/prompts/goal.md` → `/goal <目标>`，强制输出「一句话目标 / 验收标准 / 非目标 / 风险 / 计划」，并要求每轮按同一组标准自查（`/reload` 后可用）。
- **L2（建议做，1–2 天）**：桌面端「目标条」——会话级 `goal`（目标文本 + 3–5 条验收项）存 app 私有状态（见 T7），时间线顶部 pin，可勾选；发 prompt 时把目标与未达成项作为 pinned 前缀注入，**不进历史消息、不改 pi 的 settings/JSONL 结构**。
- **L3（一周）**：和 T4 的运行账本打通——每轮结束回填「本轮推进了哪条验收」，UI 显示达成度；目标未达成时禁止“已完成”式收尾提示。
- 硬约束：目标数据只进 app 私有状态；要跨端共享时走 pi 自己的 `APPEND_SYSTEM.md` / prompt 资源，不要在 JSONL 里塞自定义字段。
