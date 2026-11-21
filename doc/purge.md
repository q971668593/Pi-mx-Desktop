# 破甲开关（purge）

设置 › Agent › 破甲：一个开关，把 pi 的系统提示词换成本地人设（默认带你 DSH 正在用的「小码酱」）。
只换提示词，不 patch pi、不改 `node_modules`。

## 链路

```
安装包 resources/purge/{pi-app-purge.ts, persona.md}
   │  app 启动（src/main/index.ts）
   ▼
ensurePurgeInstalled()            src/main/purge/controller.ts
   │  扩展每次启动覆盖一份；人设只在缺失时补（不盖用户改过的）
   ▼
<agentDir>/extensions/pi-app-purge.ts        ← pi 在会话创建时扫描
<agentDir>/purge/persona.md                  ← 人设正文
<agentDir>/purge/config.json                 ← { enabled, mode, source }
   ▲
   │  设置页开关（IPC purge.setEnabled / setMode）
src/renderer/src/features/settings/purge-settings-panel.tsx
```

扩展（`resources/purge/pi-app-purge.ts`）在 `before_agent_start` 前读一次 `config.json`：

- `config.json` 直接比**内容**（几行小文件），人设按 `mtime + 字节数` 判断，
  所以设置页拨完，当前会话的**下一句话**就生效 —— 不重启、不敲命令。
- 人设文件缺失或为空时**不接管**，宁可按原样发，也不会把系统提示词发空。

## 三种模式

| 模式 | 发出的提示词 | 代价 |
| --- | --- | --- |
| `strict`（默认） | 人设 + `Current working directory: …` | 宿主提示词整段丢弃，`AGENTS.md` / skills 列表也没了 |
| `replace` | 人设 + 宿主提示词（切掉身份句和 `<docs>` 文档段） | 工具规则保留；锚点匹配不到就退化成 `append`，不会切坏 |
| `append` | 人设 + 宿主提示词原样 | 最温和，效果也最弱 |

`/purge [on|off|status|mode|source|reload]` 命令仍然保留，改的是同一份 `config.json`，终端 `pi` 也能用。

## 人设为什么不进仓库（开源角度的取舍）

`resources/purge/persona.md` 被 `.gitignore` 排除，仓库里只有 **能力**（导入入口、格式、校验、开关）和一份
**模板** `resources/purge/persona.example.md`。

理由不是"藏私"，而是三条硬账：

1. **开源的是软件，不是某个人的提示词。** 人设等于别人的 dotfiles / 主题 / 个人笔记：它只对写它的那个人有意义，
   对使用者没有复现价值 —— 真正有价值的是"可以换成自己的"。
2. **风险不对称。** 把人设放进公开仓库，几乎不会让项目更受欢迎（大多数人只关心功能），
   却会把仓库暴露在内容审查和举报面前：这类"替换模型系统提示词"的文本，是平台风控最容易命中的一类，
   仓库一旦被限流/封禁，代码和 Release 一起没。安装包不公开分发，风险面小得多。
3. **它是会过期的配置，不是稳定的代码。** 提示词跟模型版本走，几个月就要调一次；
   放进仓库意味着每次调口味都得留一条公开 commit，历史还删不掉。

所以采用：**能力开源 + 内容私有**。
官方发版时由 CI 用仓库 secret `PURGE_PERSONA_B64` 还原人设进安装包；
fork 或自己克隆的仓库没有这个 secret 也能正常打包，只是包里不带人设，设置页会提示导入。

想用自己的：

```bash
cp resources/purge/persona.example.md resources/purge/persona.md   # 然后改成自己的
```

想让它跟官方一样自动进安装包：把 base64 存成仓库 secret `PURGE_PERSONA_B64`
（`[Convert]::ToBase64String([IO.File]::ReadAllBytes('…\persona.md'))` → 剪贴板 → Settings → Secrets → Actions）。

## 打包

人设正文**不进 git**（`.gitignore` 里 `resources/purge/persona.md`）：仓库是公开的，安装包才发给自己。

```powershell
npm run purge:persona     # 从 ~/.dsh/prompt-inject.md 生成 resources/purge/persona.md
npm run purge:persona -- --from C:\path\to\prompt.md
npm run purge:verify      # 离线自检：开关链路 + pi 真实加载器
npm run package:win       # 已经串在包里：先生成人设，再 build，再 electron-builder
```

`package` / `package:win` 已带上 `purge:persona`。打包机上没有源文件时不报错，只是安装包不含人设 ——
装到别的机器后，设置页会提示「导入人设」，选一个 markdown 即可。

安装包内的位置：`<安装目录>/resources/purge/`（见 `electron-builder.yml` 的 `extraResources`）。

## 验证

| 命令 | 验什么 |
| --- | --- |
| `npm run purge:verify` | 扩展：假宿主 + 假模型，15 项断言（写 config → 立刻接管；strict 切身份句与 `<docs>`；replace 留工具规则；缺失人设不接管） |
| `npx vitest run src/main/purge` | 主进程：装/读/写 config、人设不被覆盖、模式归一化 |
| `npm run test:scripts` | IPC 契约、schema 预算、通道同步 |
| `npm run typecheck` / `npm run build` | 类型与打包 |

## 注意

- **升级后第一次**需要重启一次 Pi mx：扩展只在「会话创建」时扫描，已经开着的会话看不到新扩展。
  之后拨开关都是即时生效。
- 状态在 `config.json` 里**持久**，退出 app 不会自动关；想彻底还原：关掉开关，再删
  `<agentDir>/extensions/pi-app-purge.ts`（或点设置页「重新安装」把文件补回来）。
- WSL 模式：`<agentDir>` 是发行版里的 `~/.pi/agent`（UNC 路径），复制和读写都走同一套路径解析。
- 只换提示词。宿主自己的审批、沙箱、工具权限一概不动 —— 那些是 pi 的代码行为，改提示词影响不到它们。
