# purge —— 给 pi-desktop（pi-app）装破甲

一份自带验证的本机破甲安装件：把 `pi-purge` 扩展 + 你的「小码酱」人设装进 pi 的 agent 目录，会话里 `/purge on` 就接管系统提示词。

不碰 `src/`、不碰 `node_modules/`、不改 pi 源码，删两个文件就恢复原样。

## 1. 破甲的东西都有哪些（本机 + GitHub）

| 来源 | 名字 | 对谁 | 形态 |
| --- | --- | --- | --- |
| 本机 `F:\maxv\dsh插件\dsh-purge` | dsh-purge 1.1.71（gitee `ma-xugood/dsh-purge` 分支，2 个提交：初始化 + 入口改左侧 panellist） | DeepSeek Harness | 82 条宿主补丁 + 提示词注入 |
| GitHub | [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) | DSH | 上游，作者已暂停维护 |
| GitHub | [dongliuwuzhong-arch/DSH-purge](https://github.com/dongliuwuzhong-arch/DSH-purge) | DSH 0.2.1-rc.3+ | 分支，87 条补丁 / 126 测试，解决 `app.asar` 优先于 `app/` 的生效坑 |
| GitHub | [LanJinGod/dsh-purge](https://github.com/LanJinGod/dsh-purge) | DSH | 分支 1.1.72 |
| GitHub | [ZiChuanLan/pi-purge](https://github.com/ZiChuanLan/pi-purge) | **pi** | pi 扩展，`/purge` 换系统提示词，0.3.0 对齐 pi 1.5.x |
| GitHub | [maple323/omp-purge](https://github.com/maple323/omp-purge)（你找的那份） | oh-my-pi | pi-purge + dsh-purge 的 OMP 移植，TS 扩展 |
| GitHub | [ZiChuanLan/agent-purge](https://github.com/ZiChuanLan/agent-purge) | codex / claude / opencode / grok / omp / hermes / pi / zcode / codebuddy | 一套人设多执行器，带本地 web 控制台 |

结论：**pi-app 属于 pi 家族，不吃 DSH 那套宿主补丁**。pi 没有可打补丁的 JS 宿主，官方口子是扩展 + `SYSTEM.md` / `APPEND_SYSTEM.md`，所以这里用 pi-purge。

## 2. 原理（对着 pi 1.5.2 实测过）

pi 扩展的两条钩子就是全部接缝：

- `pi.on("before_agent_start", …)` 返回 `{ systemPrompt: string }` = **整段替换**本轮系统提示词（`dist/core/extensions/types.d.ts:1249`）。
- `pi.on("session_start", …)` 每次新会话/恢复都从「关闭」开始 —— 状态只在内存里，退出即恢复。

三种组合方式：

| 模式 | 发出去的提示词 | 什么时候用 |
| --- | --- | --- |
| `strict`（默认） | 你的人设 + `Current working directory: …`，宿主提示词整段丢弃 | 破甲最彻底 |
| `replace` | 你的人设 + 宿主提示词（切掉身份句和 `<docs>` 文档段，工具规则保留） | 别丢工具说明 |
| `append` | 你的人设挂在宿主提示词前面 | 只做对照/最轻 |

`replace` 的锚点同时认 pi ≤1.4 和 ≥1.5.2 两种措辞，匹配不到就**原样放行**（退化成 append），不会把提示词切坏。

## 3. 用

```powershell
cd F:\maxv\PI\pi-app

node purge\install.mjs            # 装扩展 + 生成人设（全局 ~/.pi/agent）
node purge\verify.mjs             # 离线自检：假宿主、不调模型
node purge\probe-loader.mjs       # 用 pi 真实加载器确认能装上

# 只给当前项目装：
node purge\install.mjs --project

# 撤掉：
node purge\install.mjs --uninstall
```

装完**重启 pi-app**（扩展只在启动时扫描），然后在会话里：

```
/purge source C:\Users\mashiyi\.pi\agent\purge\persona.md
/purge on
/purge status        # 看模式 / 人设来源 / 上一轮到底切没切到
/purge off           # 随时还原
```

人设默认从 `~/.dsh/prompt-inject.md`（你 DSH 正在用的那份「小码酱」）生成，去掉 `<|im_start|>system:` 这种聊天模板外壳，落到 `~/.pi/agent/purge/persona.md`。换提示词：`node purge\install.mjs --persona <路径>`。

## 4. 为什么破甲文案不进仓库

pi-app 仓库是公开的（`q971668593/Pi-mx-Desktop`）。扩展代码可以进（MIT，保留 ZiChuanLan/pi-purge 署名），**人设正文只留在本机** `~/.pi/agent/purge/persona.md`：pi-purge 自己也写了「发布的包里带狠提示词会被扫掉」，公开仓库同理。所以 `install.mjs` 是现生成，不是把 21KB 文案拷进 git。

## 5. 已知边界

- `strict` 会连 `AGENTS.md` / 项目上下文 / skills 列表一起丢掉（这是它干净的原因，也是它的代价）。日常干活想留工具规则就用 `replace`。
- 装的是**全局** agent 目录，所以终端 `pi`、pi-app、其它 pi 派生品会同时看到 `/purge`；不输入 `/purge on` 就跟没装一样。
- 本目录只管 pi。DSH 那份是 `F:\maxv\dsh插件\dsh-purge`，两边分开装、分开生效。

## 6. 文件

| 文件 | 作用 |
| --- | --- |
| `pi-purge.ts` | 扩展本体，取自 [ZiChuanLan/pi-purge](https://github.com/ZiChuanLan/pi-purge) 0.3.0 `extensions/pi-purge.ts`（MIT），原样保留 |
| `install.mjs` | 装/卸扩展，从 DSH 注入文件生成人设 |
| `verify.mjs` | 假宿主 + 假模型，11 项断言：关闭不接管、strict 切身份句和 `<docs>`、replace 留工具规则、关闭后复原 |
| `probe-loader.mjs` | 调 pi 自己的 `discoverAndLoadExtensions`，确认 agent 目录里的扩展真能被加载并注册 `/purge` |
