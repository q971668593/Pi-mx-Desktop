import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()

/**
 * 漂移门禁：生成物必须与 `src/main` 的注册点一致。
 *
 * 事实源是主进程的 registerHandler / registerHandlerWithSchema 调用；白名单与
 * doc/IPC-CONTRACTS.generated.md 都是产物。改了注册点却没跑 `npm run gen:ipc`
 * 时这里会红，避免 preload 白名单和代码再次脱节（历史上曾漏掉
 * `ipc:gitBoard.checkoutCommit`，导致渲染层调用被 preload 拒绝）。
 */
describe('IPC contract generation', () => {
  it('generated allowlist and docs are up to date', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/generate-ipc-channels.mjs'), '--check'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    assert.equal(result.status, 0, `生成物已漂移，请运行 \`npm run gen:ipc\` 后提交：\n${output}`)
    assert.match(output, /无漂移|no drift/i)
  })
})
