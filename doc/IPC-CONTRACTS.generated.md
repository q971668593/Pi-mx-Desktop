# IPC 契约（自动生成）

> 本文件由 `scripts/generate-ipc-channels.mjs` 生成，**请勿手改**。运行 `npm run gen:ipc` 更新。
> 事实源：`src/main/**/*.ts` 中的 `registerHandler` / `registerHandlerWithSchema` 调用。
> 手写文档在 `doc/IPC-CONTRACTS.md`；本文件保证「代码里注册了什么」与「文档里写了什么」不会漂移。

- invoke 通道：**360** 个（唯一）
- main → renderer 事件通道：**12** 个（唯一）
- 非字面量注册：**0** 处
- 动态事件通道（通道名非常量，未收录）：**7** 处

> 事件表只收录字面量发送。`webContents.send(channel, …)` 这类包装器的通道名在运行时才确定，
> 因此**不能**把下面的数字当成「主进程一共只发这么多事件」；新增包装器请同步登记到 `doc/IPC-CONTRACTS.md`。

## 通道数量（按域）

| 域 | 通道数 |
| --- | ---: |
| `browser` | 35 |
| `gitBoard` | 32 |
| `session` | 29 |
| `workspace` | 22 |
| `extensions` | 14 |
| `teamBoard` | 14 |
| `remote` | 12 |
| `desktop` | 11 |
| `grow` | 9 |
| `grow-prd` | 9 |
| `mcp` | 9 |
| `model` | 9 |
| `sessionGoal` | 9 |
| `feedback` | 8 |
| `app` | 7 |
| `asr` | 6 |
| `pi` | 6 |
| `prompt` | 6 |
| `window` | 6 |
| `adapter` | 5 |
| `extension` | 5 |
| `purge` | 5 |
| `resource` | 5 |
| `sdk` | 5 |
| `skills` | 5 |
| `terminal` | 5 |
| `git` | 4 |
| `imageGen` | 4 |
| `project` | 4 |
| `promptInject` | 4 |
| `python` | 4 |
| `runtime` | 4 |
| `shell` | 4 |
| `clipboard` | 3 |
| `dialog` | 3 |
| `notifications` | 3 |
| `review` | 3 |
| `routers` | 3 |
| `adapters` | 2 |
| `alerts` | 2 |
| `background` | 2 |
| `capabilities` | 2 |
| `commands` | 2 |
| `rewind` | 2 |
| `rightPanels` | 2 |
| `settings` | 2 |
| `slash` | 2 |
| `wsl` | 2 |
| `aiActivityGlow` | 1 |
| `context` | 1 |
| `delegate` | 1 |
| `link` | 1 |
| `prompts` | 1 |
| `registry` | 1 |
| `resources` | 1 |
| `thinkingLevel` | 1 |
| `usage` | 1 |

## invoke 通道明细

### browser（35）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:browser.capture` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.chrome.focusTab` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.chrome.openExtensionFolder` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.chrome.regenerate` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.chrome.setEnabled` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.chrome.status` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.chrome.tabs` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.downloader.status` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.downloads.cancel` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.downloads.clear` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.downloads.list` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.downloads.reveal` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.find` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.find.stop` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.help.list` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.help.respond` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.hideAll` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.inspectPoint` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.logs` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.navigate` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.pageContext` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.profile.clear` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.scroll` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.session.set` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.shutdown` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.siteNotes.delete` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.siteNotes.list` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.siteNotes.read` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.tabs.adoptSession` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.tabs.close` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.tabs.focus` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.tabs.list` | registerHandler | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.tabs.open` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.tabs.pin` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |
| `ipc:browser.viewBounds` | registerHandlerWithSchema | `src/main/ipc/handlers/browser.ts` |

### gitBoard（32）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:gitBoard.branch` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.changes` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.checkout` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.checkoutCommit` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.cherryPick` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.clearLog` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.clone` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.commit` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.commitDetail` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.diff` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.discard` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.exclude` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.init` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.log` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.merge` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.operation` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.overview` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.rebase` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.remote` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.reset` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.resolve` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.revert` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.stage` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.stageAll` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.stagePatch` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.stash` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.suggestCommit` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.sync` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.tag` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.unstage` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.unstageAll` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |
| `ipc:gitBoard.worktree` | registerHandlerWithSchema | `src/main/ipc/handlers/git-board.ts` |

