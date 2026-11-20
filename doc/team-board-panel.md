# 工作团队面板（Team）迁移说明

> 来源：`F:\maxv\dsh插件\dsh-mx-workflow\packages\flow-board`（DSH 插件，v0.6.3）
> 目标：pi Desktop 右侧栏新增「工作团队」面板，沿用同一套项目数据，去掉 HTTP 服务与 iframe。
> 代码：`src/renderer/src/features/team-board/` · `src/main/team-board.ts` · `src/main/ipc/handlers/team-board.ts` · `packages/shared/team-board.ts`

## 1. 原插件值得优化的地方

按影响从高到低。括号里是改动前的实现位置。

### 架构与运行方式

1. **一个看板要跑两个本地 HTTP 端口**（`board/dev-server.mjs` 7860 + `src/index.js` 7861）。
   面板是 iframe，主题靠 `postMessage` 桥接，宿主和面板各维护一份 URL/端口常量
   （`src/client.js` 写死 `http://127.0.0.1:7860`）。端口被占、宿主没起、插件升级不同步，
   都会表现成「面板空白 / 打开旧版插件」。
2. **子进程生命周期复杂**：宿主半要依次尝试 managed node、`node`、`electron RUN_AS_NODE`
   三个候选，轮询端口、杀失败进程。这些在 Electron 主进程里本来不需要。
3. **两套 HTTP API 没有鉴权**：看板端口只绑 127.0.0.1（这点是对的），但 7861 的
   `/dispatch` 没有 token/origin 校验——本机任何进程或页面都能构造请求，让 agent 起会话、
   消耗 token。看板 `/api/status` 同样可被本机任意客户端调用。
4. **默认配置写死了作者机器路径**：`DEFAULTS.specDir = 'F:/demo/.文档/开发规范'`，
   新用户首次启动会打到不存在的目录；控制口端口也是固定值。

### 数据与状态

5. **markdown 是唯一真相（优点），但解析/写回是逐行正则拼接**：
   `readLf()` 强行把 CRLF 归一成 LF、`replace(/（.*）/)` 清状态后缀、按 `^### T-` 切段、
   字符串替换索引行。没有纯函数测试，`board.html` 里 2700 行内联 JS 也没有 DOM 覆盖。
6. **并发只靠目录锁**：`round-store` 的 `.更新锁` + `collaboration-store` 的 `.状态锁` +
   `writeAtomic` 是正确方向，但锁的粒度/路径随功能变化，两个进程各锁各的时仍可能丢更新
   （原代码已经在注释里承认过）。人直接编辑 markdown 可以绕过所有状态机约束。
7. **角色配置三层回退**：项目 `角色配置.json` → 中心 `data/角色配置.json` → 旧
   `角色配置.md`，同时回写 `.md` 镜像。旧七角色还要在读取时收敛成五角色，长期容易漂移。
8. **状态机规则分散**：6 个状态 + 别名（待认领/完成）、人工处理、阻塞分型、轮次可写性、
   验收勾选、依赖检查，分别散落在 `manual-status.mjs`、`dev-server.mjs`、`round-store.mjs`、
   `role-policy.js`。规则本身很好，但只在 HTTP 层执行，复用和审计成本高。
9. **模型目录每次冷启动都全量枚举**：`buildCatalog()` 遍历 provider/model 并逐个
   `resolveModelInfo`，15 秒缓存；拿不到宿主目录时退回用正则解析 `cordis.patch.yml` 的 YAML
   （还内置了两条 deepseek 模型）。慢且脆。

### 体验与可维护性

10. **一切 UI 在一个 2736 行的 HTML 里**：没有类型、构建、组件复用；主题、i18n、
    键盘操作都靠手写。泳道拖拽之外，没有键盘改状态的路径；面板本身也不随宿主语言切换。
11. **信息密度过高**：宽面板里同时塞轮次、设置、初始化、接管、团队、泳道、按人、
    人工验收、轮次详情、角色设置等 12 个弹层。核心动作「看卡 → 派发 → 收口」被大量
    协议文案包围。
12. **头像资源 628 KB、预览图入库**（`board/assets/roles`、`preview/`）。本身不算问题，
    但和代码混在一起，没有按用途分层。

## 2. 迁移后做了什么

