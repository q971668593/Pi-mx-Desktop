# 内置扩展：billion-context（随安装包携带）

这里放的是 **第三方扩展的打包副本**，由桌面端在 worker 建会话时按文件加载
（`additionalExtensionPaths`），不装 npm、不写用户的 `settings.packages`、不影响终端里那份 pi。

| 项 | 值 |
|---|---|
| 上游 | https://github.com/ranxianglei/billion-context |
| 版本 | 0.1.216（见 `package.json` / `dist/build-info.json`） |
| 许可证 | MIT（见 `LICENSE`，随包分发时必须保留） |
| 入口 | `dist/agent/billion-context.js` → 转发到 `dist/agent/pi-native.js`（自包含，只依赖 node 内置模块） |
| 运行方式 | pi 原生插件的 **inline** 模式：压缩引擎跑在 worker 进程内，不起代理进程、不做证书 MITM |
| 状态目录 | `~/.local/share/billion-context/sessions/index.db`（增长较快，注意磁盘） |

## 只保留这些文件的原因

上游 npm 包 6MB+，大部分是 dsh / omp / opencode / zcode 等其它宿主的适配层与文档。
pi 这一侧只需要 `dist/agent/billion-context.js`（42 字节的转发入口）、它引用的
`dist/agent/pi-native.js`、`dist/build-info.json`（版本号来源）、`LICENSE`、`package.json`。

## 升级步骤

```bash
npm pack billion-context@<新版本>
tar xzf billion-context-<新版本>.tgz
cp package/dist/agent/pi-native.js package/dist/agent/billion-context.js resources/billion-context/dist/agent/
cp package/dist/build-info.json resources/billion-context/dist/
cp package/LICENSE resources/billion-context/
# 再把 package.json 的 version 同步过来，删掉 main/exports/pi.image 这三段
```

升完用 `npx vitest run src/main/__tests__/builtin-extensions.test.ts` 和一次真实会话确认
（`~/.local/state/billion-context/bili.log` 里应出现 `inline` 引擎启动、`pi registered: <provider>`）。

## 关掉它

设置 → 运行环境 → 「上下文压缩（内置）」；或 `pi-desktop.json` 里
`"builtinBillionContext": false`。改动在下一次新会话（worker 重启）生效。