### session（29）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:session.archive` | registerHandler | `src/main/ipc/handlers/session.ts` |
| `ipc:session.archive.drop` | registerHandler | `src/main/ipc/handlers/session.ts` |
| `ipc:session.archive.list` | registerHandler | `src/main/ipc/handlers/session.ts` |
| `ipc:session.archive.restore` | registerHandler | `src/main/ipc/handlers/session.ts` |
| `ipc:session.branchAnchors` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.clone` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.compact` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.delete` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.export` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.fork` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.forkCandidates` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.getMessages` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.interrupted` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.list` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.navigateTree` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.new` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.open` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.prepare` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.reloadFromDisk` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.rename` | registerHandler | `src/main/ipc/handlers/session.ts` |
| `ipc:session.restore` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.restoreTurnFile` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.setEphemeralDraft` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.setPendingBind` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.setVisible` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.trash.list` | registerHandler | `src/main/ipc/handlers/session.ts` |
| `ipc:session.trash.purge` | registerHandler | `src/main/ipc/handlers/session.ts` |
| `ipc:session.tree` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:session.turnSnapshot` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |

### workspace（22）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:workspace.ensureWorker` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.fs.clipboardDebug` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.copyFile` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.create` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.listDir` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.readText` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.rename` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.resolveFileNames` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.search` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.trash` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.fs.writeText` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:workspace.isSandbox` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.open` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.sandbox.create` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.sandbox.delete` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.sandbox.list` | registerHandler | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.sandbox.rename` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.switch` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace.ts` |
| `ipc:workspace.tasks.delete` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-tasks.ts` |
| `ipc:workspace.tasks.draft` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-tasks.ts` |
| `ipc:workspace.tasks.get` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-tasks.ts` |
| `ipc:workspace.tasks.save` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-tasks.ts` |

### extensions（14）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:extensions.checkPackageUpdates` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.installCapabilityPackage` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.installPackage` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.list` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.marketplaceSearch` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.missingRuntimePackages` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.packageDetails` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.packages` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.removePackage` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.setEnabled` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.setOverride` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.syncGitPackages` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.translate` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:extensions.updatePackage` | registerHandler | `src/main/ipc/handlers/extensions.ts` |

### teamBoard（14）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:teamBoard.abortRun` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.activeRuns` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.approval` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.dispatch` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.init` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.intervene` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.prompt` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.roleSession` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.roles.save` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.settleRun` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.snapshot` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.sweep` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.task.create` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |
| `ipc:teamBoard.taskStatus` | registerHandlerWithSchema | `src/main/ipc/handlers/team-board.ts` |

### remote（12）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:remote.regeneratePairing` | registerHandler | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.regenerateTls` | registerHandler | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.relayProbe` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.removeDevice` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.revokeDevice` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.setDeviceRole` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.setEnabled` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.setPort` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.setProjects` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.setPublicHosts` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.setRelay` | registerHandlerWithSchema | `src/main/ipc/handlers/remote.ts` |
| `ipc:remote.status` | registerHandler | `src/main/ipc/handlers/remote.ts` |

### desktop（11）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:desktop.appName` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.crashCopy` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.createGitWorktree` | registerHandlerWithSchema | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.gitWorktrees` | registerHandlerWithSchema | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.killWorker` | registerHandlerWithSchema | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.pairingCode` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.pickFolder` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.removeGitWorktree` | registerHandlerWithSchema | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.setBadge` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.setSleepBlock` | registerHandlerWithSchema | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:desktop.status` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |

### grow（9）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:grow:beginPlan` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:convertToTeam` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:ensureDir` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:finishPlan` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:getState` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:listSessions` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:putQuestions` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:startSession` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |
| `ipc:grow:submitAnswer` | registerHandlerWithSchema | `src/main/ipc/handlers/grow.ts` |

### grow-prd（9）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:grow-prd:commit` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:createChange` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:listIncomplete` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:projectConfirm` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:projectContext` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:projectListIncomplete` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:projectPreview` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:projectRecover` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |
| `ipc:grow-prd:read` | registerHandler | `src/main/ipc/handlers/grow-prd.ts` |