| 维度 | flow-board | pi Desktop「工作团队」 |
|------|------------|------------------------|
| 运行形态 | Node 子进程 + 2 个 HTTP 端口 + iframe | React 面板 + 主进程 IPC，无端口 |
| 通信 | fetch/HTTP + postMessage | preload allowlist 的 `ipc:teamBoard.*` |
| 安全 | 本机无鉴权 HTTP | `authorizeProjectCwd` + IPC schema 校验 |
| 数据真相 | `<workspace>/.文档/开发规范/看板/当前批次.md` | 完全兼容同一文件 |
| 角色配置 | 三层回退 + md 镜像 | 项目 `角色配置.json` + 默认值；仍写 md 镜像 |
| 状态写回 | 读-改-写 + 目录锁 | 同一把看板锁（有轮次目录时用 `看板/轮次/.更新锁`），保留 CRLF |
| 派发 | 控制口 → 宿主 workflow 子会话 | `newSessionInBackground`，不抢占当前对话 |
| 完成通知 | 宿主原生结果事件 | `run` settled / `completion` 事件 → 自动落账 |
| 角色会话 | 角色头像 → 预设会话 | 角色头像 → 常驻角色会话；任务派发另起会话 |
| 模型/思考深度 | 控制口目录 + YAML 兜底 | 复用 `available-models-cache` 与 worker 的 setModel |
| 初始化 | 看板内弹层 | 看板内弹层（新项目/接管老项目） |
| 建卡 | 依赖 agent `flow_task` 工具 | 面板「+」直接建 T-xxx，写索引 + 详情 |
| i18n/主题 | 手写 + `postMessage` | 复用 i18n 命名空间与 CSS token |
| 测试 | node:test（stores/policies） | 14 个 shared 单测、11 个 main 单测、5 个面板单测、1 条 E2E、截图巡检 |

### 已迁移的核心能力

- 批次信息（当前批次、目标）与进度（已验收/总数、阻塞数）。
- 五角色坞：Leader / 设计师 / 前端 / 后端 / 质量测试，头像、模型、运行状态、未验收任务数。
- 六泳道：待办 → 进行中 → 待审查 → 阻塞 → 实现完成 → 已验收，支持拖拽改状态；
  拖入「已验收」「阻塞」会先弹确认/分型表单。
- 泳道横向浏览：鼠标滚轮（含触控板横滑）直接左右滑，按住泳道背景可以拖动平移；

### agent 侧 `team_board` 工具

- worker 里的内置扩展 `src/worker/worker-team-tools.ts` 注册 `team_board`（hidden），
  动作：`snapshot` / `create_task` / `move_task` / `dispatch` / `comment`；
  请求经 `team-tool-request` 回到主进程，由 `src/main/team-board-tool-bridge.ts` 执行。
- 落盘与派发复用 `src/main/team-board-ops.ts`（与面板 IPC 同一套：依赖校验、模型路由、
  后台会话、运行记录、卡片进「进行中」），不存在两套派发逻辑。
- 闸门：`已验收` 只能人工确认；`阻塞` 必须带 `blockType`；一次最多建 12 张卡。
- Leader 的开场白因此改成「用 team_board 拆卡 + 派发，不要自己写业务代码」；
  派发会话的硬规则也改成用 `team_board` 写状态/回执，不再手改 md。
- 侧栏给团队开出来的会话加 `Users` 小标记（`session.list` 返回 `team.role`，
  来源是 `协作/团队.json` 的角色会话与派发记录）。

  列宽按面板宽度平均撑开、最小 152px，超出才横向滚动（`use-lane-pan` 负责，单测覆盖）。
- 卡片详情：角色、产出、依赖、波次、备注、人工处理/自动推进、验收清单、最近派发。
- 派发：按角色绑定模型与思考深度，在后台 worker 开工；提示词 = 角色核心规则 + 项目路径 +
  任务卡原文 + 硬性工作约定（不内联整套规范）。
- 自动落账：派发会话 `run settled`/`completion` 成功且卡片仍在「进行中」→「待审查」；
  失败/取消只写回执，不动状态。
