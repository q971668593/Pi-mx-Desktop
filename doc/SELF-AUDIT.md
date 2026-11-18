# 自检报告（2026-11-18 · 分支 `自检优化`）

> 范围：全仓门禁实跑 + 主进程/渲染层边界审查 + 依赖最近改动（回合快照、目标续跑、工作区写入）的复核。
> 结论先行：**门禁形状完整、但有几处"绿灯背后的洞"**。本轮修掉 3 个真实缺陷，补 1 道新门禁，其余按优先级登记在此，避免重复讨论。

## 1. 基线实测（本机 Windows，Node 24.18）

| 门禁 | 结果 | 耗时 |
|---|---|---|
| `npm run typecheck` | web + node 双工程通过（HEAD 26ba896 时） | ~40s |
| `npm run lint` | 5 warning → 本轮清零 | ~25s |
| `npm run build` | 通过 | 24.3s |
| `npm run test:scripts` | 99 文件 / 304 例全绿 | ~10s |
| `npm run test:unit` | 429 文件 / 2508 例，**1 例偶发红** | 173.6s |

> 复测（修掉下述 S3/S6 后，排除并行半成品）：**429 文件 / 2531 例全绿，153s**。
>
> 排查提示：vitest 的 `Error: STACK_TRACE_ERROR` 不是代码崩溃，而是**测试超时**（`withTimeout` 把 stack 指向那个哨兵异常）。默认 5s 在满载 Windows 上役不住真实 git 子进程。

规模：`src` + `packages` 非测试代码约 11.8 万行；主进程 3.0MB、渲染层 5.7MB；IPC 注册点 286 个（131 带 zod，155 不带）。

> 自检期间工作区仍有并行改动（team-board 功能，未提交），全量 `typecheck` / `test:unit` 的最后一次结果因此夹带其半成品错误；本报告只对**本分支提交范围内**的绿灯负责。

## 2. 本轮已修（有提交、有回归）

| # | 缺陷 | 证据 | 修复 |
|---|---|---|---|
| S1 | **点击一个 markdown 链接即可执行本地程序** | `window.ts` 的 `setWindowOpenHandler` 原样 `shell.openExternal(anyUrl)`；`ipc:shell.openPath` 对任意路径直接 `shell.openPath`。`file:///C:/Windows/System32/calc.exe` 这类目标会由系统默认处理器**执行**，而不是打开 | 新增 `window-navigation.ts`：`window.open` 只放行 http(s)；`will-navigate` 守卫把整窗导航限制在打包 renderer 目录 / dev server 源，其余拦截（http(s) 交给系统浏览器，`file:` 一律不交）。新增 `shell-open-safety.ts`：exe/msi/ps1/bat/js/sh/app 等目标改为 `showItemInFolder` 定位，绝不启动 |
| S2 | 外链策略两处各写一份，迟早漂移 | `link-preview.ts` 与窗口守卫各有一份 http(s)+无凭据判断 | 收敛到 `packages/shared/web-url.ts`，两处共用 |
| S3 | 全量单测偶发红（"门禁一直红"就等于没门禁） | `markdown-file-links.test.tsx` 的 shiki 断言用 `waitFor` 默认 1s；150 行 fixture 在满载 runner 上超时，单跑必绿 | 该用例 5s 窗口，注明原因 |
| S4 | IPC 入参校验覆盖率无人看守 | 155 个 `registerHandler` 注册点中 **99 个拿请求但不校验**（另有 56 个无入参，属合理豁免）；preload 白名单只校验通道名 | 新增 `scripts/tests/ipc-schema-coverage.test.mjs`：预算 99，只降不升；失败时打印全部未校验通道与文件（已注入探针验证能红） |
| S5 | 门禁要一条条敲，容易漏 | — | 新增 `npm run selfcheck`（typecheck→lint→build→契约→单测，按 CI 顺序，失败即列出全部红项）与 `selfcheck:quick` |
| S6 | 满载下 5 个 git 套件整片红（`STACK_TRACE_ERROR`） | 单跑必绿；并行跑 build/另一套测试时超时——vitest 默认 `testTimeout 5s` / `hookTimeout 10s` 不够真实 git 子进程 | `vitest.config.ts` 提到 `testTimeout 20s` / `hookTimeout 30s`；复测 429 文件 2531 例全绿且总时长从 178s 降到 153s（超时不再拖住 worker） |
| S7 | 渲染层崩溃只给一次自愈，第二次白屏 | `rendererReloadAfterCrash` 置 true 后永不复位，第二次 `render-process-gone` 只打日志 | `renderer-crash-recovery.ts` 滑动窗口限流（5 分钟内最多重载 2 次），超限弹原生错误框而不是静默白屏；5 例单测覆盖窗口过期/超限/未来时间戳 |