### mcp（9）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:mcp.autoCodemode.set` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.config.get` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.import` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.login` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.logout` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.server.patch` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.server.remove` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.server.save` | registerHandler | `src/main/ipc/handlers/mcp.ts` |
| `ipc:mcp.status` | registerHandler | `src/main/ipc/handlers/mcp.ts` |

### model（9）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:model.auth.answer` | registerHandlerWithSchema | `src/main/ipc/handlers/model-auth.ts` |
| `ipc:model.auth.cancel` | registerHandlerWithSchema | `src/main/ipc/handlers/model-auth.ts` |
| `ipc:model.auth.login` | registerHandlerWithSchema | `src/main/ipc/handlers/model-auth.ts` |
| `ipc:model.auth.logout` | registerHandlerWithSchema | `src/main/ipc/handlers/model-auth.ts` |
| `ipc:model.auth.providers` | registerHandlerWithSchema | `src/main/ipc/handlers/model-auth.ts` |
| `ipc:model.cycle` | registerHandler | `src/main/ipc/handlers/model-runtime.ts` |
| `ipc:model.list` | registerHandlerWithSchema | `src/main/ipc/handlers/model-runtime.ts` |
| `ipc:model.reload` | registerHandler | `src/main/ipc/handlers/model-runtime.ts` |
| `ipc:model.set` | registerHandlerWithSchema | `src/main/ipc/handlers/model-runtime.ts` |

### sessionGoal（9）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:sessionGoal.clear` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.continue` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.get` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.loopRound` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.markDone` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.resume` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.set` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.setAutoRun` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |
| `ipc:sessionGoal.toggleCriterion` | registerHandlerWithSchema | `src/main/ipc/handlers/session-goal.ts` |

### feedback（8）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:feedback.delete` | registerHandler | `src/main/ipc/handlers/feedback.ts` |
| `ipc:feedback.inject.set` | registerHandler | `src/main/ipc/handlers/feedback.ts` |
| `ipc:feedback.list` | registerHandler | `src/main/ipc/handlers/feedback.ts` |
| `ipc:feedback.report` | registerHandler | `src/main/ipc/handlers/feedback.ts` |
| `ipc:feedback.rule.add` | registerHandler | `src/main/ipc/handlers/feedback.ts` |
| `ipc:feedback.rule.delete` | registerHandler | `src/main/ipc/handlers/feedback.ts` |
| `ipc:feedback.setStatus` | registerHandler | `src/main/ipc/handlers/feedback.ts` |
| `ipc:feedback.summarize` | registerHandler | `src/main/ipc/handlers/feedback.ts` |

### app（7）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:app.checkUpdate` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:app.dismissUpdatePrompt` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:app.downloadUpdate` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:app.getPendingUpdate` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:app.ignoreUpdateVersion` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:app.openRelease` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:app.shellReady` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |

### asr（6）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:asr.builtinStatus` | registerHandler | `src/main/ipc/handlers/asr.ts` |
| `ipc:asr.detectBinary` | registerHandler | `src/main/ipc/handlers/asr.ts` |
| `ipc:asr.importCodexAccessToken` | registerHandler | `src/main/ipc/handlers/asr.ts` |
| `ipc:asr.probeCodexAuth` | registerHandler | `src/main/ipc/handlers/asr.ts` |
| `ipc:asr.testConnection` | registerHandler | `src/main/ipc/handlers/asr.ts` |
| `ipc:asr.transcribe` | registerHandler | `src/main/ipc/handlers/asr.ts` |

### pi（6）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:pi.getInfo` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:pi.models.fetch` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:pi.models.get` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:pi.models.set` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:pi.settings.get` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:pi.settings.set` | registerHandlerWithSchema | `src/main/ipc/handlers/pi-sdk.ts` |

### prompt（6）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:prompt.abort` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:prompt.dequeueClearQueue` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:prompt.flushQueue` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:prompt.followUp` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:prompt.send` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:prompt.steer` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |

### window（6）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:window:close` | registerHandler | `src/main/ipc/handlers/window-controls.ts` |
| `ipc:window:close-decision` | registerHandler | `src/main/ipc/handlers/window-controls.ts` |
| `ipc:window:close-decision-shown` | registerHandler | `src/main/ipc/handlers/window-controls.ts` |
| `ipc:window:isMaximized` | registerHandler | `src/main/ipc/handlers/window-controls.ts` |
| `ipc:window:maximize` | registerHandler | `src/main/ipc/handlers/window-controls.ts` |
| `ipc:window:minimize` | registerHandler | `src/main/ipc/handlers/window-controls.ts` |

### adapter（5）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:adapter.action.run` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |
| `ipc:adapter.config.get` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |
| `ipc:adapter.config.set` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |
| `ipc:adapter.field.options` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |
| `ipc:adapter.sidePanel.getState` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |

### extension（5）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:extension.cancelUI` | registerHandler | `src/main/ipc/handlers/extension-ui.ts` |
| `ipc:extension.config.get` | registerHandler | `src/main/ipc/handlers/extension-ui.ts` |
| `ipc:extension.config.set` | registerHandler | `src/main/ipc/handlers/extension-ui.ts` |
| `ipc:extension.rememberConfirm` | registerHandler | `src/main/ipc/handlers/extension-ui.ts` |
| `ipc:extension.respondUI` | registerHandler | `src/main/ipc/handlers/extension-ui.ts` |

### purge（5）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:purge.choosePersona` | registerHandler | `src/main/ipc/handlers/purge.ts` |
| `ipc:purge.getState` | registerHandler | `src/main/ipc/handlers/purge.ts` |
| `ipc:purge.reinstall` | registerHandler | `src/main/ipc/handlers/purge.ts` |
| `ipc:purge.setEnabled` | registerHandlerWithSchema | `src/main/ipc/handlers/purge.ts` |
| `ipc:purge.setMode` | registerHandlerWithSchema | `src/main/ipc/handlers/purge.ts` |

### resource（5）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:resource.read` | registerHandlerWithSchema | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:resource.restore` | registerHandlerWithSchema | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:resource.revision.read` | registerHandlerWithSchema | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:resource.revisions` | registerHandlerWithSchema | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:resource.write` | registerHandlerWithSchema | `src/main/ipc/handlers/skills-resources.ts` |

### sdk（5）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:sdk.install` | registerHandlerWithSchema | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:sdk.installGlobalCli` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:sdk.listAvailable` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:sdk.status` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |
| `ipc:sdk.switch` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |

### skills（5）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:skills.applyOverrides` | registerHandler | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:skills.description.write` | registerHandler | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:skills.list` | registerHandler | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:skills.setEnabled` | registerHandlerWithSchema | `src/main/ipc/handlers/skills-resources.ts` |
| `ipc:skills.transfer` | registerHandlerWithSchema | `src/main/ipc/handlers/skills-resources.ts` |

### terminal（5）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:terminal.create` | registerHandlerWithSchema | `src/main/ipc/handlers/terminal.ts` |
| `ipc:terminal.kill` | registerHandlerWithSchema | `src/main/ipc/handlers/terminal.ts` |
| `ipc:terminal.profiles` | registerHandlerWithSchema | `src/main/ipc/handlers/terminal.ts` |
| `ipc:terminal.resize` | registerHandlerWithSchema | `src/main/ipc/handlers/terminal.ts` |
| `ipc:terminal.runTasks` | registerHandlerWithSchema | `src/main/ipc/handlers/terminal.ts` |

### git（4）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:git.branchStatus` | registerHandlerWithSchema | `src/main/ipc/handlers/git-branches.ts` |
| `ipc:git.branches` | registerHandlerWithSchema | `src/main/ipc/handlers/git-branches.ts` |
| `ipc:git.restoreStash` | registerHandlerWithSchema | `src/main/ipc/handlers/git-branches.ts` |
| `ipc:git.switchBranch` | registerHandlerWithSchema | `src/main/ipc/handlers/git-branches.ts` |