- 角色会话：点角色头像进入/创建常驻会话；派发会话与常驻会话分开，互不覆盖。
- 团队设置：模型、思考深度、是否允许派发/直接对话；保存到项目 `角色配置.json`。
- 初始化/接管：生成看板、PRD（新项目草稿/老项目盘点）、总入口、错题本、品味账本。
- 建卡：面板内生成下一个编号，写索引行与详情段（含验收清单）。
- 双主题：亮/暗色都走宿主 token；也保留了 flow-board 的角色色与头像。

### 有意没迁移的部分

这些功能依赖 DSH 宿主特有的 agent 工具与轮次编排，直接搬会变成空壳：

- **轮次归档/暂停/切换**（`round-store`）：当前看板就是「当前批次」；历史批次需要时再按轮次
  目录扩展。
- **`flow_*` 工具**（`flow_status/delegate/report/review/accept/...`）：pi 没有同名工具协议。
  角色规则因此改写为纯提示词；Leader 仍需用户在主对话里推进，或后续给 pi 增加看板工具扩展。
- **自动质量审查/自动返工/缺陷决定**：需要审查者会话与结构化报告；当前是「会话结束 →
  待审查」，人工/质量测试会话再判断。
- **依赖自动接续**：目前只做派发前依赖校验（前置未验收就不许抢跑），不自动派下一个。
- **任务合同（mode/kind/必验表）与验收指纹**：会引入大量不可验证的元数据；先保留验收清单 +
  人工确认。
- **角色汇报频率、通知策略**：pi 已有完成通知，先不做每个角色一套策略。
- **模板中心（协议/清单/角色/栈）**：不复制进项目；项目里只生成总入口、PRD、看板、两本账。

## 3. 数据格式（与 flow-board 兼容）

```
<workspace>/.文档/开发规范/
├─ 看板/当前批次.md          # 任务真相（索引行 + 卡片详情）
├─ 角色配置.json             # 五角色 model/effort/enabled/directEnabled
├─ 角色配置.md               # 人读镜像（面板保存时同步）
├─ 协作/团队.json            # 角色常驻会话映射 + 派发运行记录（本面板新增）
├─ PRD.md
├─ 00-总入口.md
├─ 错题本.md
├─ 品味账本.md
└─ 设计/                     # 设计稿与资源
```

`团队.json`：

```json
{
  "version": 1,
  "sessions": {
    "前端": { "sessionFile": "C:/.../xxx.jsonl", "sessionId": "...", "updatedAt": 0 }
  },
  "runs": [
    {
      "id": "uuid",
      "taskId": "T-001",
      "role": "前端",
      "sessionFile": "C:/.../yyy.jsonl",
      "status": "running",
      "startedAt": 0,
      "endedAt": 0,
      "settledTo": "待审查"
    }
  ]
}
```

看板写回同时更新两处：

- 卡片详情 `- 状态：`
- 任务索引 `| 编号 | 标题 | 角色 | 状态 | 一句话 |`

并追加/替换：

- `- 人工处理：时间 · from → to · 说明`（面板手动改）
- `- 自动推进：时间 · from → to · 说明`（派发/会话结束）
- `- 阻塞分型：待用户确认 / 缺环境/工具 / 外部依赖 / 执行失败`
- 进入「已验收」勾选全部 `- [ ]`，离开时取消 `- [x]`

CRLF 会原样保留；只有索引行、没有详情段的老卡片会在下一次改状态时自动补一段详情。

## 4. IPC

| Channel | 作用 |
|---------|------|
| `ipc:teamBoard.snapshot` | 读看板 + 角色 + 会话映射 + 运行记录 |
| `ipc:teamBoard.taskStatus` | 改状态（带 `from` 乐观并发校验；已验收需 `manualConfirmed` + 原因） |
| `ipc:teamBoard.task.create` | 建卡（下一个 T-xxx，写索引 + 详情） |
| `ipc:teamBoard.dispatch` | 后台建会话、设模型/思考深度、发提示词、记录运行 |
| `ipc:teamBoard.roleSession` | 打开/创建常驻角色会话 |
| `ipc:teamBoard.roles.save` | 保存五角色绑定 |
| `ipc:teamBoard.init` | 初始化/接管项目 |
| `ipc:teamBoard.prompt` | 复制派发包 |
| `ipc:teamBoard.settleRun` | 会话结束落账（自动/手动） |
| `ipc:teamBoard.activeRuns` | 只读活跃派发（常驻 watcher 用） |

