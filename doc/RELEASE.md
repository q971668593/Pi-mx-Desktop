# Release 说明

## 发布流程（维护者）

1. 在 `CHANGELOG.md` 顶部追加完整版本记录（用户可感知条目优先）。
2. 在 `package.json` / `package-lock.json` 提升版本号。
3. **GitHub Release 正文**（用户可见「更新说明」，应用内弹窗展示）：
   - 草稿：`node scripts/generate-release-notes.mjs [version]`
   - 用简短条目说明修复 / 新增 / 注意。
   - **不要**只放 CHANGELOG / RELEASE 文档链接占位。
4. 提交 `release: vX.Y.Z — …` 并打 tag `vX.Y.Z` 推送；CI 构建安装包，并用 `generate-release-notes.mjs` 写入 Release body。
5. 若 CI body 不理想，在 GitHub Release 页手动改成正式说明。

## 破甲人设（CI 必读）

`resources/purge/persona.md` 故意不进公开仓库（`.gitignore`），但**安装包里必须有**，否则破甲页会显示「安装包没带人设」。

- CI 是干净检出，因此 `build-win / build-mac / build-linux` 里有一道 `Materialize purge persona`：
  从仓库 secret `PURGE_PERSONA_B64` 解出 `resources/purge/persona.md`，解不出来就**让流水线失败**（不发缺人设的包）。
- 配 secret（在有那份 md 的机器上执行，直接进剪贴板，不会经过聊天/日志）：

  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes('F:\maxv\PI\pi-app\resources\purge\persona.md')) | Set-Clipboard
  ```

  然后 GitHub → Settings → Secrets and variables → Actions → New repository secret → 名字 `PURGE_PERSONA_B64`，值粘剪贴板内容。
- 本地打包不受影响：`npm run package:win` 会先跑 `purge:persona:require`（生成不出人设就中止）。
- 判定一个安装包带不带人设：`7z l` 打开 `$PLUGINSDIR/app-64.7z`，看 `resources\purge\persona.md` 是否存在。

## 应用内更新

- 启动后后台检查 GitHub `releases/latest`（设置「自动检查更新」可关；失败静默，不弹窗）。
- 有新版本且未「忽略本版本」时弹窗：更新说明（Release body）+ **本次忽略** / **忽略本版本** / **更新**。
- **本次忽略**：仅本次关闭；**忽略本版本**：本机记住版本号，同版本不再自动弹。
- **更新**：下载当前平台安装包并调用系统打开（Windows Setup / macOS dmg / Linux AppImage 等）。
- 因此 **Release body 必须是用户可读说明**，禁止 CHANGELOG 链接占位（旧模板已废弃）。

## 相关文档

- 本机协作备忘（可选，不进仓库）：根目录 `AGENTS.md`（已被 `.gitignore`）
- 仓库变更记录：`CHANGELOG.md`