### imageGen（4）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:imageGen.config.set` | registerHandlerWithSchema | `src/main/ipc/handlers/image-gen.ts` |
| `ipc:imageGen.generate` | registerHandlerWithSchema | `src/main/ipc/handlers/image-gen.ts` |
| `ipc:imageGen.models` | registerHandler | `src/main/ipc/handlers/image-gen.ts` |
| `ipc:imageGen.status` | registerHandler | `src/main/ipc/handlers/image-gen.ts` |

### project（4）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:project.hide` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:project.removeRecent` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:project.rename` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:project.restoreRecent` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |

### promptInject（4）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:promptInject.get` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt-inject.ts` |
| `ipc:promptInject.restoreBackup` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt-inject.ts` |
| `ipc:promptInject.revert` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt-inject.ts` |
| `ipc:promptInject.save` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt-inject.ts` |

### python（4）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:python.dismissSetupPrompt` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:python.installLatest` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:python.openDownloads` | registerHandler | `src/main/ipc/handlers/settings.ts` |
| `ipc:python.status` | registerHandler | `src/main/ipc/handlers/settings.ts` |

### runtime（4）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:runtime.getState` | registerHandlerWithSchema | `src/main/ipc/handlers/model-runtime.ts` |
| `ipc:runtime.onboarding.complete` | registerHandlerWithSchema | `src/main/ipc/handlers/runtime-onboarding.ts` |
| `ipc:runtime.onboarding.get` | registerHandler | `src/main/ipc/handlers/runtime-onboarding.ts` |
| `ipc:runtime.probe` | registerHandler | `src/main/ipc/handlers/runtime-onboarding.ts` |

### shell（4）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:shell.openExternal` | registerHandlerWithSchema | `src/main/ipc/handlers/links.ts` |
| `ipc:shell.openPath` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:shell.readImagePreview` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |
| `ipc:shell.showItemInFolder` | registerHandlerWithSchema | `src/main/ipc/handlers/workspace-fs.ts` |

### clipboard（3）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:clipboard.copyImageFile` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:clipboard.readTempImage` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:clipboard.writeTempImage` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |

### dialog（3）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:dialog:openDirectory` | registerHandler | `src/main/ipc/handlers/dialog.ts` |
| `ipc:dialog:openFiles` | registerHandler | `src/main/ipc/handlers/dialog.ts` |
| `ipc:dialog:saveImage` | registerHandlerWithSchema | `src/main/ipc/handlers/dialog.ts` |

### notifications（3）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:notifications.inbox` | registerHandler | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:notifications.markRead` | registerHandlerWithSchema | `src/main/ipc/handlers/desktop-chrome.ts` |
| `ipc:notifications.markUnread` | registerHandlerWithSchema | `src/main/ipc/handlers/desktop-chrome.ts` |

### review（3）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:review.getDiff` | registerHandlerWithSchema | `src/main/ipc/handlers/review.ts` |
| `ipc:review.stageHunks` | registerHandlerWithSchema | `src/main/ipc/handlers/review.ts` |
| `ipc:review.unstageHunks` | registerHandlerWithSchema | `src/main/ipc/handlers/review.ts` |

### routers（3）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:routers.classifiers` | registerHandler | `src/main/ipc/handlers/model-routers.ts` |
| `ipc:routers.get` | registerHandler | `src/main/ipc/handlers/model-routers.ts` |
| `ipc:routers.set` | registerHandler | `src/main/ipc/handlers/model-routers.ts` |

### adapters（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:adapters.catalog` | registerHandler | `src/main/ipc/handlers/extensions.ts` |
| `ipc:adapters.json.catalog` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |

### alerts（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:alerts.signal` | registerHandlerWithSchema | `src/main/ipc/handlers/settings.ts` |
| `ipc:alerts.test` | registerHandler | `src/main/ipc/handlers/settings.ts` |

### background（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:background.choose` | registerHandlerWithSchema | `src/main/ipc/handlers/background.ts` |
| `ipc:background.read` | registerHandlerWithSchema | `src/main/ipc/handlers/background.ts` |

### capabilities（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:capabilities.apply` | registerHandlerWithSchema | `src/main/ipc/handlers/prompt.ts` |
| `ipc:capabilities.catalog` | registerHandler | `src/main/ipc/handlers/prompt.ts` |