## 5. 使用

1. 打开项目 → 右侧栏「工作团队」。
2. 没有看板：点「初始化看板」（新项目）或「接管老项目」（生成待盘点 PRD）。
3. 右上角 ⚙ 给五个角色选模型/思考深度。
4. 左上「+」建任务卡；让 Leader 在对话里拆卡也可以（卡格式相同）。
5. 点卡片 →「派发开工」：后台会话开工，卡片自动进「进行中」；会话结束自动进「待审查」。
6. 拖卡片改状态；拖到「已验收」要先勾选人工验证并写清边界。
7. 点角色头像进入常驻角色会话；点「最近派发 → 打开会话」看某次任务的执行过程。

## 6. 已知限制 / 下一步

- 看板变更用 8 秒轮询 + 操作后刷新，不是 SSE；本地面板足够，但多窗口同时改会有最多 8 秒延迟。
- 自动落账依赖 `run`/`completion` 事件；应用重启后仍在跑的记录会显示「会话可能已结束」，
  可手动「结束这次派发」。
- WSL 工作区：看板文件路径按宿主工作区根目录拼接，WSL 模式下若工作区是 Linux 路径需要额外的路径转换；当前与既有的 workspace-tasks 面板保持同一限制。
- 没有 agent 侧的建卡/改状态工具：Leader 目前只能读看板、在对话里说「已完成」，由人或
  质量测试回面板改状态。下一步可做一个 pi 扩展，暴露 `team_task_create/status/report`，
  再把自动审查/返工接回来。
- 轮次归档、任务合同、验收指纹、汇报频率未迁移；需要时按上面的数据格式增量实现。
- E2E 在本机 Electron 43 + 当前 Playwright 组合下会因 `--remote-debugging-port=0` 启动失败
  （与本次改动无关，`e2e/smoke.spec.ts` 同样失败）；截图与链路验证用 CDP 脚本完成。

## 7. 运行语义（第二轮：借鉴 dsh-super-agent 的 Ticket/Assignment/Watchdog）

第一轮迁移解决的是「面板能看能派发」。第二轮补的是「派发之后到底发生了什么」——
参考 `https://github.com/LofiSu/dsh-super-agent` 的 `core/stage.ts`、`core/assignments.ts`、
`watchdog/*`、`harness/team.ts` 里那套「状态由事实推导、回执有类型、卡住会被兜住」的做法，
但不搬它的 SQLite 真相、Router/Worker 双角色、Eval/deliver gate 和 mesh。

### 7.1 阶段由事实推导，不由标签决定

`packages/shared/team-board.ts` 的 `deriveTeamStage({ task, run })` 是纯函数，UI 只负责展示：

| 阶段 | 判定 |
|------|------|
| `awaiting-approval` | 卡片有 `- 待批准：`，或「阻塞 / 待用户确认」 |
| `stale` | 派发还是 starting/running，且已被看门狗标 `staleAt` |
| `queued` / `running` | 派发 starting / running |
| `awaiting-review` | 卡片「待审查」，或最近派发已交付 |
| `failed` | 最近派发 failed/cancelled |
| `blocked` | 卡片「阻塞」且不是待批准 |
| `accepted` | 卡片「已验收」 |

markdown 仍是唯一真相；阶段只是同一份事实的更细读法，所以刷新、重启、外部手改都不会让
面板和执行方各说一套。

### 7.2 派发回执是结构化的

`TeamRun.report = { kind, text, at, verdict }`：

- `kind`：`ready` 已交付 / `failed` 失败 / `blocked` 受阻 / `waiting` 等触发 / `question` 待答复。
- `text`：一句话回执；长报告与证据留在会话与 `协作/`。
- `verdict`：`deliver` 值得给主人看 / `hold` 压住 / `discard` 不值得发。

落账时由 `settleTeamRun` 写入，`closedBy` 区分「宿主自动落账」与「人工结束这次派发」。

### 7.3 看门狗：派发死在半路会被兜住

`src/main/team-board.ts` 的 `sweepTeamRuns(spec, cwd)`。

- 判定：派发仍在 starting/running，且 `max(startedAt, 会话文件 mtime)` 距今超过
  `TEAM_RUN_STALE_MS_DEFAULT`（30 分钟）。