新增单测 40 例（路径越界、大小写、尾随点/空格、`javascript:`/`data:`、`.app` 目录、UNC/WSL 路径），`lint` 5 条 warning 清零。

## 3. 下一批（按收益/风险排序）

| 优先级 | 项 | 依据 | 落法 + 验收 |
|---|---|---|---|
| P1 | **worker-manager 拆分（T5）** | `src/main/worker-manager.ts` 1326 行，同时承担池路由、生命周期、run 账本、目标续跑、事件转发；`worker-lifecycle-machine.ts` 已有转移表雏形 | 抽 `worker-machine.ts` 纯函数状态机（idle/spawning/ready/busy/draining/dead），manager 只执行 commands；验收：转移全覆单测 + `worker-manager-lifecycle-hardening.test.ts` 保持绿 + 主文件降到 <900 行 |
| P1 | **i18n 键对齐门禁** | 全仓无 parity 检查；实测 `common/settings` 在复数后缀归一化后 0 差异，但 `team.json` 已有 zh-only `roles.unassigned`（英文用户会看到原始 key） | `scripts/check-i18n-parity.mjs`：扁平化 + 去掉 `_zero/_one/_two/_few/_many/_other` 后比对，缺键即红；接进 `test:scripts`。**先修掉现存缺键再开** |
| P2 | **死通道清理** | `ipc:desktop.whichPi` 只存在于注册点、生成白名单、生成文档，全仓 0 调用方；通道白名单是渲染层（含扩展 UI）可达接口 | 删 handler + `ipc-contract` 条目，跑 `gen:ipc`；验收：生成文件幂等、契约测试绿。**注意：当前并行改动正在重生成这两个文件，需等其提交后再动** |
| P2 | **CSP 缺失** | `src/renderer/index.html` 无 `Content-Security-Policy`，且主题引导是内联 `<script>` + 内联 `<style>` | 不能直接加 `script-src 'self'`（会打断内联引导）。方案：给引导脚本算 sha256 写进 CSP，`style-src 'self' 'unsafe-inline'`（shiki/KaTeX/custom CSS 依赖内联样式），`img-src 'self' data: blob:`；验收：`test:e2e` 全绿 + 主题/公式/图表/自定义 CSS 手工冒烟 |
| P3 | **CI 单测跑两份串行** | `quality.yml` 的 `unit-test` 与 `unit-test-win` 各跑 433 文件；本机 178s，CI 更慢，且 job 内先 build 再测 | `vitest run --shard=N/2` + matrix（ubuntu×2、windows×2）；验收：两侧都绿、总时长下降 |
| P3 | 文档与实际不符 | `README.md` 与 `README.zh-CN.md` **字节相同且 0 中文字符**（`README.en.md` 另有英文版）；`doc/README.zh-CN.md` 同样 0 中文 | 要么补中文版，要么删掉 `zh-CN` 文件避免误导；先定产品口径 |

## 4. 明确不做（避免反复讨论）

- **不给 `shell.openPath` 加"仅工作区内"限制**：用户明确有"在系统里打开"跨项目文件的能力（markdown 链接到任意路径），当前改为"可执行目标只定位不启动"，保留功能同时去掉执行面。
- **不关 `PI_RENDERER_SANDBOX` 调试开关**：默认 `sandbox: true`，环境变量仅本地调试用，已文档化。
- **不为 `team-board` 等并行半成品做"顺手修复"**：会与正在写入的会话互相覆盖；只在其落盘后做门禁收口。

## 5. 复现

```bash
npm run selfcheck          # 全量（含 3 分钟单测）
npm run selfcheck:quick    # 跳过单测
npm run typecheck && npm run lint && npm run test:scripts && npm run test:unit
```

新增/修改的回归用例：

- `src/main/window-navigation.test.ts`（窗口打开/导航策略 21 例）
- `src/main/shell-open-safety.test.ts`（可执行目标识别 19 例）
- `src/main/ipc/handlers/workspace-fs-shell.test.ts`（openPath 改为定位）
- `packages/shared/web-url.test.ts`（外链单一事实源 9 例）
- `scripts/tests/ipc-schema-coverage.test.mjs`（未校验入参预算）