### commands（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:commands.completions` | registerHandler | `src/main/ipc/handlers/commands-slash.ts` |
| `ipc:commands.list` | registerHandler | `src/main/ipc/handlers/commands-slash.ts` |

### rewind（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:rewind.checkpoints` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |
| `ipc:rewind.runCommand` | registerHandlerWithSchema | `src/main/ipc/handlers/session.ts` |

### rightPanels（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:rightPanels.catalog` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |
| `ipc:rightPanels.saveLayout` | registerHandler | `src/main/ipc/handlers/adapter-panels.ts` |

### settings（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:settings.get` | registerHandlerWithSchema | `src/main/ipc/handlers/settings.ts` |
| `ipc:settings.set` | registerHandlerWithSchema | `src/main/ipc/handlers/settings.ts` |

### slash（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:slash.normalize` | registerHandler | `src/main/ipc/handlers/commands-slash.ts` |
| `ipc:slash.resolve` | registerHandler | `src/main/ipc/handlers/commands-slash.ts` |

### wsl（2）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:wsl.listDistros` | registerHandler | `src/main/ipc/handlers/wsl.ts` |
| `ipc:wsl.probeDistro` | registerHandlerWithSchema | `src/main/ipc/handlers/wsl.ts` |

### aiActivityGlow（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:aiActivityGlow.preview` | registerHandler | `src/main/ipc/handlers/settings.ts` |

### context（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:context.preview` | registerHandlerWithSchema | `src/main/ipc/handlers/model-runtime.ts` |

### delegate（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:delegate.sessionFiles` | registerHandlerWithSchema | `src/main/ipc/handlers/delegate.ts` |

### link（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:link.preview` | registerHandlerWithSchema | `src/main/ipc/handlers/links.ts` |

### prompts（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:prompts.list` | registerHandler | `src/main/ipc/handlers/skills-resources.ts` |

### registry（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:registry.refresh` | registerHandler | `src/main/ipc/handlers/commands-slash.ts` |

### resources（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:resources.list` | registerHandler | `src/main/ipc/handlers/pi-sdk.ts` |

### thinkingLevel（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:thinkingLevel.set` | registerHandlerWithSchema | `src/main/ipc/handlers/model-runtime.ts` |

### usage（1）

| 通道 | 注册方式 | 注册位置 |
| --- | --- | --- |
| `ipc:usage.summary` | registerHandlerWithSchema | `src/main/ipc/handlers/usage.ts` |

## main → renderer 事件通道

| 通道 | 发送位置 |
| --- | --- |
| `ipc:close-requested` | `src/main/window-close-guard.ts` |
| `ipc:events` | `src/main/secret-store.ts`<br>`src/main/worker-manager.ts` |
| `ipc:extension-ui-dismiss` | `src/main/worker-manager-pool.ts` |
| `ipc:extension-ui-request` | `src/main/worker-manager-pool.ts` |
| `ipc:git-workspace-changed` | `src/main/git-workspace-watch.ts`<br>`src/main/ipc/handlers/git-branches.ts` |
| `ipc:model-catalog-changed` | `src/main/index.ts`<br>`src/main/ipc/handlers/model-auth.ts`<br>`src/main/worker-manager.ts` |
| `ipc:notification-open-session` | `src/main/completion-notification-delivery.ts` |
| `ipc:worker-exit` | `src/main/worker-manager.ts` |
| `ipc:worker-fatal` | `src/main/worker-manager.ts` |
| `notification:focus` | `src/main/completion-notification-delivery.ts` |
| `notification:sound` | `src/main/completion-notification-delivery.ts` |
| `notification:update` | `src/main/completion-notification-delivery.ts` |

## 动态事件通道（未收录，仅登记位置）

- `src/main/app-update-download.ts`：`APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL`
- `src/main/browser/browser-host.ts`：`BROWSER_EVENT_CHANNEL`
- `src/main/browser/chrome/index.ts`：`BROWSER_EVENT_CHANNEL`
- `src/main/remote-host-electron.ts`：`channel`
- `src/main/terminal/terminal-service.ts`：`channel`
- `src/main/terminal/terminal-tool-bridge.ts`：`channel`
- `src/main/updater.ts`：`APP_UPDATE_AVAILABLE_CHANNEL`