- 动作：给派发标 `staleAt`（只标一次），把对应「进行中」卡片移到「阻塞 / 待用户确认」，
  自动推进里写清「派发超过 N 分钟没有结束事件」。
- 不动：已有待批准字段的卡、已收口/已验收的卡、还在写会话文件的派发。
- 覆盖范围：应用重启后悬空的 starting/running 记录也会被收敛（会话文件 mtime 兜底）。
- 之后可以「结束这次派发」或直接重新派发：超时记录会被自动关掉再开新的，不用先手动收尾。

渲染层 `TeamBoardAutoSettle` 常驻每分钟 tick 一次（仅可见窗口），并把新被阻塞的卡用一条
toast 提示出来；主进程不持有定时器。

### 7.4 卡片级审批（hold，而不是直接做）

不需要给 agent 装工具：审批走同一份 markdown 字段，面板与执行方天然共享真相。

执行方（派发提示词已写明这条约定）遇到需要拍板的动作：

```markdown
- 状态：阻塞
- 阻塞分型：待用户确认
- 待批准：给 200 个用户发上线通知邮件 · 外发不可撤回
```

面板：顶部出现「N 待批准」，卡片带「待批准」标签和左侧警示边；卡片详情里是批准/驳回面板。

- 批准：清掉 `- 待批准：`，落一行 `- 批准：<时间> · <备注>`，卡片回「进行中」，
  并把「主人已批准：<动作>」发回这一轮会话让它继续；会话已不在就只放行卡片。
- 驳回：落一行 `- 驳回：`，卡片留在「阻塞 / 待用户确认」。
- 两者都带 `from` 乐观并发校验；没有待批准事项时返回 `no_pending_approval`，不会静默改卡。
- 落账不会越过待批准：有 `- 待批准：` 的卡不会被会话结束自动推进到「待审查」。

### 7.5 插话与中止

- **插话**：向这一轮会话发一条指引（`主人插话：…`），并在卡片「自动推进」留一行
  `人工插话：…`，所以事后能看到是谁、在第几轮改了方向。
- **中止**：`workerManager.abort` 关会话 → 派发记 `cancelled` + `closedBy: human`（只关记录，
  不覆盖卡片说明）→ 卡片从「进行中」转「阻塞 / 待用户确认」。

### 7.6 写回防护

- `sanitizeTeamText()`：去 NUL/ESC/DEL、双向文本标记，折叠换行与空白，按字段截断。
  所有非结构化写回（状态说明、人工/自动推进、阻塞分型、审批备注、新建卡字段）都过它。
- 结果：一段恶意备注没法在看板里伪造出新的 `### T-999` 标题段。
- 派发记录归一化时同样清洗 `report.text`，旧版本 `协作/团队.json` 缺字段也能读。

### 7.7 测试锚点

- `packages/shared/team-board.test.ts`：阶段矩阵、解析 `- 待批准：`、批准/驳回写回、
  乐观并发与 `no_pending_approval`、控制字符清洗。
- `src/main/team-board.test.ts`：看门狗标记一次、仍在写的派发不动、待批准卡不被改写、
  落账写回执并清 `staleAt`、重复落账幂等、审批写回看板索引。
- `src/renderer/src/features/team-board/team-board-panel.test.tsx`：待批准计数与批准动作。

### 7.8 仍未做（有意留下的下一步）

- **agent 侧结构化工具**（`team_task_create/status/report/approve_request`）：目前靠
  `00-总入口.md` 里的「看板卡格式 / 待批准约定」+ 派发提示词的硬规则，agent 能按格式建卡、
  改状态、申请批准、写回执，但没有参数校验和角色守卫。要做得更硬，应该写成 pi 扩展
  （`.pi/extensions/team-board.ts`），并复用 dsh-super-agent 的「角色守卫 + 双格式解析 +
  永远抛带原因的 UserError」写法；在那之前，宁可让格式写在协议文件里，也不要半成品的工具。
- **轮次归档 / 任务合同 / 验收指纹**：仍按第一轮的口径不迁移。
- **面板实时推送**：仍是 8 秒轮询 + 事件刷新够用；多窗口并发改最多 8 秒延迟。
