# 内置生图（image_gen）

设置 → 模型 → 生图。三条路：`off`（继续用 MCP）/ `codex`（本机 ChatGPT 订阅授权）/ `custom`（OpenAI 兼容中转）。

## 为什么要「第一方身份」

订阅生图走后端 `chatgpt.com/backend-api/codex/images/generations`。官方对不像官方客户端的请求
有一条**静默降级**路径：HTTP 200，但图片发灰、丢透明、画质骤降（俗称降智）。因此请求头有两套身份，
都**不带任何第三方标记**：

| 身份 | 关键头 | 来源 |
|---|---|---|
| `web`（默认） | Chrome UA + Sec-CH-UA + Origin/Referer=`chatgpt.com` + `oai-device-id`（`<userData>/image-gen-device.json` 持久化）+ `oai-language` + `session-id` | 模拟网页端 backend-api 请求 |
| `codex` | `user-agent: codex_cli_rs/<v> (<os>; <arch>) vscode/<v>`、`originator: codex_cli_rs`、`session-id`/`thread-id` | `openai/codex`：`DEFAULT_ORIGINATOR = "codex_cli_rs"`（`codex-rs/login/src/auth/default_client.rs`）+ `terminal-detection` 的 UA 拼接 |

历史坑：本插件/旧实现发过 `originator: pi-desktop`、`originator: dsh-chatgpt-login`——这正是第三方指纹，
现在两套身份都不会发（网页身份下连 `originator` 头都不出现，因为真实网页端也不发）。

## 画质

`quality` 默认 `high` 并**显式**写进请求体。不传时服务端用最省成本的默认档，是"图片很烂"最常见的原因。
可选 `auto/low/medium/high/xhigh/max`（xhigh/max 取决于账号权限，被拒不会自动降级到别的模型）。

## 出图后的降智自检（warnings）

`inspectGeneratedImages()` 检查真实字节而不是相信参数：

- 请求 `transparent` 但返回 JPEG，或返回 PNG 的 IHDR `colorType` 不是 4/6（没有 alpha 通道）；
- 请求尺寸与实际 PNG 宽高差超过 8px；
- 服务端响应头/返回里的模型与所选不一致（`x-model`、`x-openai-selected-model`）。

告警直接写进工具返回的第一段（人也能看见），并在设置页「试一张」的 toast 里出现。

## 其它

- 401 会刷新一次 OAuth 令牌再重试（刷新成功才回写 `~/.codex/auth.json`，保留其它字段）。
- 结果落在项目 `generated-images/`（可配），时间线自动出缩略图；短路径解析见 `workspace-file-locate.ts`。
- 未开启时工具返回明确提示，让模型不要改用 MCP。
